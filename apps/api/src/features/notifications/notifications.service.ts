import type { NotificationType } from '@seladev/types';
import type { UserNotificationPreferences, UpdatePreferencesDto } from './notifications.types';
import type { NotificationsRepository } from './notifications.repository';
import { UserModel } from '../../infrastructure/database/models/user.model';
import { ProjectMemberModel } from '../../infrastructure/database/models/project-member.model';
import { ProjectModel } from '../../infrastructure/database/models/project.model';
import { EnvironmentModel } from '../../infrastructure/database/models/environment.model';
import { SecretModel } from '../../infrastructure/database/models/secret.model';
import { ApiKeyModel } from '../../infrastructure/database/models/api-key.model';
import { MembershipModel } from '../../infrastructure/database/models/membership.model';
import { getSocketServer } from '../../config/socket';
import { getEmailNotificationsQueue } from '../../config/queue';
import { NotFoundError } from '../../lib/errors';
import mongoose from 'mongoose';

export class NotificationsService {
  constructor(private readonly notificationsRepo: NotificationsRepository) {}

  async createNotification(
    userId: string,
    organizationId: string,
    type: NotificationType,
    title: string,
    message: string,
    link: string | null = null
  ): Promise<any> {
    const user = await UserModel.findById(userId).exec();
    if (!user) {
      throw new NotFoundError('User not found');
    }

    const preferences = user.notificationPreferences;
    let inAppEnabled = true;
    let emailEnabled = true;

    // Map notification types to preference categories
    if (type.startsWith('deployment.')) {
      inAppEnabled = preferences?.deployment?.inApp !== false;
      emailEnabled = preferences?.deployment?.email !== false;
    } else if (type.startsWith('secret.')) {
      inAppEnabled = preferences?.secret?.inApp !== false;
      emailEnabled = preferences?.secret?.email !== false;
    } else if (type.startsWith('api_key.')) {
      inAppEnabled = preferences?.apiKey?.inApp !== false;
      emailEnabled = preferences?.apiKey?.email !== false;
    } else if (type.startsWith('webhook.')) {
      inAppEnabled = preferences?.webhook?.inApp !== false;
      emailEnabled = preferences?.webhook?.email !== false;
    }
    // Critical events bypass user preferences (e.g. role.changed, member.added)

    let savedDoc: any = null;

    if (inAppEnabled) {
      savedDoc = await this.notificationsRepo.create({
        userId: new mongoose.Types.ObjectId(userId),
        organizationId: new mongoose.Types.ObjectId(organizationId),
        type,
        title,
        message,
        link,
        isRead: false,
      });

      // Push real-time event
      try {
        const io = getSocketServer();
        const unreadCount = await this.notificationsRepo.countUnread(userId);
        io.to(`user:${userId}`).emit('notification:received', {
          notification: savedDoc.toJSON(),
          unreadCount,
        });
      } catch (err) {
        // Socket server might not be initialized in tests, ignore
      }
    }

    if (emailEnabled && user.email) {
      try {
        const queue = getEmailNotificationsQueue();
        await queue.add('send-email', {
          to: user.email,
          subject: title,
          body: message,
          html: `
            <div style="font-family: sans-serif; padding: 20px; max-width: 600px; margin: 0 auto; border: 1px solid #e5e7eb; border-radius: 8px;">
              <h2 style="color: #4f46e5; margin-top: 0;">${title}</h2>
              <p style="color: #374151; line-height: 1.5;">${message}</p>
              ${
                link
                  ? `<div style="margin-top: 24px;">
                      <a href="${link}" style="background-color: #4f46e5; color: white; padding: 10px 18px; text-decoration: none; border-radius: 6px; font-weight: 500;">View on SELADEV</a>
                    </div>`
                  : ''
              }
            </div>
          `,
        });
      } catch (err) {
        console.error('[Notifications Service] Failed to enqueue email job:', err);
      }
    }

    return savedDoc;
  }

  async getUserNotifications(
    userId: string,
    limit: number = 20,
    cursor?: string | null
  ): Promise<{ notifications: any[]; hasNext: boolean; nextCursor: string | null }> {
    const { notifications, hasNext, nextCursor } = await this.notificationsRepo.findManyByUser(userId, limit, cursor);
    return {
      notifications: notifications.map(n => n.toJSON()),
      hasNext,
      nextCursor,
    };
  }

