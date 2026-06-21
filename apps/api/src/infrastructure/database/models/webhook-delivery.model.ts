import mongoose, { Schema, Document } from 'mongoose';
import type { WebhookDelivery } from '@seladev/types';

export interface WebhookDeliveryAttempt {
  attemptNumber: number;
  startedAt: Date;
  completedAt?: Date | null;
  durationMs?: number | null;
  httpStatus?: number | null;
  responseBody?: string | null;
  errorMessage?: string | null;
}

export interface WebhookDeliveryDocument extends Omit<WebhookDelivery, 'id' | 'webhookId' | 'createdAt' | 'payload'>, Document {
  webhookId: mongoose.Types.ObjectId;
  organizationId: mongoose.Types.ObjectId;
  payload: any;
  status: 'pending' | 'delivered' | 'failed' | 'dead_letter';
  attempts: WebhookDeliveryAttempt[];
  expiresAt: Date;
  createdAt: Date;
}

const WebhookDeliverySchema = new Schema<WebhookDeliveryDocument>(
  {
    webhookId: {
      type: Schema.Types.ObjectId,
      ref: 'Webhook',
      required: true,
      index: true,
    },
    organizationId: {
      type: Schema.Types.ObjectId,
      ref: 'Organization',
      required: true,
      index: true,
    },
    eventId: {
      type: String,
      required: true,
      index: true,
    },
    eventType: {
      type: String,
      required: true,
      index: true,
    },
    payload: {
      type: Schema.Types.Mixed,
      required: true,
    },
    statusCode: {
      type: Number,
      default: null,
    },
    responseTime: {
      type: Number,
      default: null,
    },
    attempt: {
      type: Number,
      required: true,
      default: 1,
    },
    error: {
      type: String,
      default: null,
    },
    status: {
      type: String,
      enum: ['pending', 'delivered', 'failed', 'dead_letter'],
      required: true,
      default: 'pending',
      index: true,
    },
    attempts: [
      {
        attemptNumber: { type: Number, required: true },
        startedAt: { type: Date, required: true },
        completedAt: { type: Date, default: null },
        durationMs: { type: Number, default: null },
        httpStatus: { type: Number, default: null },
        responseBody: { type: String, default: null },
        errorMessage: { type: String, default: null },
      },
    ],
    expiresAt: {
      type: Date,
      required: true,
      index: true,
    },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
    toJSON: {
      transform: (_doc, ret) => {
        const obj = ret as any;
        obj.id = obj._id.toString();
        obj.webhookId = obj.webhookId.toString();
        obj.organizationId = obj.organizationId.toString();
        delete obj._id;
        delete obj.__v;
        return obj;
      },
    },
  }
);

// MongoDB TTL Index for 90 days retention
WebhookDeliverySchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const WebhookDeliveryModel = mongoose.model<WebhookDeliveryDocument>('WebhookDelivery', WebhookDeliverySchema);
