import mongoose, { Schema, Document } from 'mongoose';
import type { Notification } from '@seladev/types';

export interface NotificationDocument extends Omit<Notification, 'id' | 'userId' | 'organizationId' | 'createdAt'>, Document {
  userId: mongoose.Types.ObjectId;
  organizationId: mongoose.Types.ObjectId;
  createdAt: Date;
}

const NotificationSchema = new Schema<NotificationDocument>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    organizationId: {
      type: Schema.Types.ObjectId,
      ref: 'Organization',
      required: true,
      index: true,
    },
    type: {
      type: String,
      required: true,
      enum: [
        'deployment.succeeded',
        'deployment.failed',
        'secret.expiring',
        'api_key.expiring',
        'webhook.delivery_failed',
        'role.changed',
        'member.added',
      ],
    },
    title: {
      type: String,
      required: true,
    },
    message: {
      type: String,
      required: true,
    },
    link: {
      type: String,
      default: null,
    },
    isRead: {
      type: Boolean,
      default: false,
      index: true,
    },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
    toJSON: {
      transform: (_doc, ret) => {
        const obj = ret as any;
        obj.id = obj._id.toString();
        if (obj.userId) obj.userId = obj.userId.toString();
        if (obj.organizationId) obj.organizationId = obj.organizationId.toString();
        delete obj._id;
        delete obj.__v;
        return obj;
      },
    },
  }
);

// Compound index for fast queries of a user's read/unread notifications
NotificationSchema.index({ userId: 1, isRead: 1 });
NotificationSchema.index({ userId: 1, createdAt: -1 });

export const NotificationModel = mongoose.model<NotificationDocument>('Notification', NotificationSchema);
