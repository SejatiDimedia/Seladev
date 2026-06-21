import crypto from 'crypto';
import type { SsoRepository, CreateSsoConfigDto, UpdateSsoConfigDto } from './sso.types';
import type { SsoConfigDocument } from '../../infrastructure/database/models/sso-config.model';
import { OrganizationModel } from '../../infrastructure/database/models/organization.model';
import { UserModel } from '../../infrastructure/database/models/user.model';
import { MembershipModel } from '../../infrastructure/database/models/membership.model';
import { RefreshTokenModel } from '../../infrastructure/database/models/refresh-token.model';
import { encryptGcm, decryptGcm, generateRandomToken, hashSha256 } from '../../lib/crypto';
import { signAccessToken } from '../../lib/jwt';
import { getRedisClient } from '../../config/redis';
import type { AuditLogsService } from '../audit-logs/audit-logs.service';
import { NotFoundError, ValidationError, UnauthorizedError } from '../../lib/errors';
import mongoose from 'mongoose';
import * as samlify from 'samlify';
import jwt from 'jsonwebtoken';

export class SsoService {
  constructor(
    private readonly ssoRepo: SsoRepository,
    private readonly auditLogsService?: AuditLogsService
  ) {}

  // 1. Manage Configuration
  async createSsoConfig(orgId: string, userId: string, dto: CreateSsoConfigDto): Promise<SsoConfigDocument> {
    const existing = await this.ssoRepo.findConfigByOrgId(orgId);
    if (existing) {
      throw new ValidationError([], 'SSO configuration already exists for this organization');
    }

    const encryptedData: Partial<SsoConfigDocument> = {
      provider: dto.provider,
      isActive: true,
    };

    if (dto.provider === 'saml') {
      if (!dto.samlEntryPoint || !dto.samlIssuer || !dto.samlCert) {
        throw new ValidationError([], 'SAML entryPoint, issuer, and cert are required');
      }
      const entryPointEnc = encryptGcm(dto.samlEntryPoint, orgId);
      encryptedData.samlEntryPointCiphertext = entryPointEnc.ciphertext;
      encryptedData.samlEntryPointIv = entryPointEnc.iv;
      encryptedData.samlEntryPointAuthTag = entryPointEnc.authTag;

      const issuerEnc = encryptGcm(dto.samlIssuer, orgId);
      encryptedData.samlIssuerCiphertext = issuerEnc.ciphertext;
      encryptedData.samlIssuerIv = issuerEnc.iv;
      encryptedData.samlIssuerAuthTag = issuerEnc.authTag;

      const certEnc = encryptGcm(dto.samlCert, orgId);
      encryptedData.samlCertCiphertext = certEnc.ciphertext;
      encryptedData.samlCertIv = certEnc.iv;
      encryptedData.samlCertAuthTag = certEnc.authTag;
    } else {
      if (!dto.oidcClientId || !dto.oidcClientSecret || !dto.oidcIssuer) {
        throw new ValidationError([], 'OIDC clientId, clientSecret, and issuer are required');
      }
      const clientIdEnc = encryptGcm(dto.oidcClientId, orgId);
      encryptedData.oidcClientIdCiphertext = clientIdEnc.ciphertext;
      encryptedData.oidcClientIdIv = clientIdEnc.iv;
      encryptedData.oidcClientIdAuthTag = clientIdEnc.authTag;

      const clientSecretEnc = encryptGcm(dto.oidcClientSecret, orgId);
      encryptedData.oidcClientSecretCiphertext = clientSecretEnc.ciphertext;
      encryptedData.oidcClientSecretIv = clientSecretEnc.iv;
      encryptedData.oidcClientSecretAuthTag = clientSecretEnc.authTag;

      const issuerEnc = encryptGcm(dto.oidcIssuer, orgId);
      encryptedData.oidcIssuerCiphertext = issuerEnc.ciphertext;
      encryptedData.oidcIssuerIv = issuerEnc.iv;
      encryptedData.oidcIssuerAuthTag = issuerEnc.authTag;
    }

    const config = await this.ssoRepo.createConfig(orgId, encryptedData);

    if (this.auditLogsService) {
      await this.auditLogsService.record({
        organizationId: orgId,
        action: 'sso.config_created',
        actor: { userId, email: '', ipAddress: null, userAgent: 'system' },
        resource: { type: 'sso_config', id: config.id, name: dto.provider },
        outcome: 'success',
      }).catch(err => console.error('Failed to log audit:', err));
    }

    return config;
  }

