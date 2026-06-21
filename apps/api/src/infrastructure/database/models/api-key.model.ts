import mongoose, { Schema, Document } from 'mongoose';
import type { ApiKey } from '@seladev/types';

export interface ApiKeyDocument extends Omit<ApiKey, 'id' | 'organizationId' | 'userId' | 'expiresAt' | 'lastUsedAt' | 'createdAt' | 'updatedAt'>, Document {
  organizationId: mongoose.Types.ObjectId;
  projectId: mongoose.Types.ObjectId | null;
  environmentId: mongoose.Types.ObjectId | null;
  userId: mongoose.Types.ObjectId;
  keyHash: string;
  keyPrefix: string;
  scopes: string[];
  lastUsedAt: Date | null;
  expiresAt: Date | null;
  isActive: boolean;
  expiryNotified: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const ApiKeySchema = new Schema<ApiKeyDocument>(
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
      default: null,
      index: true,
    },
    environmentId: {
      type: Schema.Types.ObjectId,
      ref: 'Environment',
      default: null,
      index: true,
    },
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    keyHash: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    keyPrefix: {
      type: String,
      required: true,
    },
    scopes: {
      type: [String],
      required: true,
      default: [],
    },
    lastUsedAt: {
      type: Date,
      default: null,
    },
    expiresAt: {
      type: Date,
      default: null,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    expiryNotified: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
    toJSON: {
      transform: (_doc, ret) => {
        const obj = ret as any;
        obj.id = obj._id.toString();
        obj.organizationId = obj.organizationId.toString();
        obj.userId = obj.userId.toString();
        if (obj.projectId) obj.projectId = obj.projectId.toString();
        if (obj.environmentId) obj.environmentId = obj.environmentId.toString();
        if (obj.expiresAt) obj.expiresAt = obj.expiresAt.toISOString();
        if (obj.lastUsedAt) obj.lastUsedAt = obj.lastUsedAt.toISOString();
        delete obj._id;
        delete obj.__v;
        delete obj.keyHash; // Do not return keyHash
        return obj;
      },
    },
  }
);

ApiKeySchema.index({ organizationId: 1, isActive: 1 });

export const ApiKeyModel = mongoose.model<ApiKeyDocument>('ApiKey', ApiKeySchema);
