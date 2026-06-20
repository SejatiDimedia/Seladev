import type { Request, Response, NextFunction } from 'express';
import { NotFoundError } from '../lib/errors';

export function notFoundHandler(req: Request, _res: Response, next: NextFunction): void {
  next(new NotFoundError('Route', `${req.method} ${req.path}`));
}
