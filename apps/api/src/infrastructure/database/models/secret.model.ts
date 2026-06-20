import mongoose, { Schema, Document } from 'mongoose';
import type { Secret } from '@seladev/types';

export interface SecretDocument extends Omit<Secret, 'id' | 'environmentId' | 'projectId' | 'organizationId' | 'createdBy' | 'createdAt' | 'updatedAt' | 'value'>, Document {
  organizationId: mongoose.Types.ObjectId;
  projectId: mongoose.Types.ObjectId;
  environmentId: mongoose.Types.ObjectId;
  createdBy: mongoose.Types.ObjectId;
  encryptedValue: string;
  iv: string;
  authTag: string;
  keyVersion: number;
  lastAccessedAt: Date | null;
  expiresAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const SecretSchema = new Schema<SecretDocument>(
  {
    organizationId: {
      type: Schema.Types.ObjectId,
      ref: 'Organization',
      required: true,
      index: true,
    },
    projectId: {
      type: Schema.Types.ObjectId,
      ref: 'Project',
      required: true,
      index: true,
    },
    environmentId: {
      type: Schema.Types.ObjectId,
      ref: 'Environment',
      required: true,
      index: true,
    },
    key: {
      type: String,
      required: true,
      trim: true,
    },
    encryptedValue: {
      type: String,
      required: true,
    },
    iv: {
      type: String,
      required: true,
    },
    authTag: {
      type: String,
      required: true,
    },
    keyVersion: {
      type: Number,
      required: true,
      default: 1,
    },
    isLocked: {
      type: Boolean,
      default: false,
    },
    version: {
      type: Number,
      default: 1,
    },
    createdBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    lastAccessedAt: {
      type: Date,
      default: null,
    },
    expiresAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
    toJSON: {
      transform: (_doc, ret) => {
        const obj = ret as any;
        obj.id = obj._id.toString();
        obj.organizationId = obj.organizationId.toString();
        obj.projectId = obj.projectId.toString();
        obj.environmentId = obj.environmentId.toString();
        obj.createdBy = obj.createdBy.toString();
        delete obj._id;
        delete obj.__v;
        delete obj.encryptedValue;
        delete obj.iv;
        delete obj.authTag;
        return obj;
      },
    },
  }
);

// Unique compound index: One secret per key name per environment.
SecretSchema.index({ environmentId: 1, key: 1 }, { unique: true });
SecretSchema.index({ organizationId: 1, projectId: 1 });

export const SecretModel = mongoose.model<SecretDocument>('Secret', SecretSchema);
