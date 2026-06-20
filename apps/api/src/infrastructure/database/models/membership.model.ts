import mongoose, { Schema, Document } from 'mongoose';
import type { Membership } from '@seladev/types';

export interface MembershipDocument extends Omit<Membership, 'id' | 'organizationId' | 'userId' | 'invitedBy' | 'joinedAt' | 'createdAt' | 'updatedAt'>, Document {
  organizationId: mongoose.Types.ObjectId;
  userId: mongoose.Types.ObjectId;
  invitedBy: mongoose.Types.ObjectId;
  joinedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const MembershipSchema = new Schema<MembershipDocument>(
  {
    organizationId: {
      type: Schema.Types.ObjectId,
      ref: 'Organization',
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
      enum: ['owner', 'admin', 'member', 'viewer'],
      required: true,
    },
    invitedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    status: {
      type: String,
      enum: ['active', 'invited', 'suspended'],
      default: 'invited',
    },
    joinedAt: {
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
        obj.userId = obj.userId.toString();
        obj.invitedBy = obj.invitedBy.toString();
        delete obj._id;
        delete obj.__v;
        return obj;
      },
    },
  }
);

// Unique compound index to prevent duplicate memberships
MembershipSchema.index({ organizationId: 1, userId: 1 }, { unique: true });

export const MembershipModel = mongoose.model<MembershipDocument>('Membership', MembershipSchema);
