import mongoose, { Schema, Document } from 'mongoose';

export interface SecretVersionDocument extends Document {
  secretId: mongoose.Types.ObjectId;
  organizationId: mongoose.Types.ObjectId;
  encryptedValue: string;
  iv: string;
  authTag: string;
  keyVersion: number;
  version: number;
  createdBy: mongoose.Types.ObjectId;
  createdAt: Date;
}

const SecretVersionSchema = new Schema<SecretVersionDocument>(
  {
    secretId: {
      type: Schema.Types.ObjectId,
      ref: 'Secret',
      required: true,
      index: true,
    },
    organizationId: {
      type: Schema.Types.ObjectId,
      ref: 'Organization',
      required: true,
      index: true,
    },
    encryptedValue: {
      type: String,
      required: true,
    },
    iv: {
      type: String,
      required: true,
    },
    authTag: {
      type: String,
      required: true,
    },
    keyVersion: {
      type: Number,
      required: true,
    },
    version: {
      type: Number,
      required: true,
    },
    createdBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
    toJSON: {
      transform: (_doc, ret) => {
        const obj = ret as any;
        obj.id = obj._id.toString();
        obj.secretId = obj.secretId.toString();
        obj.organizationId = obj.organizationId.toString();
        obj.createdBy = obj.createdBy.toString();
        delete obj._id;
        delete obj.__v;
        delete obj.encryptedValue;
        delete obj.iv;
        delete obj.authTag;
        return obj;
      },
    },
  }
);

SecretVersionSchema.index({ secretId: 1, version: -1 });

export const SecretVersionModel = mongoose.model<SecretVersionDocument>('SecretVersion', SecretVersionSchema);
