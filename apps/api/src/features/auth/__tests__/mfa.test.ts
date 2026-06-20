import { describe, it, expect, beforeEach } from 'vitest';
import { AuthService } from '../auth.service';
import type { AuthRepository } from '../auth.repository';
import { authenticator } from 'otplib';
import { decryptGcm } from '../../../lib/crypto';
import { verifyMfaPendingToken } from '../../../lib/jwt';

// Helper to create a mock Mongoose-like User document
function createMockUserDoc(data: any) {
  const doc = {
    id: data.id || 'user-123',
    _id: data.id || 'user-123',
    email: data.email || 'test@example.com',
    passwordHash: data.passwordHash || 'hashed_pwd',
    firstName: data.firstName || 'John',
    lastName: data.lastName || 'Doe',
    isActive: data.isActive !== undefined ? data.isActive : true,
    mfaEnabled: data.mfaEnabled || false,
    mfaSecret: data.mfaSecret || null,
    mfaRecoveryCodes: data.mfaRecoveryCodes || [],
    lastLoginAt: data.lastLoginAt || null,
    save: async function () {
      return this;
    },
    toJSON: function () {
      return {
        id: this.id,
        email: this.email,
        firstName: this.firstName,
        lastName: this.lastName,
        isActive: this.isActive,
        mfaEnabled: this.mfaEnabled,
        lastLoginAt: this.lastLoginAt ? this.lastLoginAt.toISOString() : null,
      };
    },
  };
  return doc as any;
}

class InMemoryAuthRepository implements AuthRepository {
  public users: any[] = [];
  public refreshTokens: any[] = [];
  public memberships: any[] = [];

  async findUserByEmail(email: string): Promise<any | null> {
    const user = this.users.find(u => u.email === email);
    return user ? user : null;
  }

  async findUserById(id: string): Promise<any | null> {
    const user = this.users.find(u => u.id === id);
    return user ? user : null;
  }

  async createUser(data: any): Promise<any> {
    const newUser = createMockUserDoc(data);
    this.users.push(newUser);
    return newUser;
  }

  async createRefreshToken(data: any): Promise<any> {
    const token = {
      ...data,
      id: 'token-123',
      _id: 'token-123',
      isRevoked: false,
      save: async () => token,
      toJSON: () => token,
    };
    this.refreshTokens.push(token);
    return token;
  }

  async findRefreshTokenByHash(tokenHash: string): Promise<any | null> {
    const token = this.refreshTokens.find(t => t.tokenHash === tokenHash);
    return token ? token : null;
  }

  async updateRefreshToken(id: string, update: Partial<any>): Promise<any | null> {
    const tokenIndex = this.refreshTokens.findIndex(t => t.id === id);
    if (tokenIndex === -1) return null;
    this.refreshTokens[tokenIndex] = { ...this.refreshTokens[tokenIndex], ...update };
    return this.refreshTokens[tokenIndex];
  }

  async revokeRefreshTokenFamily(family: string): Promise<void> {
    this.refreshTokens = this.refreshTokens.map(t =>
      t.family === family ? { ...t, isRevoked: true } : t
    );
  }

  async findFirstActiveMembership(userId: string): Promise<any | null> {
    const membership = this.memberships.find(m => m.userId === userId && m.status === 'active');
    return membership ? membership : null;
  }
}