  async getSsoConfig(orgId: string): Promise<SsoConfigDocument> {
    const config = await this.ssoRepo.findConfigByOrgId(orgId);
    if (!config) {
      throw new NotFoundError('SSO configuration');
    }
    return config;
  }

  async updateSsoConfig(orgId: string, userId: string, dto: UpdateSsoConfigDto): Promise<SsoConfigDocument> {
    const config = await this.getSsoConfig(orgId);

    const updateData: Partial<SsoConfigDocument> = {};
    if (dto.isActive !== undefined) updateData.isActive = dto.isActive;

    if (config.provider === 'saml') {
      if (dto.samlEntryPoint) {
        const enc = encryptGcm(dto.samlEntryPoint, orgId);
        updateData.samlEntryPointCiphertext = enc.ciphertext;
        updateData.samlEntryPointIv = enc.iv;
        updateData.samlEntryPointAuthTag = enc.authTag;
      }
      if (dto.samlIssuer) {
        const enc = encryptGcm(dto.samlIssuer, orgId);
        updateData.samlIssuerCiphertext = enc.ciphertext;
        updateData.samlIssuerIv = enc.iv;
        updateData.samlIssuerAuthTag = enc.authTag;
      }
      if (dto.samlCert) {
        const enc = encryptGcm(dto.samlCert, orgId);
        updateData.samlCertCiphertext = enc.ciphertext;
        updateData.samlCertIv = enc.iv;
        updateData.samlCertAuthTag = enc.authTag;
      }
    } else {
      if (dto.oidcClientId) {
        const enc = encryptGcm(dto.oidcClientId, orgId);
        updateData.oidcClientIdCiphertext = enc.ciphertext;
        updateData.oidcClientIdIv = enc.iv;
        updateData.oidcClientIdAuthTag = enc.authTag;
      }
      if (dto.oidcClientSecret) {
        const enc = encryptGcm(dto.oidcClientSecret, orgId);
        updateData.oidcClientSecretCiphertext = enc.ciphertext;
        updateData.oidcClientSecretIv = enc.iv;
        updateData.oidcClientSecretAuthTag = enc.authTag;
      }
      if (dto.oidcIssuer) {
        const enc = encryptGcm(dto.oidcIssuer, orgId);
        updateData.oidcIssuerCiphertext = enc.ciphertext;
        updateData.oidcIssuerIv = enc.iv;
        updateData.oidcIssuerAuthTag = enc.authTag;
      }
    }

    const updated = await this.ssoRepo.updateConfig(orgId, updateData);
    if (!updated) throw new NotFoundError('SSO configuration');

    if (this.auditLogsService) {
      await this.auditLogsService.record({
        organizationId: orgId,
        action: 'sso.config_updated',
        actor: { userId, email: '', ipAddress: null, userAgent: 'system' },
        resource: { type: 'sso_config', id: config.id, name: config.provider },
        outcome: 'success',
      }).catch(err => console.error('Failed to log audit:', err));
    }

    return updated;
  }

  async deleteSsoConfig(orgId: string, userId: string): Promise<void> {
    const config = await this.getSsoConfig(orgId);
    await this.ssoRepo.deleteConfig(orgId);

    if (this.auditLogsService) {
      await this.auditLogsService.record({
        organizationId: orgId,
        action: 'sso.config_deleted',
        actor: { userId, email: '', ipAddress: null, userAgent: 'system' },
        resource: { type: 'sso_config', id: config.id, name: config.provider },
        outcome: 'success',
      }).catch(err => console.error('Failed to log audit:', err));
    }
  }

