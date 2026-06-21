export type Granularity = 'day' | 'week' | 'month';

export interface DateFilters {
  startDate?: string;
  endDate?: string;
}

export interface DeploymentAnalyticsPeriod {
  period: string;
  total: number;
  succeeded: number;
  failed: number;
  cancelled: number;
}

export interface DeploymentAnalytics {
  successRate: number;
  series: DeploymentAnalyticsPeriod[];
}

export interface ApiKeyAnalyticsPeriod {
  keyId: string;
  keyName: string;
  keyPrefix: string;
  period: string;
  count: number;
}

export interface SecretAnalytics {
  secretName: string;
  revealCount: number;
}

export interface WebhookAnalyticsPeriod {
  webhookId: string;
  webhookName: string;
  period: string;
  total: number;
  succeeded: number;
  failed: number;
  successRate: number;
}
