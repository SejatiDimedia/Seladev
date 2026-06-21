import { describe, it, expect, beforeEach, vi } from 'vitest';
import mongoose from 'mongoose';
import { AnalyticsService } from '../analytics.service';
import { NotFoundError } from '../../../lib/errors';

const validProjId = '60d21b4667d0d8992c616c21';
const validOrgId = '60d21b4667d0d8992c616c22';
const validWhId1 = '60d21b4667d0d8992c616c23';
const validWhId2 = '60d21b4667d0d8992c616c24';
const validKeyId1 = '60d21b4667d0d8992c616c25';
const validKeyId2 = '60d21b4667d0d8992c616c26';
const invalidProjId = '60d21b4667d0d8992c616c00';

// Register schemas to prevent MissingSchemaError
if (!mongoose.models.Project) {
  mongoose.model('Project', new mongoose.Schema({}));
}
if (!mongoose.models.Deployment) {
  mongoose.model('Deployment', new mongoose.Schema({}));
}
if (!mongoose.models.AuditLog) {
  mongoose.model('AuditLog', new mongoose.Schema({}));
}
if (!mongoose.models.Webhook) {
  mongoose.model('Webhook', new mongoose.Schema({}));
}
if (!mongoose.models.WebhookDelivery) {
  mongoose.model('WebhookDelivery', new mongoose.Schema({}));
}

