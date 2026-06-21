import mongoose from 'mongoose';
import { NotFoundError } from '../../lib/errors';
import type { 
  Granularity, 
  DateFilters, 
  DeploymentAnalytics, 
  ApiKeyAnalyticsPeriod, 
  SecretAnalytics, 
  WebhookAnalyticsPeriod 
} from './analytics.types';

export class AnalyticsService {
  private dateRangeFilter(filters: DateFilters): any {
    const match: any = {};
    if (filters.startDate || filters.endDate) {
      match.createdAt = {};
      if (filters.startDate) {
        match.createdAt.$gte = new Date(filters.startDate);
      }
      if (filters.endDate) {
        match.createdAt.$lte = new Date(filters.endDate);
      }
    }
    return match;
  }

  private getMongoDateFormat(granularity: Granularity): string {
    switch (granularity) {
      case 'month':
        return '%Y-%m';
      case 'week':
        return '%Y-W%V';
      case 'day':
      default:
        return '%Y-%m-%d';
    }
  }

  private async verifyProjectExists(projectId: string): Promise<void> {
    const Project = mongoose.model('Project');
    const project = await Project.findById(projectId).exec();
    if (!project) {
      throw new NotFoundError('Project', projectId);
    }
  }

  async getDeploymentAnalytics(
    projectId: string,
    granularity: Granularity,
    filters: DateFilters
  ): Promise<DeploymentAnalytics> {
    await this.verifyProjectExists(projectId);

    const matchStage: any = {
      projectId: new mongoose.Types.ObjectId(projectId),
      ...this.dateRangeFilter(filters),
    };

    const Deployment = mongoose.model('Deployment');
    
    // 1. Time-series aggregation
    const dateFormat = this.getMongoDateFormat(granularity);
    const series: any[] = await Deployment.aggregate([
      { $match: matchStage },
      {
        $project: {
          period: {
            $dateToString: {
              format: dateFormat,
              date: '$createdAt',
            },
          },
          status: 1,
        },
      },
      {
        $group: {
          _id: '$period',
          total: { $sum: 1 },
          succeeded: { $sum: { $cond: [{ $eq: ['$status', 'success'] }, 1, 0] } },
          failed: { $sum: { $cond: [{ $eq: ['$status', 'failed'] }, 1, 0] } },
          cancelled: { $sum: { $cond: [{ $eq: ['$status', 'cancelled'] }, 1, 0] } },
        },
      },
      {
        $project: {
          _id: 0,
          period: '$_id',
          total: '$total',
          succeeded: '$succeeded',
          failed: '$failed',
          cancelled: '$cancelled',
        },
      },
      { $sort: { period: 1 } },
    ]).exec();

    // 2. Overall Success Rate computation
    const overallStats = await Deployment.aggregate([
      { $match: matchStage },
      {
        $group: {
          _id: null,
          succeeded: { $sum: { $cond: [{ $eq: ['$status', 'success'] }, 1, 0] } },
          failed: { $sum: { $cond: [{ $eq: ['$status', 'failed'] }, 1, 0] } },
        },
      },
    ]).exec();

    let successRate = 0;
    if (overallStats.length > 0) {
      const { succeeded, failed } = overallStats[0];
      const divisor = succeeded + failed;
      if (divisor > 0) {
        successRate = (succeeded / divisor) * 100;
        // round to 2 decimal places
        successRate = Math.round(successRate * 100) / 100;
      }
    }

    return {
      successRate,
      series,
    };
  }

