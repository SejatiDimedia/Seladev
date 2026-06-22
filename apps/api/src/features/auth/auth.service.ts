import crypto from 'crypto';
import type { AuthRepository } from './auth.repository';
import type { RegisterDto, LoginDto, PasswordChangeDto, User } from './auth.types';
import { hashPassword, comparePassword, generateRandomToken, hashSha256, encryptGcm, decryptGcm, type EncryptedPayload } from '../../lib/crypto';
import { signAccessToken, signMfaPendingToken, verifyMfaPendingToken } from '../../lib/jwt';
import { ConflictError, UnauthorizedError, NotFoundError, ValidationError, ForbiddenError } from '../../lib/errors';
import { authenticator } from 'otplib';
import QRCode from 'qrcode';
import type { AuditLogsService } from '../audit-logs/audit-logs.service';
import { RefreshTokenModel } from '../../infrastructure/database/models/refresh-token.model';

export class AuthService {
  constructor(
    private readonly authRepo: AuthRepository,
    private readonly auditLogsService?: AuditLogsService
  ) {}

  private getOrgId(membership: any): string {
    if (!membership) return '';
    const org = membership.organizationId;
    if (!org) return '';
    return typeof org === 'object' && '_id' in org ? org._id.toString() : org.toString();
  }

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
      password: dto.password,
      passwordHash,
    });

    return userDoc.toJSON() as unknown as User;
  }

  async login(
    dto: LoginDto,
    clientContext?: { ipAddress: string | null; userAgent: string | null }
  ): Promise<
    | { requiresMfa: false; accessToken: string; refreshToken: string; user: User }
    | { requiresMfa: true; mfaToken: string; user: User }
  > {
    const userDoc = await this.authRepo.findUserByEmail(dto.email);
    if (!userDoc || !userDoc.isActive) {
      if (this.auditLogsService) {
        this.auditLogsService.record({
          organizationId: '000000000000000000000000',
          action: 'auth.login_failed',
          actor: {
            userId: null,
            email: dto.email,
            ipAddress: clientContext?.ipAddress || null,
            userAgent: clientContext?.userAgent || null,
          },
          resource: { type: 'auth', id: 'system', name: 'login' },
          outcome: 'failure',
          metadata: { reason: 'User not found or inactive' },
        });
      }
      throw new UnauthorizedError('Invalid credentials', 'INVALID_CREDENTIALS');
    }
    
    // Check if user's domain is configured for SSO
    const emailParts = userDoc.email.split('@');
    const domain = (emailParts[1] || '').toLowerCase();
    const ssoConfig = await this.authRepo.findSsoConfigByDomain(domain);
    if (ssoConfig) {
      if (this.auditLogsService) {
        await this.auditLogsService.record({
          organizationId: ssoConfig.organizationId,
          action: 'auth.login_failed',
          actor: {
            userId: userDoc.id,
            email: userDoc.email,
            ipAddress: clientContext?.ipAddress || null,
            userAgent: clientContext?.userAgent || null,
          },
          resource: { type: 'auth', id: userDoc.id, name: userDoc.email },
          outcome: 'failure',
          metadata: { reason: 'Password login disabled: SSO is required for this email domain' },
        }).catch(err => console.error('Failed to log audit:', err));
      }
      throw new UnauthorizedError('Password login is disabled. Please use Single Sign-On (SSO).', 'SSO_REQUIRED');
    }

    const isPasswordValid = await comparePassword(dto.password, userDoc.passwordHash);
    if (!isPasswordValid) {
      if (this.auditLogsService) {
        const membership = await this.authRepo.findFirstActiveMembership(userDoc.id);
        const orgId = this.getOrgId(membership) || '000000000000000000000000';
        this.auditLogsService.record({
          organizationId: orgId,
          action: 'auth.login_failed',
          actor: {
            userId: userDoc.id,
            email: userDoc.email,
            ipAddress: clientContext?.ipAddress || null,
            userAgent: clientContext?.userAgent || null,
          },
          resource: { type: 'auth', id: userDoc.id, name: userDoc.email },
          outcome: 'failure',
          metadata: { reason: 'Incorrect password' },
        });
      }
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
    const orgId = this.getOrgId(membership);
    const role = membership ? membership.role : 'none';

    // Generate tokens
    const accessToken = signAccessToken({
      sub: userDoc.id,
      email: userDoc.email,
      orgId,
      role,
      isPlatformAdmin: userDoc.isPlatformAdmin || false,
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

    if (this.auditLogsService && orgId) {
      this.auditLogsService.record({
        organizationId: orgId,
        action: 'auth.login',
        actor: {
          userId: userDoc.id,
          email: userDoc.email,
          ipAddress: clientContext?.ipAddress || null,
          userAgent: clientContext?.userAgent || null,
        },
        resource: { type: 'auth', id: userDoc.id, name: userDoc.email },
        outcome: 'success',
      });
    }

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

    if (new Date() > tokenDoc.expiresAt) {
      throw new UnauthorizedError('Refresh token expired', 'REFRESH_TOKEN_EXPIRED');
    }

    if (tokenDoc.isRevoked) {
      await this.authRepo.revokeRefreshTokenFamily(tokenDoc.family);
      throw new UnauthorizedError('Refresh token reuse detected. Revoking session.', 'REFRESH_TOKEN_REUSED');
    }

    const userDoc = await this.authRepo.findUserById(tokenDoc.userId.toString());
    if (!userDoc || !userDoc.isActive) {
      throw new UnauthorizedError('User session invalid', 'TOKEN_INVALID');
    }

    const rawNewToken = generateRandomToken();
    const newTokenHash = hashSha256(rawNewToken);

    tokenDoc.isRevoked = true;
    tokenDoc.replacedByHash = newTokenHash;
    await tokenDoc.save();

    const membership = await this.authRepo.findFirstActiveMembership(userDoc.id);
    const orgId = this.getOrgId(membership);
    const role = membership ? membership.role : 'none';

    const accessToken = signAccessToken({
      sub: userDoc.id,
      email: userDoc.email,
      orgId,
      role,
      isPlatformAdmin: userDoc.isPlatformAdmin || false,
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

  async logout(
    refreshToken: string,
    clientContext?: { ipAddress: string | null; userAgent: string | null }
  ): Promise<void> {
    const tokenHash = hashSha256(refreshToken);
    const tokenDoc = await this.authRepo.findRefreshTokenByHash(tokenHash);
    if (!tokenDoc) return;

    await this.authRepo.revokeRefreshTokenFamily(tokenDoc.family);

    if (this.auditLogsService) {
      const user = await this.authRepo.findUserById(tokenDoc.userId.toString());
      this.auditLogsService.record({
        organizationId: tokenDoc.organizationId.toString(),
        action: 'auth.logout',
        actor: {
          userId: tokenDoc.userId.toString(),
          email: user ? user.email : 'unknown-user',
          ipAddress: clientContext?.ipAddress || null,
          userAgent: clientContext?.userAgent || null,
        },
        resource: { type: 'auth', id: tokenDoc.userId.toString(), name: user ? user.email : 'logout' },
        outcome: 'success',
      });
    }
  }

  async changePassword(
    userId: string,
    dto: PasswordChangeDto,
    clientContext?: { ipAddress: string | null; userAgent: string | null }
  ): Promise<void> {
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

    await RefreshTokenModel.updateMany({ userId: userDoc._id }, { isRevoked: true }).exec();

    if (this.auditLogsService) {
      const membership = await this.authRepo.findFirstActiveMembership(userId);
      const orgId = this.getOrgId(membership) || '000000000000000000000000';
      this.auditLogsService.record({
        organizationId: orgId,
        action: 'auth.password_changed',
        actor: {
          userId,
          email: userDoc.email,
          ipAddress: clientContext?.ipAddress || null,
          userAgent: clientContext?.userAgent || null,
        },
        resource: { type: 'auth', id: userId, name: userDoc.email },
        outcome: 'success',
      });
    }
  }

  async verifyLoginMfa(
    mfaToken: string,
    token: string,
    clientContext?: { ipAddress: string | null; userAgent: string | null }
  ): Promise<{ accessToken: string; refreshToken: string; user: User }> {
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
      for (const hashedCode of userDoc.mfaRecoveryCodes) {
        if (await comparePassword(token, hashedCode)) {
          userDoc.mfaRecoveryCodes = userDoc.mfaRecoveryCodes.filter(c => c !== hashedCode);
          verified = true;
          break;
        }
      }
    }

    if (!verified) {
      throw new UnauthorizedError('Invalid MFA code or recovery code');
    }

    userDoc.lastLoginAt = new Date();
    await userDoc.save();

    const membership = await this.authRepo.findFirstActiveMembership(userDoc.id);
    const orgId = this.getOrgId(membership);
    const role = membership ? membership.role : 'none';

    const accessToken = signAccessToken({
      sub: userDoc.id,
      email: userDoc.email,
      orgId,
      role,
      isPlatformAdmin: userDoc.isPlatformAdmin || false,
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

    if (this.auditLogsService && orgId) {
      this.auditLogsService.record({
        organizationId: orgId,
        action: 'auth.login',
        actor: {
          userId: userDoc.id,
          email: userDoc.email,
          ipAddress: clientContext?.ipAddress || null,
          userAgent: clientContext?.userAgent || null,
        },
        resource: { type: 'auth', id: userDoc.id, name: userDoc.email },
        outcome: 'success',
        metadata: { mfaUsed: true },
      });
    }

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
    userDoc.mfaEnabled = false;
    await userDoc.save();

    return { secret, qrCodeUrl };
  }

  async activateMfa(
    userId: string,
    token: string,
    clientContext?: { ipAddress: string | null; userAgent: string | null }
  ): Promise<{ recoveryCodes: string[] }> {
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

    const rawRecoveryCodes = Array.from({ length: 8 }, () => generateRandomToken(5));
    const hashedRecoveryCodes = await Promise.all(
      rawRecoveryCodes.map(code => hashPassword(code))
    );

    userDoc.mfaEnabled = true;
    userDoc.mfaRecoveryCodes = hashedRecoveryCodes;
    await userDoc.save();

    if (this.auditLogsService) {
      const membership = await this.authRepo.findFirstActiveMembership(userId);
      const orgId = this.getOrgId(membership) || '000000000000000000000000';
      this.auditLogsService.record({
        organizationId: orgId,
        action: 'auth.mfa.enabled',
        actor: {
          userId,
          email: userDoc.email,
          ipAddress: clientContext?.ipAddress || null,
          userAgent: clientContext?.userAgent || null,
        },
        resource: { type: 'auth', id: userId, name: userDoc.email },
        outcome: 'success',
      });
    }

    return { recoveryCodes: rawRecoveryCodes };
  }

  async disableMfa(
    userId: string,
    token: string,
    clientContext?: { ipAddress: string | null; userAgent: string | null }
  ): Promise<void> {
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

    if (this.auditLogsService) {
      const membership = await this.authRepo.findFirstActiveMembership(userId);
      const orgId = this.getOrgId(membership) || '000000000000000000000000';
      this.auditLogsService.record({
        organizationId: orgId,
        action: 'auth.mfa.disabled',
        actor: {
          userId,
          email: userDoc.email,
          ipAddress: clientContext?.ipAddress || null,
          userAgent: clientContext?.userAgent || null,
        },
        resource: { type: 'auth', id: userId, name: userDoc.email },
        outcome: 'success',
      });
    }
  }

  async switchOrg(
    userId: string,
    orgId: string,
    clientContext?: { ipAddress: string | null; userAgent: string | null }
  ): Promise<{ accessToken: string; refreshToken: string; user: any }> {
    const userDoc = await this.authRepo.findUserById(userId);
    if (!userDoc || !userDoc.isActive) {
      throw new UnauthorizedError('User session invalid', 'TOKEN_INVALID');
    }

    const membership = await this.authRepo.findActiveMembership(userId, orgId);
    if (!membership) {
      throw new ForbiddenError('User is not an active member of this organization');
    }

    // Generate new tokens
    const accessToken = signAccessToken({
      sub: userDoc.id,
      email: userDoc.email,
      orgId: orgId,
      role: membership.role,
      isPlatformAdmin: userDoc.isPlatformAdmin || false,
    });

    const rawRefreshToken = generateRandomToken();
    const refreshTokenHash = hashSha256(rawRefreshToken);
    const family = crypto.randomUUID();

    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7);

    await this.authRepo.createRefreshToken({
      tokenHash: refreshTokenHash,
      userId: userDoc.id,
      organizationId: orgId,
      family,
      expiresAt,
    });

    // Record audit log for switching org
    if (this.auditLogsService) {
      await this.auditLogsService.record({
        organizationId: orgId,
        action: 'auth.switch_org',
        actor: {
          userId: userDoc.id,
          email: userDoc.email,
          ipAddress: clientContext?.ipAddress || null,
          userAgent: clientContext?.userAgent || null,
        },
        resource: { type: 'organization', id: orgId, name: (membership.organizationId as any).name || orgId },
        outcome: 'success',
        metadata: { role: membership.role },
      }).catch(err => console.error('Failed to log audit switch_org:', err));
    }

    return {
      accessToken,
      refreshToken: rawRefreshToken,
      user: userDoc.toJSON(),
    };
  }
}
