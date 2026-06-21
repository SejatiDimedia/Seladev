import mongoose from 'mongoose';
import type { NotificationDocument } from '../../infrastructure/database/models/notification.model';
import { NotificationModel } from '../../infrastructure/database/models/notification.model';

export interface NotificationsRepository {
  create(data: Partial<NotificationDocument>): Promise<NotificationDocument>;
  findManyByUser(
    userId: string,
    limit: number,
    cursor?: string | null
  ): Promise<{ notifications: NotificationDocument[]; hasNext: boolean; nextCursor: string | null }>;
  markAsRead(notificationId: string, userId: string): Promise<NotificationDocument | null>;
  markAllAsRead(userId: string): Promise<void>;
  countUnread(userId: string): Promise<number>;
}

export class MongooseNotificationsRepository implements NotificationsRepository {
  async create(data: Partial<NotificationDocument>): Promise<NotificationDocument> {
    return NotificationModel.create(data);
  }

  async findManyByUser(
    userId: string,
    limit: number,
    cursor?: string | null
  ): Promise<{ notifications: NotificationDocument[]; hasNext: boolean; nextCursor: string | null }> {
    const query: any = { userId: new mongoose.Types.ObjectId(userId) };

    if (cursor) {
      try {
        const decoded = JSON.parse(Buffer.from(cursor, 'base64').toString('utf8'));
        const { id, ts } = decoded;
        if (id && ts) {
          query.$or = [
            { createdAt: { $lt: new Date(ts) } },
            { createdAt: new Date(ts), _id: { $lt: new mongoose.Types.ObjectId(id) } },
          ];
        }
      } catch (err) {
        // Ignore invalid cursor
      }
    }

    const notifications = await NotificationModel.find(query)
      .sort({ createdAt: -1, _id: -1 })
      .limit(limit + 1)
      .exec();

    const hasNext = notifications.length > limit;
    const slicedNotifications = hasNext ? notifications.slice(0, limit) : notifications;

    let nextCursor: string | null = null;
    if (hasNext && slicedNotifications.length > 0) {
      const lastDoc = slicedNotifications[slicedNotifications.length - 1]!;
      nextCursor = Buffer.from(
        JSON.stringify({
          id: lastDoc._id.toString(),
          ts: lastDoc.createdAt.toISOString(),
        })
      ).toString('base64');
    }

    return {
      notifications: slicedNotifications,
      hasNext,
      nextCursor,
    };
  }

  async markAsRead(notificationId: string, userId: string): Promise<NotificationDocument | null> {
    return NotificationModel.findOneAndUpdate(
      {
        _id: new mongoose.Types.ObjectId(notificationId),
        userId: new mongoose.Types.ObjectId(userId),
      },
      { isRead: true },
      { new: true }
    ).exec();
  }

  async markAllAsRead(userId: string): Promise<void> {
    await NotificationModel.updateMany(
      {
        userId: new mongoose.Types.ObjectId(userId),
        isRead: false,
      },
      { isRead: true }
    ).exec();
  }

  async countUnread(userId: string): Promise<number> {
    return NotificationModel.countDocuments({
      userId: new mongoose.Types.ObjectId(userId),
      isRead: false,
    }).exec();
  }
}
