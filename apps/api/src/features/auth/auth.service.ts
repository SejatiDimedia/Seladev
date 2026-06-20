import crypto from 'crypto';
import type { AuthRepository } from './auth.repository';
import type { RegisterDto, LoginDto, PasswordChangeDto, User } from './auth.types';
import { hashPassword, comparePassword, generateRandomToken, hashSha256, encryptGcm, decryptGcm, type EncryptedPayload } from '../../lib/crypto';
import { signAccessToken, signMfaPendingToken, verifyMfaPendingToken } from '../../lib/jwt';
import { ConflictError, UnauthorizedError, NotFoundError, ValidationError } from '../../lib/errors';
import { authenticator } from 'otplib';
import QRCode from 'qrcode';

export class AuthService {
  constructor(private readonly authRepo: AuthRepository) {}

  async register(dto: RegisterDto): Promise<User> {
    const existingUser = await this.authRepo.findUserByEmail(dto.email);
    if (existingUser) {
      throw new ConflictError(`User with email "${dto.email}" already exists`);
    }

    const passwordHash = await hashPassword(dto.password);
    const userDoc = await this.authRepo.createUser({
      firstName: dto.firstName,
      lastName: dto.lastName,
      email: dto.email,
      password: dto.password, // This is required by Zod schema but we pass the hashed version to DB
      passwordHash,
    });

    return userDoc.toJSON() as unknown as User;
  }

  async login(dto: LoginDto): Promise<
    | { requiresMfa: false; accessToken: string; refreshToken: string; user: User }
    | { requiresMfa: true; mfaToken: string; user: User }
  > {
    const userDoc = await this.authRepo.findUserByEmail(dto.email);
    if (!userDoc || !userDoc.isActive) {
      throw new UnauthorizedError('Invalid credentials', 'INVALID_CREDENTIALS');
    }

    const isPasswordValid = await comparePassword(dto.password, userDoc.passwordHash);
    if (!isPasswordValid) {
      throw new UnauthorizedError('Invalid credentials', 'INVALID_CREDENTIALS');
    }

    // Check if MFA is enabled
    if (userDoc.mfaEnabled) {
      const mfaToken = signMfaPendingToken(userDoc.id);
      return {
        requiresMfa: true,
        mfaToken,
        user: userDoc.toJSON() as unknown as User,
      };
    }

    // Update lastLoginAt
    userDoc.lastLoginAt = new Date();
    await userDoc.save();

    // Check for active organization membership
    const membership = await this.authRepo.findFirstActiveMembership(userDoc.id);
    const orgId = membership ? membership.organizationId.toString() : '';
    const role = membership ? membership.role : 'none';

    // Generate tokens
    const accessToken = signAccessToken({
      sub: userDoc.id,
      email: userDoc.email,
      orgId,
      role,
    });

    const rawRefreshToken = generateRandomToken();
    const refreshTokenHash = hashSha256(rawRefreshToken);
    const family = crypto.randomUUID();

    // Expiry: 7 days as per FR-AUTH-06
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7);

    await this.authRepo.createRefreshToken({
      tokenHash: refreshTokenHash,
      userId: userDoc.id,
      organizationId: orgId ? orgId : '000000000000000000000000', // Dummy ObjectId if no org
      family,
      expiresAt,
    });

