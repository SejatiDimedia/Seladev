import mongoose from 'mongoose';
import type { DeploymentDocument } from '../../infrastructure/database/models/deployment.model';
import { DeploymentModel } from '../../infrastructure/database/models/deployment.model';
import type { DeploymentStatus, StatusEvent } from '@seladev/types';
import type { DeploymentFilters } from './deployments.types';

export interface DeploymentsRepository {
  findDeploymentById(id: string): Promise<DeploymentDocument | null>;
  createDeployment(data: {
    organizationId: string;
    projectId: string;
    environmentId: string;
    version: string;
    branch: string | null;
    commitSha: string | null;
    commitMessage: string | null;
    status: DeploymentStatus;
    statusHistory: StatusEvent[];
    triggeredBy: string;
    triggeredVia: 'ui' | 'api' | 'webhook' | 'schedule';
  }): Promise<DeploymentDocument>;
  updateStatus(id: string, status: DeploymentStatus, event: StatusEvent, completedAt?: Date | null, duration?: number | null, errorMessage?: string | null): Promise<DeploymentDocument | null>;
  appendLog(id: string, logLine: string): Promise<DeploymentDocument | null>;
  listHistory(
    projectId: string,
    limit: number,
    cursor?: string | null,
    filters?: DeploymentFilters
  ): Promise<{ deployments: DeploymentDocument[]; hasNext: boolean; nextCursor: string | null }>;
}

export class MongooseDeploymentsRepository implements DeploymentsRepository {
  async findDeploymentById(id: string): Promise<DeploymentDocument | null> {
    return DeploymentModel.findById(id).exec();
  }

  async createDeployment(data: {
    organizationId: string;
    projectId: string;
    environmentId: string;
    version: string;
    branch: string | null;
    commitSha: string | null;
    commitMessage: string | null;
    status: DeploymentStatus;
    statusHistory: StatusEvent[];
    triggeredBy: string;
    triggeredVia: 'ui' | 'api' | 'webhook' | 'schedule';
  }): Promise<DeploymentDocument> {
    return DeploymentModel.create({
      organizationId: new mongoose.Types.ObjectId(data.organizationId),
      projectId: new mongoose.Types.ObjectId(data.projectId),
      environmentId: new mongoose.Types.ObjectId(data.environmentId),
      version: data.version,
      branch: data.branch,
      commitSha: data.commitSha,
      commitMessage: data.commitMessage,
      status: data.status,
      statusHistory: data.statusHistory,
      triggeredBy: new mongoose.Types.ObjectId(data.triggeredBy),
      triggeredVia: data.triggeredVia,
      buildLogs: [],
      duration: null,
      errorMessage: null,
      completedAt: null,
    });
  }

  async updateStatus(
    id: string,
    status: DeploymentStatus,
    event: StatusEvent,
    completedAt?: Date | null,
    duration?: number | null,
    errorMessage?: string | null
  ): Promise<DeploymentDocument | null> {
    const update: any = {
      $set: { status },
      $push: { statusHistory: event },
    };

    if (completedAt !== undefined) {
      update.$set.completedAt = completedAt;
    }
    if (duration !== undefined) {
      update.$set.duration = duration;
    }
    if (errorMessage !== undefined) {
      update.$set.errorMessage = errorMessage;
    }

    return DeploymentModel.findByIdAndUpdate(id, update, { new: true }).exec();
  }

  async appendLog(id: string, logLine: string): Promise<DeploymentDocument | null> {
    return DeploymentModel.findByIdAndUpdate(
      id,
      { $push: { buildLogs: logLine } },
      { new: true }
    ).exec();
  }

  async listHistory(
    projectId: string,
    limit: number,
    cursor?: string | null,
    filters?: DeploymentFilters
  ): Promise<{ deployments: DeploymentDocument[]; hasNext: boolean; nextCursor: string | null }> {
    const query: any = {
      projectId: new mongoose.Types.ObjectId(projectId),
    };

    if (filters?.environmentId) {
      query.environmentId = new mongoose.Types.ObjectId(filters.environmentId);
    }
    if (filters?.status) {
      query.status = filters.status;
    }

    if (cursor) {
      try {
        const decodedId = Buffer.from(cursor, 'base64').toString('utf8');
        if (mongoose.Types.ObjectId.isValid(decodedId)) {
          query._id = { $lt: new mongoose.Types.ObjectId(decodedId) };
        }
      } catch (err) {
        console.error('Failed to decode cursor:', err);
      }
    }

    // Query limit + 1 items to check hasNext
    const deployments = await DeploymentModel.find(query)
      .sort({ _id: -1 })
      .limit(limit + 1)
      .exec();

    const hasNext = deployments.length > limit;
    const slicedDeployments = hasNext ? deployments.slice(0, limit) : deployments;

    let nextCursor: string | null = null;
    if (hasNext && slicedDeployments.length > 0) {
      const lastItem = slicedDeployments[slicedDeployments.length - 1]!;
      nextCursor = Buffer.from(lastItem._id.toString()).toString('base64');
    }

    return {
      deployments: slicedDeployments,
      hasNext,
      nextCursor,
    };
  }
}
