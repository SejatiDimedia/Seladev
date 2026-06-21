export type NotificationType =
  | 'deployment.succeeded'
  | 'deployment.failed'
  | 'secret.expiring'
  | 'api_key.expiring'
  | 'webhook.delivery_failed'
  | 'role.changed'
  | 'member.added';

export interface Notification {
  id: string;
  userId: string;
  organizationId: string;
  title: string;
  message: string;
  type: NotificationType;
  link: string | null;
  isRead: boolean;
  createdAt: string;
}

