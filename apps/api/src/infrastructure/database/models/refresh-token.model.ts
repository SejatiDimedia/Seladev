import mongoose, { Schema, Document } from 'mongoose';

export interface RefreshTokenDocument extends Document {
  tokenHash: string;
  userId: mongoose.Types.ObjectId;
  organizationId: mongoose.Types.ObjectId;
  family: string;
  isRevoked: boolean;
  replacedByHash: string | null;
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const RefreshTokenSchema = new Schema<RefreshTokenDocument>(
  {
    tokenHash: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
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
    family: {
      type: String,
      required: true,
      index: true,
    },
    isRevoked: {
      type: Boolean,
      default: false,
    },
    replacedByHash: {
      type: String,
      default: null,
    },
    expiresAt: {
      type: Date,
      required: true,
      index: { expires: 0 }, // TTL index: MongoDB auto-removes documents when expiresAt is reached
    },
  },
  {
    timestamps: true,
    toJSON: {
      transform: (_doc, ret) => {
        const obj = ret as any;
        obj.id = obj._id.toString();
        obj.userId = obj.userId.toString();
        obj.organizationId = obj.organizationId.toString();
        delete obj._id;
        delete obj.__v;
        return obj;
      },
    },
  }
);

export const RefreshTokenModel = mongoose.model<RefreshTokenDocument>('RefreshToken', RefreshTokenSchema);
