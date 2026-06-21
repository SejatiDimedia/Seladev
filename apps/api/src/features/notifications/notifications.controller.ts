import type { Request, Response, NextFunction } from 'express';
import { NotificationsService } from './notifications.service';
import { NotFoundError } from '../../lib/errors';

export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  getUserNotifications = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = (req as any).user.id;
      const limit = Number(req.query.limit) || 20;
      const cursor = req.query.cursor ? String(req.query.cursor) : null;

      const result = await this.notificationsService.getUserNotifications(userId, limit, cursor);

      res.status(200).json({
        success: true,
        data: result,
      });
    } catch (err) {
      next(err);
    }
  };

  markAsRead = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = (req as any).user.id;
      const { notificationId } = req.params;

      const result = await this.notificationsService.markAsRead(notificationId!, userId);
      if (!result) {
        throw new NotFoundError('Notification not found or access denied');
      }

      res.status(200).json({
        success: true,
        data: result,
      });
    } catch (err) {
      next(err);
    }
  };

  markAllAsRead = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = (req as any).user.id;

      await this.notificationsService.markAllAsRead(userId);

      res.status(200).json({
        success: true,
        message: 'All notifications marked as read',
      });
    } catch (err) {
      next(err);
    }
  };

  getPreferences = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = (req as any).user.id;

      const result = await this.notificationsService.getPreferences(userId);

      res.status(200).json({
        success: true,
        data: result,
      });
    } catch (err) {
      next(err);
    }
  };

  updatePreferences = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = (req as any).user.id;
      const preferences = req.body;

      const result = await this.notificationsService.updatePreferences(userId, preferences);

      res.status(200).json({
        success: true,
        data: result,
      });
    } catch (err) {
      next(err);
    }
  };
}
