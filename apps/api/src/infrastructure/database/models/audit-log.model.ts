import mongoose, { Schema, Document } from 'mongoose';
import type { AuditLog } from '@seladev/types';

export interface AuditLogDocument extends Omit<AuditLog, 'id' | 'organizationId' | 'projectId' | 'createdAt'>, Document {
  organizationId: mongoose.Types.ObjectId;
  projectId: mongoose.Types.ObjectId | null;
  createdAt: Date;
}

const AuditLogSchema = new Schema<AuditLogDocument>(
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
    actor: {
      userId: {
        type: Schema.Types.ObjectId,
        ref: 'User',
        default: null,
      },
      email: {
        type: String,
        required: true,
        trim: true,
      },
      ipAddress: {
        type: String,
        default: null,
      },
      userAgent: {
        type: String,
        default: null,
      },
    },
    action: {
      type: String,
      required: true,
      index: true,
    },
    resource: {
      type: {
        type: String,
        required: true,
      },
      id: {
        type: String,
        required: true,
      },
      name: {
        type: String,
        required: true,
        trim: true,
      },
    },
    metadata: {
      type: Schema.Types.Mixed,
      default: {},
    },
    outcome: {
      type: String,
      enum: ['success', 'failure'],
      required: true,
    },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
    writeConcern: { w: 'majority', j: true },
    toJSON: {
      transform: (_doc, ret) => {
        const obj = ret as any;
        obj.id = obj._id.toString();
        obj.organizationId = obj.organizationId.toString();
        if (obj.projectId) {
          obj.projectId = obj.projectId.toString();
        }
        if (obj.actor && obj.actor.userId) {
          obj.actor.userId = obj.actor.userId.toString();
        }
        if (obj.createdAt) {
          obj.createdAt = obj.createdAt.toISOString();
        }
        delete obj._id;
        delete obj.__v;
        return obj;
      },
    },
  }
);

// Indexes
AuditLogSchema.index({ organizationId: 1, createdAt: -1 });
AuditLogSchema.index({ organizationId: 1, action: 1, createdAt: -1 });
AuditLogSchema.index({ organizationId: 1, 'actor.userId': 1, createdAt: -1 });
AuditLogSchema.index({ organizationId: 1, 'resource.id': 1, createdAt: -1 });

export const AuditLogModel = mongoose.model<AuditLogDocument>('AuditLog', AuditLogSchema);
