import mongoose, { Schema, Document } from 'mongoose';
import type { User } from '@seladev/types';

export interface UserDocument extends Omit<User, 'id' | 'lastLoginAt' | 'createdAt' | 'updatedAt'>, Document {
  passwordHash: string;
  mfaSecret: string | null;
  mfaRecoveryCodes: string[];
  lastLoginAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const UserSchema = new Schema<UserDocument>(
  {
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      index: true,
    },
    passwordHash: {
      type: String,
      required: true,
    },
    firstName: {
      type: String,
      required: true,
      trim: true,
    },
    lastName: {
      type: String,
      required: true,
      trim: true,
    },
    avatarUrl: {
      type: String,
      default: null,
    },
    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },
    lastLoginAt: {
      type: Date,
      default: null,
    },
    mfaEnabled: {
      type: Boolean,
      default: false,
    },
    mfaSecret: {
      type: String,
      default: null,
    },
    mfaRecoveryCodes: {
      type: [String],
      default: [],
    },
  },
  {
    timestamps: true,
    toJSON: {
      transform: (_doc, ret) => {
        const obj = ret as any;
        obj.id = obj._id.toString();
        delete obj._id;
        delete obj.__v;
        delete obj.passwordHash;
        delete obj.mfaSecret;
        delete obj.mfaRecoveryCodes;
        return obj;
      },
    },
  }
);

export const UserModel = mongoose.model<UserDocument>('User', UserSchema);
