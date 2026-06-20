import crypto from 'crypto';
import type { AuthRepository } from './auth.repository';
import type { RegisterDto, LoginDto, PasswordChangeDto, User } from './auth.types';
import { hashPassword, comparePassword, generateRandomToken, hashSha256 } from '../../lib/crypto';
import { signAccessToken } from '../../lib/jwt';
import { ConflictError, UnauthorizedError, NotFoundError } from '../../lib/errors';

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

  async login(dto: LoginDto): Promise<{ accessToken: string; refreshToken: string; user: User }> {
    const userDoc = await this.authRepo.findUserByEmail(dto.email);
    if (!userDoc || !userDoc.isActive) {
      throw new UnauthorizedError('Invalid credentials', 'INVALID_CREDENTIALS');
    }

    const isPasswordValid = await comparePassword(dto.password, userDoc.passwordHash);
    if (!isPasswordValid) {
      throw new UnauthorizedError('Invalid credentials', 'INVALID_CREDENTIALS');
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
}

// We import RefreshTokenModel to allow direct update in changePassword, but wait:
// Let's use the DB models directly or add a method in repository to maintain decoupling.
// Let's import RefreshTokenModel.
import { RefreshTokenModel } from '../../infrastructure/database/models/refresh-token.model';
