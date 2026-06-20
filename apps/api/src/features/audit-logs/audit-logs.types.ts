import type { AuditLog } from '@seladev/types';

export interface AuditLogFilters {
  actorId?: string;
  actorEmail?: string;
  action?: string | string[];
  resourceType?: string;
  resourceId?: string;
  outcome?: 'success' | 'failure';
  startDate?: string; // ISO String
  endDate?: string;   // ISO String
}

export interface AuditLogHistoryResponse {
  logs: AuditLog[];
  nextCursor: string | null;
  hasNext: boolean;
}
