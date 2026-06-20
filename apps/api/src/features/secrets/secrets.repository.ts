import mongoose from 'mongoose';
import type { SecretDocument } from '../../infrastructure/database/models/secret.model';
import { SecretModel } from '../../infrastructure/database/models/secret.model';
import type { SecretVersionDocument } from '../../infrastructure/database/models/secret-version.model';
import { SecretVersionModel } from '../../infrastructure/database/models/secret-version.model';

export interface SecretsRepository {
  // Secret operations
  findSecretById(id: string): Promise<SecretDocument | null>;
  findSecretByKey(environmentId: string, key: string): Promise<SecretDocument | null>;
  createSecret(data: {
    organizationId: string;
    projectId: string;
    environmentId: string;
    key: string;
    encryptedValue: string;
    iv: string;
    authTag: string;
    keyVersion: number;
    createdBy: string;
    expiresAt?: Date | null;
    isLocked?: boolean;
  }): Promise<SecretDocument>;
  updateSecret(id: string, update: Partial<SecretDocument>): Promise<SecretDocument | null>;
  deleteSecret(id: string): Promise<boolean>;
  listSecretsByEnv(environmentId: string): Promise<SecretDocument[]>;

  // Secret Version operations
  createSecretVersion(data: {
    secretId: string;
    organizationId: string;
    encryptedValue: string;
    iv: string;
    authTag: string;
    keyVersion: number;
    version: number;
    createdBy: string;
  }): Promise<SecretVersionDocument>;
  findSecretVersionById(id: string): Promise<SecretVersionDocument | null>;
  listSecretVersions(secretId: string): Promise<SecretVersionDocument[]>;
  deleteSecretVersions(secretId: string): Promise<boolean>;
}

export class MongooseSecretsRepository implements SecretsRepository {
  // Secret operations
  async findSecretById(id: string): Promise<SecretDocument | null> {
    return SecretModel.findById(id).exec();
  }

  async findSecretByKey(environmentId: string, key: string): Promise<SecretDocument | null> {
    return SecretModel.findOne({
      environmentId: new mongoose.Types.ObjectId(environmentId),
      key: key.toUpperCase(),
    }).exec();
  }

  async createSecret(data: {
    organizationId: string;
    projectId: string;
    environmentId: string;
    key: string;
    encryptedValue: string;
    iv: string;
    authTag: string;
    keyVersion: number;
    createdBy: string;
    expiresAt?: Date | null;
    isLocked?: boolean;
  }): Promise<SecretDocument> {
    return SecretModel.create({
      organizationId: new mongoose.Types.ObjectId(data.organizationId),
      projectId: new mongoose.Types.ObjectId(data.projectId),
      environmentId: new mongoose.Types.ObjectId(data.environmentId),
      key: data.key.toUpperCase(),
      encryptedValue: data.encryptedValue,
      iv: data.iv,
      authTag: data.authTag,
      keyVersion: data.keyVersion,
      createdBy: new mongoose.Types.ObjectId(data.createdBy),
      expiresAt: data.expiresAt || null,
      isLocked: data.isLocked ?? false,
      version: 1,
    });
  }

  async updateSecret(id: string, update: Partial<SecretDocument>): Promise<SecretDocument | null> {
    return SecretModel.findByIdAndUpdate(id, update, { new: true }).exec();
  }

  async deleteSecret(id: string): Promise<boolean> {
    const result = await SecretModel.findByIdAndDelete(id).exec();
    return result !== null;
  }

  async listSecretsByEnv(environmentId: string): Promise<SecretDocument[]> {
    return SecretModel.find({
      environmentId: new mongoose.Types.ObjectId(environmentId),
    }).exec();
  }

  // Secret Version operations
  async createSecretVersion(data: {
    secretId: string;
    organizationId: string;
    encryptedValue: string;
    iv: string;
    authTag: string;
    keyVersion: number;
    version: number;
    createdBy: string;
  }): Promise<SecretVersionDocument> {
    return SecretVersionModel.create({
      secretId: new mongoose.Types.ObjectId(data.secretId),
      organizationId: new mongoose.Types.ObjectId(data.organizationId),
      encryptedValue: data.encryptedValue,
      iv: data.iv,
      authTag: data.authTag,
      keyVersion: data.keyVersion,
      version: data.version,
      createdBy: new mongoose.Types.ObjectId(data.createdBy),
    });
  }

  async findSecretVersionById(id: string): Promise<SecretVersionDocument | null> {
    return SecretVersionModel.findById(id).exec();
  }

  async listSecretVersions(secretId: string): Promise<SecretVersionDocument[]> {
    return SecretVersionModel.find({
      secretId: new mongoose.Types.ObjectId(secretId),
    }).sort({ version: -1 }).exec();
  }

  async deleteSecretVersions(secretId: string): Promise<boolean> {
    const result = await SecretVersionModel.deleteMany({
      secretId: new mongoose.Types.ObjectId(secretId),
    }).exec();
    return result.acknowledged;
  }
}