describe('AnalyticsService', () => {
  let service: AnalyticsService;

  beforeEach(() => {
    vi.restoreAllMocks();
    service = new AnalyticsService();
  });

  describe('verifyProjectExists helper', () => {
    it('should throw NotFoundError if project does not exist', async () => {
      vi.spyOn(mongoose.model('Project'), 'findById').mockReturnValueOnce({
        exec: async () => null,
      } as any);

      await expect(
        service.getDeploymentAnalytics(invalidProjId, 'day', {})
      ).rejects.toThrow(NotFoundError);
    });
  });

  describe('getDeploymentAnalytics', () => {
    it('should return correct deployment metrics and success rate', async () => {
      vi.spyOn(mongoose.model('Project'), 'findById').mockReturnValueOnce({
        exec: async () => ({ _id: validProjId, id: validProjId, organizationId: validOrgId, name: 'Test Project' }),
      } as any);

      const mockSeries = [
        { period: '2026-06-20', total: 5, succeeded: 4, failed: 1, cancelled: 0 },
        { period: '2026-06-21', total: 3, succeeded: 2, failed: 0, cancelled: 1 },
      ];

      const aggregateSpy = vi.spyOn(mongoose.model('Deployment'), 'aggregate').mockImplementation((pipeline: any[]) => {
        if (pipeline.some(stage => stage.$group && stage.$group._id === '$period')) {
          return {
            exec: async () => mockSeries,
          } as any;
        }
        return {
          exec: async () => [{ succeeded: 6, failed: 1 }],
        } as any;
      });

      const result = await service.getDeploymentAnalytics(validProjId, 'day', {
        startDate: '2026-06-01T00:00:00.000Z',
        endDate: '2026-06-30T00:00:00.000Z',
      });

      expect(result.successRate).toBe(85.71); // 6 / 7 * 100
      expect(result.series).toEqual(mockSeries);
      expect(aggregateSpy).toHaveBeenCalledTimes(2);
    });

    it('should handle zero success/failed deployments gracefully', async () => {
      vi.spyOn(mongoose.model('Project'), 'findById').mockReturnValueOnce({
        exec: async () => ({ _id: validProjId, id: validProjId, organizationId: validOrgId, name: 'Test Project' }),
      } as any);

      vi.spyOn(mongoose.model('Deployment'), 'aggregate').mockImplementation(() => {
        return { exec: async () => [] } as any;
      });

      const result = await service.getDeploymentAnalytics(validProjId, 'day', {});
      expect(result.successRate).toBe(0);
      expect(result.series).toEqual([]);
    });
  });

  describe('getApiKeyAnalytics', () => {
    it('should group API key usages by day', async () => {
      vi.spyOn(mongoose.model('Project'), 'findById').mockReturnValueOnce({
        exec: async () => ({ _id: validProjId, id: validProjId, organizationId: validOrgId, name: 'Test Project' }),
      } as any);

      const mockData = [
        { keyId: validKeyId1, period: '2026-06-20', keyName: 'CI Key', keyPrefix: 'sdv_sk_abc', count: 12 },
        { keyId: validKeyId2, period: '2026-06-20', keyName: 'Prod Key', keyPrefix: 'sdv_sk_xyz', count: 5 },
      ];

      const aggregateSpy = vi.spyOn(mongoose.model('AuditLog'), 'aggregate').mockReturnValue({
        exec: async () => mockData,
      } as any);

      const result = await service.getApiKeyAnalytics(validProjId, {});
      expect(result).toEqual(mockData);
      expect(aggregateSpy).toHaveBeenCalledWith(
        expect.arrayContaining([
          {
            $match: expect.objectContaining({
              action: 'apiKey.used',
              projectId: new mongoose.Types.ObjectId(validProjId),
            }),
          },
        ])
      );
    });
  });

  describe('getSecretAnalytics', () => {
    it('should return total reveal counts per secret key name sorted descending', async () => {
      vi.spyOn(mongoose.model('Project'), 'findById').mockReturnValueOnce({
        exec: async () => ({ _id: validProjId, id: validProjId, organizationId: validOrgId, name: 'Test Project' }),
      } as any);

      const mockData = [
        { secretName: 'DATABASE_URL', revealCount: 15 },
        { secretName: 'STRIPE_API_KEY', revealCount: 8 },
      ];

      vi.spyOn(mongoose.model('AuditLog'), 'aggregate').mockReturnValue({
        exec: async () => mockData,
      } as any);

      const result = await service.getSecretAnalytics(validProjId, {});
      expect(result).toEqual(mockData);
    });
  });

  describe('getWebhookAnalytics', () => {
    it('should retrieve delivery metrics mapped to correct webhook names', async () => {
      vi.spyOn(mongoose.model('Project'), 'findById').mockReturnValueOnce({
        exec: async () => ({ _id: validProjId, id: validProjId, organizationId: validOrgId, name: 'Test Project' }),
      } as any);

      vi.spyOn(mongoose.model('Webhook'), 'find').mockReturnValueOnce({
        exec: async () => [
          { _id: new mongoose.Types.ObjectId(validWhId1), id: validWhId1, name: 'Slack Webhook', projectId: validProjId },
          { _id: new mongoose.Types.ObjectId(validWhId2), id: validWhId2, name: 'Discord Webhook', projectId: validProjId },
        ],
      } as any);

      const mockStats = [
        { webhookId: validWhId1, period: '2026-06-20', total: 10, succeeded: 8, failed: 2, successRate: 80.0 },
        { webhookId: validWhId2, period: '2026-06-20', total: 5, succeeded: 5, failed: 0, successRate: 100.0 },
      ];

      vi.spyOn(mongoose.model('WebhookDelivery'), 'aggregate').mockReturnValue({
        exec: async () => mockStats,
      } as any);

      const result = await service.getWebhookAnalytics(validProjId, {});
      expect(result).toEqual([
        {
          webhookId: validWhId1,
          webhookName: 'Slack Webhook',
          period: '2026-06-20',
          total: 10,
          succeeded: 8,
          failed: 2,
          successRate: 80.0,
        },
        {
          webhookId: validWhId2,
          webhookName: 'Discord Webhook',
          period: '2026-06-20',
          total: 5,
          succeeded: 5,
          failed: 0,
          successRate: 100.0,
        },
      ]);
    });

    it('should return empty array if no webhooks exist for project', async () => {
      vi.spyOn(mongoose.model('Project'), 'findById').mockReturnValueOnce({
        exec: async () => ({ _id: validProjId, id: validProjId, organizationId: validOrgId, name: 'Test Project' }),
      } as any);

      vi.spyOn(mongoose.model('Webhook'), 'find').mockReturnValueOnce({
        exec: async () => [],
      } as any);

      const result = await service.getWebhookAnalytics(validProjId, {});
      expect(result).toEqual([]);
    });
  });
});
