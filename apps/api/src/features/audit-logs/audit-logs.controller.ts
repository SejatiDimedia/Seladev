import type { Request, Response } from 'express';
import { asyncWrapper } from '../../lib/async-wrapper';
import type { AuditLogsService } from './audit-logs.service';
import type { AuditLogFilters } from './audit-logs.types';

export class AuditLogsController {
  constructor(private readonly auditLogsService: AuditLogsService) {}

  listHistory = asyncWrapper(async (req: Request, res: Response): Promise<void> => {
    const orgIdOrSlug = req.params.orgIdOrSlug!;
    const user = (req as any).user;

    const limit = req.query.limit ? Number(req.query.limit) : 20;
    const cursor = req.query.cursor ? String(req.query.cursor) : null;

    const filters: AuditLogFilters = {};
    if (req.query.actorId) filters.actorId = String(req.query.actorId);
    if (req.query.actorEmail) filters.actorEmail = String(req.query.actorEmail);
    if (req.query.action) {
      filters.action = Array.isArray(req.query.action)
        ? (req.query.action as string[])
        : String(req.query.action);
    }
    if (req.query.resourceType) filters.resourceType = String(req.query.resourceType);
    if (req.query.resourceId) filters.resourceId = String(req.query.resourceId);
    if (req.query.outcome) filters.outcome = String(req.query.outcome) as 'success' | 'failure';
    if (req.query.startDate) filters.startDate = String(req.query.startDate);
    if (req.query.endDate) filters.endDate = String(req.query.endDate);

    const { logs, hasNext, nextCursor } = await this.auditLogsService.listHistory(
      user,
      orgIdOrSlug,
      limit,
      cursor,
      filters
    );

    res.status(200).json({
      success: true,
      data: logs.map((l) => l.toJSON()),
      pagination: {
        nextCursor,
        hasNext,
      },
    });
  });
}