  // 2. Discover SSO
  async discoverSso(identifier: string): Promise<{ ssoEnabled: boolean; provider?: 'saml' | 'oidc'; orgId?: string }> {
    let org: any = null;

    if (identifier.includes('@')) {
      const parts = identifier.split('@');
      const domain = (parts[1] || '').toLowerCase();
      org = await OrganizationModel.findOne({ 'settings.allowedDomains': domain }).exec();
    } else {
      org = await OrganizationModel.findOne({ slug: identifier.toLowerCase() }).exec();
    }

    if (!org) {
      return { ssoEnabled: false };
    }

    const ssoConfig = await this.ssoRepo.findConfigByOrgId(org.id);
    if (!ssoConfig || !ssoConfig.isActive) {
      return { ssoEnabled: false };
    }

    return {
      ssoEnabled: true,
      provider: ssoConfig.provider,
      orgId: org.id,
    };
  }

  // Helper to decrypt SAML config
  getDecryptedSamlConfig(config: SsoConfigDocument, orgId: string) {
    return {
      entryPoint: decryptGcm({
        ciphertext: config.samlEntryPointCiphertext!,
        iv: config.samlEntryPointIv!,
        authTag: config.samlEntryPointAuthTag!,
      }, orgId),
      issuer: decryptGcm({
        ciphertext: config.samlIssuerCiphertext!,
        iv: config.samlIssuerIv!,
        authTag: config.samlIssuerAuthTag!,
      }, orgId),
      cert: decryptGcm({
        ciphertext: config.samlCertCiphertext!,
        iv: config.samlCertIv!,
        authTag: config.samlCertAuthTag!,
      }, orgId),
    };
  }

  // Helper to decrypt OIDC config
  getDecryptedOidcConfig(config: SsoConfigDocument, orgId: string) {
    return {
      clientId: decryptGcm({
        ciphertext: config.oidcClientIdCiphertext!,
        iv: config.oidcClientIdIv!,
        authTag: config.oidcClientIdAuthTag!,
      }, orgId),
      clientSecret: decryptGcm({
        ciphertext: config.oidcClientSecretCiphertext!,
        iv: config.oidcClientSecretIv!,
        authTag: config.oidcClientSecretAuthTag!,
      }, orgId),
      issuer: decryptGcm({
        ciphertext: config.oidcIssuerCiphertext!,
        iv: config.oidcIssuerIv!,
        authTag: config.oidcIssuerAuthTag!,
      }, orgId),
    };
  }

  // 3. Initiate SAML Login
  async initiateSamlLogin(orgId: string): Promise<string> {
    const config = await this.getSsoConfig(orgId);
    if (!config.isActive || config.provider !== 'saml') {
      throw new ValidationError([], 'SAML is not active for this organization');
    }

    const decrypted = this.getDecryptedSamlConfig(config, orgId);

    const sp = samlify.ServiceProvider({
      entityID: `https://api.seladev.com/api/v1/auth/sso/metadata/${orgId}`,
      assertionConsumerService: [
        {
          Binding: 'urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST',
          Location: `https://api.seladev.com/api/v1/auth/sso/callback/saml/${orgId}`,
        },
      ],
    });

    const idp = samlify.IdentityProvider({
      entityID: decrypted.issuer,
      singleSignOnService: [
        {
          Binding: 'urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect',
          Location: decrypted.entryPoint,
        },
      ],
      signingCert: decrypted.cert,
    });

    const { context } = sp.createLoginRequest(idp, 'redirect');
    return context; // Redirection URL with SAMLRequest query param
  }