    return {
      requiresMfa: false,
      accessToken,
      refreshToken: rawRefreshToken,
      user: userDoc.toJSON() as unknown as User,
    };
  }

  async refresh(refreshToken: string): Promise<{ accessToken: string; refreshToken: string; user: User }> {
    const tokenHash = hashSha256(refreshToken);
    const tokenDoc = await this.authRepo.findRefreshTokenByHash(tokenHash);

    if (!tokenDoc) {
      throw new UnauthorizedError('Invalid refresh token', 'TOKEN_INVALID');
    }

    // Expiry check
    if (new Date() > tokenDoc.expiresAt) {
      throw new UnauthorizedError('Refresh token expired', 'REFRESH_TOKEN_EXPIRED');
    }

    // Rotation reuse check (FR-AUTH-05)
    if (tokenDoc.isRevoked) {
      // Token reuse attack detected! Revoke the whole family
      await this.authRepo.revokeRefreshTokenFamily(tokenDoc.family);
      throw new UnauthorizedError('Refresh token reuse detected. Revoking session.', 'REFRESH_TOKEN_REUSED');
    }

    const userDoc = await this.authRepo.findUserById(tokenDoc.userId.toString());
    if (!userDoc || !userDoc.isActive) {
      throw new UnauthorizedError('User session invalid', 'TOKEN_INVALID');
    }

    // Mark old token as revoked/replaced
    const rawNewToken = generateRandomToken();
    const newTokenHash = hashSha256(rawNewToken);

    tokenDoc.isRevoked = true;
    tokenDoc.replacedByHash = newTokenHash;
    await tokenDoc.save();

    // Check membership
    const membership = await this.authRepo.findFirstActiveMembership(userDoc.id);
    const orgId = membership ? membership.organizationId.toString() : '';
    const role = membership ? membership.role : 'none';

    // Issue new access token & refresh token (same family)
    const accessToken = signAccessToken({
      sub: userDoc.id,
      email: userDoc.email,
      orgId,
      role,
    });

    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7);

    await this.authRepo.createRefreshToken({
      tokenHash: newTokenHash,
      userId: userDoc.id,
      organizationId: orgId ? orgId : tokenDoc.organizationId.toString(),
      family: tokenDoc.family,
      expiresAt,
    });

    return {
      accessToken,
      refreshToken: rawNewToken,
      user: userDoc.toJSON() as unknown as User,
    };
  }

  async logout(refreshToken: string): Promise<void> {
    const tokenHash = hashSha256(refreshToken);
    const tokenDoc = await this.authRepo.findRefreshTokenByHash(tokenHash);
    if (!tokenDoc) return; // Silent return for idempotency

    // Revoke token family
    await this.authRepo.revokeRefreshTokenFamily(tokenDoc.family);
  }

  async changePassword(userId: string, dto: PasswordChangeDto): Promise<void> {
    const userDoc = await this.authRepo.findUserById(userId);
    if (!userDoc) {
      throw new NotFoundError('User', userId);
    }

    const isPasswordValid = await comparePassword(dto.currentPassword, userDoc.passwordHash);
    if (!isPasswordValid) {
      throw new UnauthorizedError('Invalid current password', 'INVALID_CREDENTIALS');
    }

    const passwordHash = await hashPassword(dto.newPassword);
    userDoc.passwordHash = passwordHash;
    await userDoc.save();

    // Revoke all refresh tokens for this user (FR-AUTH-10)
    await RefreshTokenModel.updateMany({ userId: userDoc._id }, { isRevoked: true }).exec();
  }

  async verifyLoginMfa(mfaToken: string, token: string): Promise<{ accessToken: string; refreshToken: string; user: User }> {
    const decoded = verifyMfaPendingToken(mfaToken);
    const userDoc = await this.authRepo.findUserById(decoded.sub);
    if (!userDoc || !userDoc.isActive) {
      throw new UnauthorizedError('User not found or inactive');
    }

    let verified = false;
    if (userDoc.mfaSecret) {
      const encryptedPayload = JSON.parse(userDoc.mfaSecret) as EncryptedPayload;
      const secret = decryptGcm(encryptedPayload);
      verified = authenticator.verify({ token, secret });
    }

    if (!verified) {
      // Check recovery codes
      for (const hashedCode of userDoc.mfaRecoveryCodes) {
        if (await comparePassword(token, hashedCode)) {
          // Match found! Remove the used recovery code
          userDoc.mfaRecoveryCodes = userDoc.mfaRecoveryCodes.filter(c => c !== hashedCode);
          verified = true;
          break;
        }
      }
    }

    if (!verified) {
      throw new UnauthorizedError('Invalid MFA code or recovery code');
    }

    // Update lastLoginAt
    userDoc.lastLoginAt = new Date();
    await userDoc.save();

    // Check for active organization membership
    const membership = await this.authRepo.findFirstActiveMembership(userDoc.id);
    const orgId = membership ? membership.organizationId.toString() : '';
    const role = membership ? membership.role : 'none';

    // Generate tokens
    const accessToken = signAccessToken({
      sub: userDoc.id,
      email: userDoc.email,
      orgId,
      role,
    });

    const rawRefreshToken = generateRandomToken();
    const refreshTokenHash = hashSha256(rawRefreshToken);
    const family = crypto.randomUUID();

    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7);

    await this.authRepo.createRefreshToken({
      tokenHash: refreshTokenHash,
      userId: userDoc.id,
      organizationId: orgId ? orgId : '000000000000000000000000',
      family,
      expiresAt,
    });

    return {
      accessToken,
      refreshToken: rawRefreshToken,
      user: userDoc.toJSON() as unknown as User,
    };
  }

  async setupMfa(userId: string): Promise<{ secret: string; qrCodeUrl: string }> {
    const userDoc = await this.authRepo.findUserById(userId);
    if (!userDoc) {
      throw new NotFoundError('User', userId);
    }

    const secret = authenticator.generateSecret();
    const otpauth = authenticator.keyuri(userDoc.email, 'SELADEV', secret);
    const qrCodeUrl = await QRCode.toDataURL(otpauth);

    const encryptedPayload = encryptGcm(secret);
    userDoc.mfaSecret = JSON.stringify(encryptedPayload);
    userDoc.mfaEnabled = false; // Not enabled until activated
    await userDoc.save();

    return { secret, qrCodeUrl };
  }

  async activateMfa(userId: string, token: string): Promise<{ recoveryCodes: string[] }> {
    const userDoc = await this.authRepo.findUserById(userId);
    if (!userDoc) {
      throw new NotFoundError('User', userId);
    }

    if (!userDoc.mfaSecret) {
      throw new ValidationError([], 'MFA setup has not been initiated');
    }

    const encryptedPayload = JSON.parse(userDoc.mfaSecret) as EncryptedPayload;
    const secret = decryptGcm(encryptedPayload);

    const isValid = authenticator.verify({ token, secret });
    if (!isValid) {
      throw new UnauthorizedError('Invalid verification code');
    }

    // Generate 8 backup recovery codes (each 10 hex characters)
    const rawRecoveryCodes = Array.from({ length: 8 }, () => generateRandomToken(5));
    const hashedRecoveryCodes = await Promise.all(
      rawRecoveryCodes.map(code => hashPassword(code))
    );

    userDoc.mfaEnabled = true;
    userDoc.mfaRecoveryCodes = hashedRecoveryCodes;
    await userDoc.save();

    return { recoveryCodes: rawRecoveryCodes };
  }

  async disableMfa(userId: string, token: string): Promise<void> {
    const userDoc = await this.authRepo.findUserById(userId);
    if (!userDoc) {
      throw new NotFoundError('User', userId);
    }

    if (!userDoc.mfaEnabled) {
      throw new ValidationError([], 'MFA is not enabled');
    }

    let verified = false;
    if (userDoc.mfaSecret) {
      const encryptedPayload = JSON.parse(userDoc.mfaSecret) as EncryptedPayload;
      const secret = decryptGcm(encryptedPayload);
      verified = authenticator.verify({ token, secret });
    }

    if (!verified) {
      // Check recovery codes
      for (const hashedCode of userDoc.mfaRecoveryCodes) {
        if (await comparePassword(token, hashedCode)) {
          verified = true;
          break;
        }
      }
    }

    if (!verified) {
      throw new UnauthorizedError('Invalid MFA code or recovery code');
    }

    userDoc.mfaEnabled = false;
    userDoc.mfaSecret = null;
    userDoc.mfaRecoveryCodes = [];
    await userDoc.save();
  }
}

// We import RefreshTokenModel to allow direct update in changePassword, but wait:
// Let's use the DB models directly or add a method in repository to maintain decoupling.
// Let's import RefreshTokenModel.
import { RefreshTokenModel } from '../../infrastructure/database/models/refresh-token.model';
