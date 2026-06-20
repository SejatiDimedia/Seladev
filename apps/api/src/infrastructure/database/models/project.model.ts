import mongoose, { Schema, Document } from 'mongoose';
import type { Project } from '@seladev/types';

export interface ProjectDocument extends Omit<Project, 'id' | 'organizationId' | 'createdBy' | 'archivedAt' | 'createdAt' | 'updatedAt'>, Document {
  organizationId: mongoose.Types.ObjectId;
  createdBy: mongoose.Types.ObjectId;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const ProjectSchema = new Schema<ProjectDocument>(
  {
    organizationId: {
      type: Schema.Types.ObjectId,
      ref: 'Organization',
      required: true,
      index: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    slug: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
    },
    description: {
      type: String,
      default: '',
    },
    visibility: {
      type: String,
      enum: ['private', 'internal'],
      default: 'private',
    },
    repositoryUrl: {
      type: String,
      default: null,
    },
    tags: {
      type: [String],
      default: [],
    },
    settings: {
      deploymentProtection: {
        type: Boolean,
        default: false,
      },
      requireApproval: {
        type: Boolean,
        default: false,
      },
      allowedBranches: {
        type: [String],
        default: [],
      },
    },
    createdBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    archivedAt: {
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
        obj.createdBy = obj.createdBy.toString();
        delete obj._id;
        delete obj.__v;
        return obj;
      },
    },
  }
);

ProjectSchema.index({ organizationId: 1, slug: 1 }, { unique: true });
ProjectSchema.index({ organizationId: 1, archivedAt: 1 });

export const ProjectModel = mongoose.model<ProjectDocument>('Project', ProjectSchema);