  // Helper parser method so we can mock/override it in test suites
  async parseAndVerifySaml(orgId: string, samlResponseBase64: string, decryptedConfig: any): Promise<{ email: string; firstName: string; lastName: string }> {
    const sp = samlify.ServiceProvider({
      entityID: `https://api.seladev.com/api/v1/auth/sso/metadata/${orgId}`,
      assertionConsumerService: [
        {
          Binding: 'urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST',
          Location: `https://api.seladev.com/api/v1/auth/sso/callback/saml/${orgId}`,
        },
      ],
    });

    const idp = samlify.IdentityProvider({
      entityID: decryptedConfig.issuer,
      singleSignOnService: [
        {
          Binding: 'urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect',
          Location: decryptedConfig.entryPoint,
        },
      ],
      signingCert: decryptedConfig.cert,
    });

    const { extract } = await sp.parseLoginResponse(idp, 'post', {
      body: { SAMLResponse: samlResponseBase64 },
    });

    // Extract user profile from SAML response attributes safely
    const attributes = extract.attributes || {};
    const rawEmail = attributes.email || extract.nameID || '';
    const email = Array.isArray(rawEmail) ? String(rawEmail[0]) : String(rawEmail);

    const rawFirstName = attributes.firstName || '';
    const firstName = Array.isArray(rawFirstName) ? String(rawFirstName[0]) : String(rawFirstName);

    const rawLastName = attributes.lastName || '';
    const lastName = Array.isArray(rawLastName) ? String(rawLastName[0]) : String(rawLastName);

    if (!email) {
      throw new UnauthorizedError('SAML response does not contain user email');
    }

    return { email, firstName, lastName };
  }

  // 4. Handle SAML Callback
  async handleSamlCallback(
    orgId: string,
    samlResponse: string,
    clientContext?: { ipAddress: string | null; userAgent: string | null }
  ): Promise<{ accessToken: string; refreshToken: string; user: any }> {
    const config = await this.getSsoConfig(orgId);
    if (!config.isActive || config.provider !== 'saml') {
      throw new ValidationError([], 'SAML is not active for this organization');
    }

    const decrypted = this.getDecryptedSamlConfig(config, orgId);

    const profile = await this.parseAndVerifySaml(orgId, samlResponse, decrypted);

    return this.handleSsoUserLogin(orgId, profile.email, profile.firstName, profile.lastName, 'saml', clientContext);
  }

  // 5. Initiate OIDC Login
  async initiateOidcLogin(orgId: string): Promise<string> {
    const config = await this.getSsoConfig(orgId);
    if (!config.isActive || config.provider !== 'oidc') {
      throw new ValidationError([], 'OIDC is not active for this organization');
    }

    const decrypted = this.getDecryptedOidcConfig(config, orgId);

    // Generate secure CSRF state
    const state = generateRandomToken(16);

    // Store state mapping in Redis (15 minutes TTL)
    const redis = getRedisClient();
    await redis.set(`sso:state:${state}`, orgId, { EX: 900 });

    const redirectUri = 'http://localhost:4000/api/v1/auth/sso/callback/oidc';
    
    // Build generic OIDC Auth endpoint URL
    const authUrl = `${decrypted.issuer}/authorize?client_id=${encodeURIComponent(
      decrypted.clientId
    )}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=openid%20email%20profile&state=${state}`;

    return authUrl;
  }

