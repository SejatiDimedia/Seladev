import mongoose, { Schema, Document } from 'mongoose';
import type { ProjectMember } from '@seladev/types';

export interface ProjectMemberDocument extends Omit<ProjectMember, 'id' | 'projectId' | 'userId' | 'assignedBy' | 'createdAt' | 'updatedAt'>, Document {
  projectId: mongoose.Types.ObjectId;
  userId: mongoose.Types.ObjectId;
  assignedBy: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const ProjectMemberSchema = new Schema<ProjectMemberDocument>(
  {
    projectId: {
      type: Schema.Types.ObjectId,
      ref: 'Project',
      required: true,
      index: true,
    },
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    role: {
      type: String,
      enum: ['admin', 'developer', 'viewer'],
      required: true,
    },
    assignedBy: {
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
        obj.projectId = obj.projectId.toString();
        obj.userId = obj.userId.toString();
        obj.assignedBy = obj.assignedBy.toString();
        delete obj._id;
        delete obj.__v;
        return obj;
      },
    },
  }
);

// Compound index to prevent duplicate project memberships
ProjectMemberSchema.index({ projectId: 1, userId: 1 }, { unique: true });

export const ProjectMemberModel = mongoose.model<ProjectMemberDocument>('ProjectMember', ProjectMemberSchema);
