import type { Request, Response } from 'express';
import { asyncWrapper } from '../../lib/async-wrapper';
import type { AnalyticsService } from './analytics.service';
import type { Granularity } from './analytics.types';
import { ValidationError } from '../../lib/errors';

export class AnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService) {}

  private parseDateFilters(req: Request) {
    const { startDate, endDate } = req.query;
    const filters: { startDate?: string; endDate?: string } = {};

    if (startDate) {
      const start = new Date(String(startDate));
      if (isNaN(start.getTime())) {
        throw new ValidationError([], 'Invalid startDate format. Must be an ISO date string.');
      }
      filters.startDate = start.toISOString();
    }

    if (endDate) {
      const end = new Date(String(endDate));
      if (isNaN(end.getTime())) {
        throw new ValidationError([], 'Invalid endDate format. Must be an ISO date string.');
      }
      filters.endDate = end.toISOString();
    }

    return filters;
  }

  getDeployments = asyncWrapper(async (req: Request, res: Response): Promise<void> => {
    const { projectId } = req.params;
    const granularity = (req.query.granularity ? String(req.query.granularity) : 'day') as Granularity;

    if (!['day', 'week', 'month'].includes(granularity)) {
      throw new ValidationError([], 'Invalid granularity. Must be "day", "week", or "month".');
    }

    const filters = this.parseDateFilters(req);
    const data = await this.analyticsService.getDeploymentAnalytics(projectId!, granularity, filters);

    res.status(200).json({
      success: true,
      data,
    });
  });

  getApiKeys = asyncWrapper(async (req: Request, res: Response): Promise<void> => {
    const { projectId } = req.params;
    const filters = this.parseDateFilters(req);
    const data = await this.analyticsService.getApiKeyAnalytics(projectId!, filters);

    res.status(200).json({
      success: true,
      data,
    });
  });

  getSecrets = asyncWrapper(async (req: Request, res: Response): Promise<void> => {
    const { projectId } = req.params;
    const filters = this.parseDateFilters(req);
    const data = await this.analyticsService.getSecretAnalytics(projectId!, filters);

    res.status(200).json({
      success: true,
      data,
    });
  });

  getWebhooks = asyncWrapper(async (req: Request, res: Response): Promise<void> => {
    const { projectId } = req.params;
    const filters = this.parseDateFilters(req);
    const data = await this.analyticsService.getWebhookAnalytics(projectId!, filters);

    res.status(200).json({
      success: true,
      data,
    });
  });
}
