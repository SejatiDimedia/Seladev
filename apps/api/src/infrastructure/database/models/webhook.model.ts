import mongoose, { Schema, Document } from 'mongoose';
import type { Webhook } from '@seladev/types';

export interface WebhookDocument extends Omit<Webhook, 'id' | 'organizationId' | 'projectId' | 'createdAt' | 'updatedAt' | 'secret'>, Document {
  organizationId: mongoose.Types.ObjectId;
  projectId: mongoose.Types.ObjectId | null;
  secretCiphertext: string;
  secretIv: string;
  secretAuthTag: string;
  previousSecretCiphertext: string | null;
  previousSecretIv: string | null;
  previousSecretAuthTag: string | null;
  previousSecretExpiresAt: Date | null;
  failureStreak: number;
  disabledAt: Date | null;
  lastDeliveryAt: Date | null;
  lastDeliveryStatus: 'delivered' | 'failed' | null;
  createdAt: Date;
  updatedAt: Date;
}

const WebhookSchema = new Schema<WebhookDocument>(
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
    name: {
      type: String,
      required: true,
      trim: true,
    },
    url: {
      type: String,
      required: true,
      trim: true,
    },
    events: {
      type: [String],
      required: true,
    },
    secretCiphertext: {
      type: String,
      required: true,
    },
    secretIv: {
      type: String,
      required: true,
    },
    secretAuthTag: {
      type: String,
      required: true,
    },
    previousSecretCiphertext: {
      type: String,
      default: null,
    },
    previousSecretIv: {
      type: String,
      default: null,
    },
    previousSecretAuthTag: {
      type: String,
      default: null,
    },
    previousSecretExpiresAt: {
      type: Date,
      default: null,
    },
    isActive: {
      type: Boolean,
      required: true,
      default: true,
      index: true,
    },
    failureStreak: {
      type: Number,
      required: true,
      default: 0,
    },
    disabledAt: {
      type: Date,
      default: null,
    },
    lastDeliveryAt: {
      type: Date,
      default: null,
    },
    lastDeliveryStatus: {
      type: String,
      enum: ['delivered', 'failed', null],
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
        if (obj.projectId) {
          obj.projectId = obj.projectId.toString();
        }
        delete obj._id;
        delete obj.__v;
        delete obj.secretCiphertext;
        delete obj.secretIv;
        delete obj.secretAuthTag;
        delete obj.previousSecretCiphertext;
        delete obj.previousSecretIv;
        delete obj.previousSecretAuthTag;
        delete obj.previousSecretExpiresAt;
        return obj;
      },
    },
  }
);

WebhookSchema.index({ organizationId: 1, projectId: 1 });

export const WebhookModel = mongoose.model<WebhookDocument>('Webhook', WebhookSchema);
