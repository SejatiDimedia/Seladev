import mongoose, { Schema, Document } from 'mongoose';
import type { Organization } from '@seladev/types';

export interface OrganizationDocument extends Omit<Organization, 'id' | 'createdBy' | 'createdAt' | 'updatedAt'>, Document {
  createdBy: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const OrganizationSchema = new Schema<OrganizationDocument>(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    slug: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      lowercase: true,
      index: true,
    },
    plan: {
      type: String,
      enum: ['free', 'pro', 'enterprise'],
      default: 'free',
    },
    settings: {
      mfaRequired: {
        type: Boolean,
        default: false,
      },
      allowedDomains: {
        type: [String],
        default: [],
      },
      maxProjects: {
        type: Number,
        default: 3, // Defaults based on free plan limit in constants
      },
      maxMembers: {
        type: Number,
        default: 5,
      },
    },
    createdBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
  },
  {
    timestamps: true,
    toJSON: {
      transform: (_doc, ret) => {
        const obj = ret as any;
        obj.id = obj._id.toString();
        obj.createdBy = obj.createdBy.toString();
        delete obj._id;
        delete obj.__v;
        return obj;
      },
    },
  }
);

export const OrganizationModel = mongoose.model<OrganizationDocument>('Organization', OrganizationSchema);