  async markAsRead(notificationId: string, userId: string): Promise<any> {
    const updated = await this.notificationsRepo.markAsRead(notificationId, userId);
    if (updated) {
      try {
        const io = getSocketServer();
        const unreadCount = await this.notificationsRepo.countUnread(userId);
        io.to(`user:${userId}`).emit('notification:unread_count_updated', { unreadCount });
      } catch (err) {
        // Ignore
      }
    }
    return updated ? updated.toJSON() : null;
  }

  async markAllAsRead(userId: string): Promise<void> {
    await this.notificationsRepo.markAllAsRead(userId);
    try {
      const io = getSocketServer();
      io.to(`user:${userId}`).emit('notification:unread_count_updated', { unreadCount: 0 });
    } catch (err) {
      // Ignore
    }
  }

  async getPreferences(userId: string): Promise<UserNotificationPreferences> {
    const user = await UserModel.findById(userId).exec();
    if (!user) {
      throw new NotFoundError('User not found');
    }

    // Return current preferences or default ones
    return user.notificationPreferences || {
      deployment: { inApp: true, email: true },
      secret: { inApp: true, email: true },
      apiKey: { inApp: true, email: true },
      webhook: { inApp: true, email: true },
    };
  }

  async updatePreferences(userId: string, dto: UpdatePreferencesDto): Promise<UserNotificationPreferences> {
    const user = await UserModel.findById(userId).exec();
    if (!user) {
      throw new NotFoundError('User not found');
    }

    user.notificationPreferences = dto as UserNotificationPreferences;
    await user.save();
    return user.notificationPreferences;
  }

  async checkExpirations(): Promise<void> {
    const now = new Date();
    const sevenDaysFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

    // 1. Secrets Expiration Check
    const expiringSecrets = await SecretModel.find({
      expiresAt: { $gt: now, $lte: sevenDaysFromNow },
      expiryNotified: false,
    }).exec();

    for (const secret of expiringSecrets) {
      // Find project admins
      const admins = await ProjectMemberModel.find({
        projectId: secret.projectId,
        role: 'admin',
      }).exec();

      const project = await ProjectModel.findById(secret.projectId).exec();
      const env = await EnvironmentModel.findById(secret.environmentId).exec();
      const projectName = project ? project.name : 'Unknown';
      const envName = env ? env.name : 'Unknown';

      for (const admin of admins) {
        await this.createNotification(
          admin.userId.toString(),
          secret.organizationId.toString(),
          'secret.expiring',
          'Secret Expiring Soon',
          `Secret "${secret.key}" in project "${projectName}" (${envName}) will expire on ${secret.expiresAt?.toLocaleDateString()}`,
          `/projects/${secret.projectId.toString()}/environments/${secret.environmentId.toString()}/secrets`
        ).catch(err => console.error('Failed to notify secret expiry:', err));
      }

      secret.expiryNotified = true;
      await secret.save();
    }

    // 2. API Keys Expiration Check
    const expiringApiKeys = await ApiKeyModel.find({
      expiresAt: { $gt: now, $lte: sevenDaysFromNow },
      expiryNotified: false,
    }).exec();

    for (const apiKey of expiringApiKeys) {
      let recipientUserIds: string[] = [];

      if (apiKey.projectId) {
        // Project scoped API Key: Notify project admins
        const admins = await ProjectMemberModel.find({
          projectId: apiKey.projectId,
          role: 'admin',
        }).exec();
        recipientUserIds = admins.map(a => a.userId.toString());
      } else {
        // Organization scoped API Key: Notify org admins
        const memberships = await MembershipModel.find({
          organizationId: apiKey.organizationId,
          role: { $in: ['admin', 'owner'] },
          status: 'active',
        }).exec();
        recipientUserIds = memberships.map(m => m.userId.toString());
      }

      for (const userId of recipientUserIds) {
        await this.createNotification(
          userId,
          apiKey.organizationId.toString(),
          'api_key.expiring',
          'API Key Expiring Soon',
          `API Key "${apiKey.name}" will expire on ${apiKey.expiresAt?.toLocaleDateString()}`,
          `/settings` // Direct to org settings where API keys might be listed
        ).catch(err => console.error('Failed to notify API Key expiry:', err));
      }

      apiKey.expiryNotified = true;
      await apiKey.save();
    }
  }
}
