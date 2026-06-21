import mongoose from 'mongoose';
import type { SsoConfigDocument } from '../../infrastructure/database/models/sso-config.model';
import { SsoConfigModel } from '../../infrastructure/database/models/sso-config.model';
import type { SsoRepository } from './sso.types';

export class MongooseSsoRepository implements SsoRepository {
  async findConfigByOrgId(orgId: string): Promise<SsoConfigDocument | null> {
    if (!mongoose.Types.ObjectId.isValid(orgId)) return null;
    return SsoConfigModel.findOne({ organizationId: new mongoose.Types.ObjectId(orgId) }).exec();
  }

  async createConfig(orgId: string, data: Partial<SsoConfigDocument>): Promise<SsoConfigDocument> {
    return SsoConfigModel.create({
      ...data,
      organizationId: new mongoose.Types.ObjectId(orgId),
    });
  }

  async updateConfig(orgId: string, update: Partial<SsoConfigDocument>): Promise<SsoConfigDocument | null> {
    if (!mongoose.Types.ObjectId.isValid(orgId)) return null;
    return SsoConfigModel.findOneAndUpdate(
      { organizationId: new mongoose.Types.ObjectId(orgId) },
      update,
      { new: true }
    ).exec();
  }

  async deleteConfig(orgId: string): Promise<boolean> {
    if (!mongoose.Types.ObjectId.isValid(orgId)) return false;
    const result = await SsoConfigModel.deleteOne({ organizationId: new mongoose.Types.ObjectId(orgId) }).exec();
    return result.deletedCount > 0;
  }
}
