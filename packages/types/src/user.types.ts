export interface NotificationPreferenceItem {
  inApp: boolean;
  email: boolean;
}

export interface UserNotificationPreferences {
  deployment: NotificationPreferenceItem;
  secret: NotificationPreferenceItem;
  apiKey: NotificationPreferenceItem;
  webhook: NotificationPreferenceItem;
}

export interface User {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  avatarUrl: string | null;
  isActive: boolean;
  mfaEnabled: boolean;
  isPlatformAdmin?: boolean;
  notificationPreferences?: UserNotificationPreferences;
  lastLoginAt: string | null;
  createdAt: string;
  updatedAt: string;
}


export interface AuthResponse {
  accessToken: string;
  user: User;
}
