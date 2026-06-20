export type NotificationType = 'info' | 'success' | 'warning' | 'error';
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
//# sourceMappingURL=notification.types.d.ts.map