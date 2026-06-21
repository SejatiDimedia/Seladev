import type { SsoConfigDocument } from '../../infrastructure/database/models/sso-config.model';

export interface CreateSsoConfigDto {
  provider: 'saml' | 'oidc';
  samlEntryPoint?: string | undefined;
  samlIssuer?: string | undefined;
  samlCert?: string | undefined;
  oidcClientId?: string | undefined;
  oidcClientSecret?: string | undefined;
  oidcIssuer?: string | undefined;
}

export interface UpdateSsoConfigDto {
  isActive?: boolean | undefined;
  samlEntryPoint?: string | undefined;
  samlIssuer?: string | undefined;
  samlCert?: string | undefined;
  oidcClientId?: string | undefined;
  oidcClientSecret?: string | undefined;
  oidcIssuer?: string | undefined;
}

export interface SsoRepository {
  findConfigByOrgId(orgId: string): Promise<SsoConfigDocument | null>;
  createConfig(orgId: string, data: Partial<SsoConfigDocument>): Promise<SsoConfigDocument>;
  updateConfig(orgId: string, update: Partial<SsoConfigDocument>): Promise<SsoConfigDocument | null>;
  deleteConfig(orgId: string): Promise<boolean>;
}
