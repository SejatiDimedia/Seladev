import type { UserDocument } from '../../infrastructure/database/models/user.model';
import { UserModel } from '../../infrastructure/database/models/user.model';
import type { RefreshTokenDocument } from '../../infrastructure/database/models/refresh-token.model';
import { RefreshTokenModel } from '../../infrastructure/database/models/refresh-token.model';
import type { MembershipDocument } from '../../infrastructure/database/models/membership.model';
import { MembershipModel } from '../../infrastructure/database/models/membership.model';
import type { RegisterDto } from './auth.types';

export interface AuthRepository {
  findUserByEmail(email: string): Promise<UserDocument | null>;
  findUserById(id: string): Promise<UserDocument | null>;
  createUser(data: RegisterDto & { passwordHash: string }): Promise<UserDocument>;
  
  // Refresh token methods
  createRefreshToken(data: {
    tokenHash: string;
    userId: string;
    organizationId: string;
    family: string;
    expiresAt: Date;
  }): Promise<RefreshTokenDocument>;
  findRefreshTokenByHash(tokenHash: string): Promise<RefreshTokenDocument | null>;
  updateRefreshToken(id: string, update: Partial<RefreshTokenDocument>): Promise<RefreshTokenDocument | null>;
  revokeRefreshTokenFamily(family: string): Promise<void>;
  
  // Membership check
  findFirstActiveMembership(userId: string): Promise<MembershipDocument | null>;
}

export class MongooseAuthRepository implements AuthRepository {
  async findUserByEmail(email: string): Promise<UserDocument | null> {
    return UserModel.findOne({ email }).exec();
  }

  async findUserById(id: string): Promise<UserDocument | null> {
    return UserModel.findById(id).exec();
  }

  async createUser(data: RegisterDto & { passwordHash: string }): Promise<UserDocument> {
    return UserModel.create(data);
  }

  async createRefreshToken(data: {
    tokenHash: string;
    userId: string;
    organizationId: string;
    family: string;
    expiresAt: Date;
  }): Promise<RefreshTokenDocument> {
    return RefreshTokenModel.create(data);
  }

  async findRefreshTokenByHash(tokenHash: string): Promise<RefreshTokenDocument | null> {
    return RefreshTokenModel.findOne({ tokenHash }).exec();
  }

  async updateRefreshToken(id: string, update: Partial<RefreshTokenDocument>): Promise<RefreshTokenDocument | null> {
    return RefreshTokenModel.findByIdAndUpdate(id, update, { new: true }).exec();
  }

  async revokeRefreshTokenFamily(family: string): Promise<void> {
    await RefreshTokenModel.updateMany({ family }, { isRevoked: true }).exec();
  }

  async findFirstActiveMembership(userId: string): Promise<MembershipDocument | null> {
    return MembershipModel.findOne({ userId, status: 'active' })
      .populate('organizationId')
      .exec();
  }
}