  // 6. Handle OIDC Callback
  async handleOidcCallback(
    code: string,
    state: string,
    clientContext?: { ipAddress: string | null; userAgent: string | null }
  ): Promise<{ accessToken: string; refreshToken: string; user: any }> {
    // 1. Verify CSRF State
    const redis = getRedisClient();
    const orgId = await redis.get(`sso:state:${state}`);
    if (!orgId) {
      throw new UnauthorizedError('Invalid or expired OIDC state parameter (CSRF protection)', 'SSO_CSRF_ERROR');
    }
    // Delete state after validation
    await redis.del(`sso:state:${state}`);

    const config = await this.getSsoConfig(orgId);
    const decrypted = this.getDecryptedOidcConfig(config, orgId);

    // 2. Exchange code for token
    const tokenUrl = `${decrypted.issuer}/token`;
    const redirectUri = 'http://localhost:4000/api/v1/auth/sso/callback/oidc';

    const response = await fetch(tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        code,
        client_id: decrypted.clientId,
        client_secret: decrypted.clientSecret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }).toString(),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new UnauthorizedError(`Failed to exchange OIDC code: ${errorText}`, 'OIDC_CODE_EXCHANGE_FAILED');
    }

    const tokenData = await response.json() as { id_token: string };
    const idToken = tokenData.id_token;
    if (!idToken) {
      throw new UnauthorizedError('OIDC provider did not return an id_token', 'OIDC_NO_ID_TOKEN');
    }

    // 3. Decode JWT and extract user info
    const payload = jwt.decode(idToken) as any;
    if (!payload || !payload.email) {
      throw new UnauthorizedError('Invalid OIDC ID token payload', 'OIDC_INVALID_PAYLOAD');
    }

    const email = payload.email.toLowerCase();
    const firstName = payload.given_name || payload.name?.split(' ')[0] || '';
    const lastName = payload.family_name || payload.name?.split(' ').slice(1).join(' ') || '';

    return this.handleSsoUserLogin(orgId, email, firstName, lastName, 'oidc', clientContext);
  }

  // 7. Core SSO Login handler & JIT Provisioning
  private async handleSsoUserLogin(
    orgId: string,
    email: string,
    firstName: string,
    lastName: string,
    provider: 'saml' | 'oidc',
    clientContext?: { ipAddress: string | null; userAgent: string | null }
  ): Promise<{ accessToken: string; refreshToken: string; user: any }> {
    const resolvedEmail = email.toLowerCase();
    let user = await UserModel.findOne({ email: resolvedEmail }).exec();

    let isNewUser = false;
    if (!user) {
      // Just-In-Time Provisioning
      isNewUser = true;
      user = await UserModel.create({
        email: resolvedEmail,
        firstName: firstName || 'SSO',
        lastName: lastName || 'User',
        passwordHash: `sso-only:${provider}:${generateRandomToken(16)}`, // bypass traditional password logins
        mfaEnabled: false,
        isActive: true,
      });
    }

    if (!user.isActive) {
      throw new UnauthorizedError('User account is deactivated', 'USER_DEACTIVATED');
    }

    // Check Organization membership
    let membership = await MembershipModel.findOne({
      organizationId: new mongoose.Types.ObjectId(orgId),
      userId: user._id,
    }).exec();

    if (!membership) {
      // JIT Provisioning org membership: Default to 'member'
      membership = await MembershipModel.create({
        organizationId: new mongoose.Types.ObjectId(orgId),
        userId: user._id,
        role: 'member',
        invitedBy: user._id, // JIT invited by self
        status: 'active',
        joinedAt: new Date(),
      });
    } else if (membership.status !== 'active') {
      // Activate invited memberships on successful SSO login
      membership.status = 'active';
      membership.joinedAt = new Date();
      await membership.save();
    }

    // Update lastLoginAt
    user.lastLoginAt = new Date();
    await user.save();

    // Generate login tokens
    const accessToken = signAccessToken({
      sub: user.id,
      email: user.email,
      orgId,
      role: membership.role,
    });

    const rawRefreshToken = generateRandomToken();
    const refreshTokenHash = hashSha256(rawRefreshToken);
    const family = crypto.randomUUID();

    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7);

    // Write refresh token to DB
    await RefreshTokenModel.create({
      tokenHash: refreshTokenHash,
      userId: user._id,
      organizationId: new mongoose.Types.ObjectId(orgId),
      family,
      expiresAt,
    });

    // Record Audit Log
    if (this.auditLogsService) {
      await this.auditLogsService.record({
        organizationId: orgId,
        action: 'auth.login',
        actor: {
          userId: user.id,
          email: user.email,
          ipAddress: clientContext?.ipAddress || null,
          userAgent: clientContext?.userAgent || null,
        },
        resource: { type: 'auth', id: user.id, name: user.email },
        outcome: 'success',
        metadata: { provider, isNewUser },
      }).catch(err => console.error('Failed to log audit:', err));
    }

    return {
      accessToken,
      refreshToken: rawRefreshToken,
      user: user.toJSON(),
    };
  }

  // 8. Generate SAML SP Metadata
  async getSamlSpMetadata(orgId: string): Promise<string> {
    const sp = samlify.ServiceProvider({
      entityID: `https://api.seladev.com/api/v1/auth/sso/metadata/${orgId}`,
      assertionConsumerService: [
        {
          Binding: 'urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST',
          Location: `https://api.seladev.com/api/v1/auth/sso/callback/saml/${orgId}`,
        },
      ],
    });

    return sp.getMetadata();
  }
}
