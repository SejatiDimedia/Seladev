import mongoose, { Schema, Document } from 'mongoose';

export interface SsoConfigDocument extends Document {
  organizationId: mongoose.Types.ObjectId;
  provider: 'saml' | 'oidc';
  isActive: boolean;

  // SAML fields (encrypted GCM)
  samlEntryPointCiphertext?: string;
  samlEntryPointIv?: string;
  samlEntryPointAuthTag?: string;

  samlIssuerCiphertext?: string;
  samlIssuerIv?: string;
  samlIssuerAuthTag?: string;

  samlCertCiphertext?: string;
  samlCertIv?: string;
  samlCertAuthTag?: string;

  // OIDC fields (encrypted GCM)
  oidcClientIdCiphertext?: string;
  oidcClientIdIv?: string;
  oidcClientIdAuthTag?: string;

  oidcClientSecretCiphertext?: string;
  oidcClientSecretIv?: string;
  oidcClientSecretAuthTag?: string;

  oidcIssuerCiphertext?: string;
  oidcIssuerIv?: string;
  oidcIssuerAuthTag?: string;

  createdAt: Date;
  updatedAt: Date;
}

const SsoConfigSchema = new Schema<SsoConfigDocument>(
  {
    organizationId: {
      type: Schema.Types.ObjectId,
      ref: 'Organization',
      required: true,
      unique: true,
      index: true,
    },
    provider: {
      type: String,
      enum: ['saml', 'oidc'],
      required: true,
    },
    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },
    // SAML settings
    samlEntryPointCiphertext: { type: String, default: null },
    samlEntryPointIv: { type: String, default: null },
    samlEntryPointAuthTag: { type: String, default: null },

    samlIssuerCiphertext: { type: String, default: null },
    samlIssuerIv: { type: String, default: null },
    samlIssuerAuthTag: { type: String, default: null },

    samlCertCiphertext: { type: String, default: null },
    samlCertIv: { type: String, default: null },
    samlCertAuthTag: { type: String, default: null },

    // OIDC settings
    oidcClientIdCiphertext: { type: String, default: null },
    oidcClientIdIv: { type: String, default: null },
    oidcClientIdAuthTag: { type: String, default: null },

    oidcClientSecretCiphertext: { type: String, default: null },
    oidcClientSecretIv: { type: String, default: null },
    oidcClientSecretAuthTag: { type: String, default: null },

    oidcIssuerCiphertext: { type: String, default: null },
    oidcIssuerIv: { type: String, default: null },
    oidcIssuerAuthTag: { type: String, default: null },
  },
  {
    timestamps: true,
    toJSON: {
      transform: (_doc, ret) => {
        const obj = ret as any;
        obj.id = obj._id.toString();
        obj.organizationId = obj.organizationId.toString();
        delete obj._id;
        delete obj.__v;
        // Don't expose GCM secrets in standard serialization
        delete obj.samlEntryPointCiphertext;
        delete obj.samlEntryPointIv;
        delete obj.samlEntryPointAuthTag;
        delete obj.samlIssuerCiphertext;
        delete obj.samlIssuerIv;
        delete obj.samlIssuerAuthTag;
        delete obj.samlCertCiphertext;
        delete obj.samlCertIv;
        delete obj.samlCertAuthTag;
        delete obj.oidcClientIdCiphertext;
        delete obj.oidcClientIdIv;
        delete obj.oidcClientIdAuthTag;
        delete obj.oidcClientSecretCiphertext;
        delete obj.oidcClientSecretIv;
        delete obj.oidcClientSecretAuthTag;
        delete obj.oidcIssuerCiphertext;
        delete obj.oidcIssuerIv;
        delete obj.oidcIssuerAuthTag;
        return obj;
      },
    },
  }
);

export const SsoConfigModel = mongoose.model<SsoConfigDocument>('SsoConfig', SsoConfigSchema);