  async getApiKeyAnalytics(
    projectId: string,
    filters: DateFilters
  ): Promise<ApiKeyAnalyticsPeriod[]> {
    await this.verifyProjectExists(projectId);

    const matchStage: any = {
      projectId: new mongoose.Types.ObjectId(projectId),
      action: 'apiKey.used',
      outcome: 'success',
      ...this.dateRangeFilter(filters),
    };

    const AuditLog = mongoose.model('AuditLog');
    const apiKeyLogs = await AuditLog.aggregate([
      { $match: matchStage },
      {
        $project: {
          keyId: '$resource.id',
          keyName: '$resource.name',
          period: {
            $dateToString: {
              format: '%Y-%m-%d',
              date: '$createdAt',
            },
          },
          metadata: 1,
        },
      },
      {
        $group: {
          _id: { keyId: '$keyId', period: '$period' },
          count: { $sum: 1 },
          keyName: { $first: '$keyName' },
          keyPrefix: { $first: '$metadata.keyPrefix' },
        },
      },
      {
        $project: {
          _id: 0,
          keyId: '$_id.keyId',
          period: '$_id.period',
          keyName: '$keyName',
          keyPrefix: { $ifNull: ['$keyPrefix', 'unknown'] },
          count: '$count',
        },
      },
      { $sort: { period: 1, keyName: 1 } },
    ]).exec();

    return apiKeyLogs;
  }

  async getSecretAnalytics(
    projectId: string,
    filters: DateFilters
  ): Promise<SecretAnalytics[]> {
    await this.verifyProjectExists(projectId);

    const matchStage: any = {
      projectId: new mongoose.Types.ObjectId(projectId),
      action: 'secret.revealed',
      outcome: 'success',
      ...this.dateRangeFilter(filters),
    };

    const AuditLog = mongoose.model('AuditLog');
    const secretLogs = await AuditLog.aggregate([
      { $match: matchStage },
      {
        $group: {
          _id: '$resource.name',
          revealCount: { $sum: 1 },
        },
      },
      {
        $project: {
          _id: 0,
          secretName: '$_id',
          revealCount: '$revealCount',
        },
      },
      { $sort: { revealCount: -1, secretName: 1 } },
    ]).exec();

    return secretLogs;
  }

  async getWebhookAnalytics(
    projectId: string,
    filters: DateFilters
  ): Promise<WebhookAnalyticsPeriod[]> {
    await this.verifyProjectExists(projectId);

    // 1. Find all webhooks scoped to the project
    const Webhook = mongoose.model('Webhook');
    const webhooks = await Webhook.find({
      projectId: new mongoose.Types.ObjectId(projectId),
    }).exec();

    if (webhooks.length === 0) {
      return [];
    }

    const webhookIds = webhooks.map(w => w._id);
    const webhookMap = new Map(webhooks.map(w => [w._id.toString(), w.name]));

    const WebhookDelivery = mongoose.model('WebhookDelivery');
    
    const deliveryStats = await WebhookDelivery.aggregate([
      {
        $match: {
          webhookId: { $in: webhookIds },
          ...this.dateRangeFilter(filters),
        },
      },
      {
        $project: {
          webhookId: 1,
          period: {
            $dateToString: {
              format: '%Y-%m-%d',
              date: '$createdAt',
            },
          },
          status: 1,
        },
      },
      {
        $group: {
          _id: { webhookId: '$webhookId', period: '$period' },
          total: { $sum: 1 },
          succeeded: { $sum: { $cond: [{ $eq: ['$status', 'delivered'] }, 1, 0] } },
          failed: { $sum: { $cond: [{ $in: ['$status', ['failed', 'dead_letter']] }, 1, 0] } },
        },
      },
      {
        $project: {
          _id: 0,
          webhookId: '$_id.webhookId',
          period: '$_id.period',
          total: '$total',
          succeeded: '$succeeded',
          failed: '$failed',
          successRate: {
            $cond: [
              { $gt: ['$total', 0] },
              { $multiply: [{ $divide: ['$succeeded', '$total'] }, 100] },
              0
            ],
          },
        },
      },
      { $sort: { period: 1 } },
    ]).exec();

    return deliveryStats.map(stat => {
      const wId = stat.webhookId.toString();
      const rawRate = stat.successRate;
      const successRate = Math.round(rawRate * 100) / 100;
      return {
        webhookId: wId,
        webhookName: webhookMap.get(wId) || 'Unknown Webhook',
        period: stat.period,
        total: stat.total,
        succeeded: stat.succeeded,
        failed: stat.failed,
        successRate,
      };
    });
  }
}
