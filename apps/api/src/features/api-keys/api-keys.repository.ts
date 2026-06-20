import mongoose from 'mongoose';
import type { ApiKeyDocument } from '../../infrastructure/database/models/api-key.model';
import { ApiKeyModel } from '../../infrastructure/database/models/api-key.model';

export interface ApiKeysRepository {
  findKeyById(id: string): Promise<ApiKeyDocument | null>;
  findKeyByHash(keyHash: string): Promise<ApiKeyDocument | null>;
  createKey(data: {
    name: string;
    organizationId: string;
    projectId: string | null;
    environmentId: string | null;
    userId: string;
    keyHash: string;
    keyPrefix: string;
    scopes: string[];
    expiresAt: Date | null;
  }): Promise<ApiKeyDocument>;
  updateKey(id: string, update: Partial<ApiKeyDocument>): Promise<ApiKeyDocument | null>;
  listKeysByOrg(organizationId: string): Promise<ApiKeyDocument[]>;
  deleteKey(id: string): Promise<boolean>;
}

export class MongooseApiKeysRepository implements ApiKeysRepository {
  async findKeyById(id: string): Promise<ApiKeyDocument | null> {
    return ApiKeyModel.findById(id).exec();
  }

  async findKeyByHash(keyHash: string): Promise<ApiKeyDocument | null> {
    return ApiKeyModel.findOne({ keyHash }).exec();
  }

  async createKey(data: {
    name: string;
    organizationId: string;
    projectId: string | null;
    environmentId: string | null;
    userId: string;
    keyHash: string;
    keyPrefix: string;
    scopes: string[];
    expiresAt: Date | null;
  }): Promise<ApiKeyDocument> {
    return ApiKeyModel.create({
      name: data.name,
      organizationId: new mongoose.Types.ObjectId(data.organizationId),
      projectId: data.projectId ? new mongoose.Types.ObjectId(data.projectId) : null,
      environmentId: data.environmentId ? new mongoose.Types.ObjectId(data.environmentId) : null,
      userId: new mongoose.Types.ObjectId(data.userId),
      keyHash: data.keyHash,
      keyPrefix: data.keyPrefix,
      scopes: data.scopes,
      expiresAt: data.expiresAt,
    });
  }

  async updateKey(id: string, update: Partial<ApiKeyDocument>): Promise<ApiKeyDocument | null> {
    return ApiKeyModel.findByIdAndUpdate(id, update, { new: true }).exec();
  }

  async listKeysByOrg(organizationId: string): Promise<ApiKeyDocument[]> {
    return ApiKeyModel.find({
      organizationId: new mongoose.Types.ObjectId(organizationId),
    }).exec();
  }

  async deleteKey(id: string): Promise<boolean> {
    const result = await ApiKeyModel.findByIdAndDelete(id).exec();
    return result !== null;
  }
}
