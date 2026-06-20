import mongoose, { Schema, Document } from 'mongoose';
import type { Deployment, StatusEvent } from '@seladev/types';

export interface DeploymentDocument extends Omit<Deployment, 'id' | 'projectId' | 'environmentId' | 'organizationId' | 'triggeredBy' | 'createdAt' | 'completedAt' | 'updatedAt'>, Document {
  organizationId: mongoose.Types.ObjectId;
  projectId: mongoose.Types.ObjectId;
  environmentId: mongoose.Types.ObjectId;
  triggeredBy: mongoose.Types.ObjectId;
  createdAt: Date;
  completedAt: Date | null;
  updatedAt: Date;
}

const StatusHistorySchema = new Schema<StatusEvent>(
  {
    status: {
      type: String,
      required: true,
    },
    timestamp: {
      type: String,
      required: true,
      default: () => new Date().toISOString(),
    },
    message: {
      type: String,
      required: true,
    },
  },
  { _id: false }
);

const DeploymentSchema = new Schema<DeploymentDocument>(
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
    version: {
      type: String,
      required: true,
      trim: true,
    },
    branch: {
      type: String,
      default: null,
      trim: true,
    },
    commitSha: {
      type: String,
      default: null,
      trim: true,
    },
    commitMessage: {
      type: String,
      default: null,
      trim: true,
    },
    status: {
      type: String,
      enum: ['queued', 'building', 'deploying', 'success', 'failed', 'cancelled', 'pending_approval'],
      required: true,
      default: 'queued',
    },
    statusHistory: {
      type: [StatusHistorySchema],
      default: [],
    },
    triggeredBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    triggeredVia: {
      type: String,
      enum: ['ui', 'api', 'webhook', 'schedule'],
      required: true,
      default: 'ui',
    },
    buildLogs: {
      type: [String],
      default: [],
    },
    duration: {
      type: Number,
      default: null,
    },
    errorMessage: {
      type: String,
      default: null,
    },
    metadata: {
      type: Map,
      of: Schema.Types.Mixed,
      default: {},
    },
    completedAt: {
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
        obj.triggeredBy = obj.triggeredBy.toString();
        if (obj.completedAt) {
          obj.completedAt = obj.completedAt.toISOString();
        }
        if (obj.createdAt) {
          obj.createdAt = obj.createdAt.toISOString();
        }
        if (obj.updatedAt) {
          obj.updatedAt = obj.updatedAt.toISOString();
        }
        if (obj.statusHistory) {
          obj.statusHistory = obj.statusHistory.map((sh: any) => ({
            ...sh,
            timestamp: sh.timestamp instanceof Date ? sh.timestamp.toISOString() : sh.timestamp,
          }));
        }
        delete obj._id;
        delete obj.__v;
        return obj;
      },
    },
  }
);

// Indexes
DeploymentSchema.index({ projectId: 1, createdAt: -1 });
DeploymentSchema.index({ environmentId: 1, status: 1 });
DeploymentSchema.index({ organizationId: 1, status: 1, createdAt: -1 });

export const DeploymentModel = mongoose.model<DeploymentDocument>('Deployment', DeploymentSchema);
