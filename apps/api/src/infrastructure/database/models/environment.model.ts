import mongoose, { Schema, Document } from 'mongoose';
import type { Environment } from '@seladev/types';

export interface EnvironmentDocument extends Omit<Environment, 'id' | 'organizationId' | 'projectId' | 'createdAt' | 'updatedAt'>, Document {
  organizationId: mongoose.Types.ObjectId;
  projectId: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const EnvironmentVariableSchema = new Schema(
  {
    key: {
      type: String,
      required: true,
      trim: true,
    },
    value: {
      type: String,
      required: true,
    },
    isSecret: {
      type: Boolean,
      default: false,
    },
  },
  { _id: false }
);

const EnvironmentSchema = new Schema<EnvironmentDocument>(
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
    type: {
      type: String,
      enum: ['development', 'staging', 'production'],
      required: true,
    },
    isProtected: {
      type: Boolean,
      default: false,
    },
    variables: {
      type: [EnvironmentVariableSchema],
      default: [],
    },
    description: {
      type: String,
      default: '',
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
        delete obj._id;
        delete obj.__v;
        return obj;
      },
    },
  }
);

EnvironmentSchema.index({ projectId: 1, slug: 1 }, { unique: true });
EnvironmentSchema.index({ projectId: 1, type: 1 });

export const EnvironmentModel = mongoose.model<EnvironmentDocument>('Environment', EnvironmentSchema);