describe('MFA / TOTP Authentication Flows', () => {
  let authRepo: InMemoryAuthRepository;
  let authService: AuthService;

  beforeEach(() => {
    // Provide env vars for tests if not present
    process.env.MASTER_ENCRYPTION_KEY = process.env.MASTER_ENCRYPTION_KEY || 'dummy_master_encryption_key_32_chars_long';
    process.env.JWT_PRIVATE_KEY = process.env.JWT_PRIVATE_KEY || 'test-private-key-dummy-value-placeholder';
    process.env.JWT_PUBLIC_KEY = process.env.JWT_PUBLIC_KEY || 'test-public-key-dummy-value-placeholder';

    authRepo = new InMemoryAuthRepository();
    authService = new AuthService(authRepo);
  });

  it('should generate TOTP secret and QR code during MFA setup', async () => {
    const user = await authRepo.createUser({
      email: 'mfa@example.com',
      passwordHash: 'hashed',
    });

    const setupResult = await authService.setupMfa(user.id);
    expect(setupResult.secret).toBeDefined();
    expect(setupResult.qrCodeUrl).toBeDefined();
    expect(setupResult.qrCodeUrl.startsWith('data:image/png;base64,')).toBe(true);

    const updatedUser = await authRepo.findUserById(user.id);
    expect(updatedUser.mfaSecret).toBeDefined();
    expect(updatedUser.mfaEnabled).toBe(false);

    // Verify secret was encrypted correctly
    const decryptedSecret = decryptGcm(JSON.parse(updatedUser.mfaSecret));
    expect(decryptedSecret).toBe(setupResult.secret);
  });

  it('should activate MFA and generate recovery codes on successful TOTP token verification', async () => {
    const user = await authRepo.createUser({
      email: 'mfa@example.com',
      passwordHash: 'hashed',
    });

    const setupResult = await authService.setupMfa(user.id);
    const token = authenticator.generate(setupResult.secret);

    const activationResult = await authService.activateMfa(user.id, token);
    expect(activationResult.recoveryCodes).toHaveLength(8);
    expect(activationResult.recoveryCodes[0]).toHaveLength(10); // 5 bytes = 10 hex chars

    const updatedUser = await authRepo.findUserById(user.id);
    expect(updatedUser.mfaEnabled).toBe(true);
    expect(updatedUser.mfaRecoveryCodes).toHaveLength(8);
  });

  it('should return mfaPending response during login when MFA is enabled', async () => {
    // 1. Create user and register password hash using bcrypt
    const password = 'Password123!';
    const user = await authService.register({
      firstName: 'John',
      lastName: 'Doe',
      email: 'login-mfa@example.com',
      password,
    });

    // 2. Setup and Enable MFA
    const setupResult = await authService.setupMfa(user.id);
    const token = authenticator.generate(setupResult.secret);
    await authService.activateMfa(user.id, token);

    // 3. Trigger Login
    const loginResult = await authService.login({
      email: 'login-mfa@example.com',
      password,
    });

    expect(loginResult.requiresMfa).toBe(true);
    if (loginResult.requiresMfa) {
      expect(loginResult.mfaToken).toBeDefined();
      const decoded = verifyMfaPendingToken(loginResult.mfaToken);
      expect(decoded.sub).toBe(user.id);
    }
  });

  it('should complete login after verifying TOTP code with mfaPending token', async () => {
    const password = 'Password123!';
    const user = await authService.register({
      firstName: 'John',
      lastName: 'Doe',
      email: 'login-verify@example.com',
      password,
    });

    const setupResult = await authService.setupMfa(user.id);
    const token = authenticator.generate(setupResult.secret);
    await authService.activateMfa(user.id, token);

    const loginResult = await authService.login({
      email: 'login-verify@example.com',
      password,
    });

    expect(loginResult.requiresMfa).toBe(true);
    if (loginResult.requiresMfa) {
      const totpToken = authenticator.generate(setupResult.secret);
      const mfaVerifyResult = await authService.verifyLoginMfa(loginResult.mfaToken, totpToken);
      expect(mfaVerifyResult.accessToken).toBeDefined();
      expect(mfaVerifyResult.refreshToken).toBeDefined();
      expect(mfaVerifyResult.user.id).toBe(user.id);
    }
  });

  it('should allow login using backup recovery codes and invalidate the used code', async () => {
    const password = 'Password123!';
    const user = await authService.register({
      firstName: 'John',
      lastName: 'Doe',
      email: 'login-recovery@example.com',
      password,
    });

    const setupResult = await authService.setupMfa(user.id);
    const token = authenticator.generate(setupResult.secret);
    const { recoveryCodes } = await authService.activateMfa(user.id, token);

    const loginResult = await authService.login({
      email: 'login-recovery@example.com',
      password,
    });

    expect(loginResult.requiresMfa).toBe(true);
    if (loginResult.requiresMfa) {
      const usedRecoveryCode = recoveryCodes[2]!;
      const mfaVerifyResult = await authService.verifyLoginMfa(loginResult.mfaToken, usedRecoveryCode);
      expect(mfaVerifyResult.accessToken).toBeDefined();
      expect(mfaVerifyResult.user.id).toBe(user.id);

      // Verify that recovery codes count is reduced to 7
      const dbUser = await authRepo.findUserById(user.id);
      expect(dbUser.mfaRecoveryCodes).toHaveLength(7);
    }
  });

  it('should disable MFA on request after validating current TOTP token', async () => {
    const user = await authRepo.createUser({
      email: 'disable@example.com',
      passwordHash: 'hashed',
    });

    const setupResult = await authService.setupMfa(user.id);
    const token = authenticator.generate(setupResult.secret);
    await authService.activateMfa(user.id, token);

    const totpToken = authenticator.generate(setupResult.secret);
    await authService.disableMfa(user.id, totpToken);

    const updatedUser = await authRepo.findUserById(user.id);
    expect(updatedUser.mfaEnabled).toBe(false);
    expect(updatedUser.mfaSecret).toBeNull();
    expect(updatedUser.mfaRecoveryCodes).toHaveLength(0);
  });
});
