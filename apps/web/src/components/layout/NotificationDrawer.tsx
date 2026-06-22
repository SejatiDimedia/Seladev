import { useEffect, useState } from 'react';
import { getSocket } from '../../lib/socket';
import { apiClient } from '../../lib/api-client';
import { X, Bell, Check, Mail, Settings, MessageSquare, ShieldCheck } from 'lucide-react';
import clsx from 'clsx';

interface NotificationDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  onUnreadCountChange: (count: number) => void;
}

export interface Notification {
  id: string;
  title: string;
  message: string;
  type: 'system' | 'deployment' | 'security' | 'webhook' | 'organization' | 'project';
  read: boolean;
  createdAt: string;
}

export function NotificationDrawer({ isOpen, onClose, onUnreadCountChange }: NotificationDrawerProps) {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchNotifications = async () => {
    setLoading(true);
    try {
      const response = await apiClient.get('/notifications');
      const data = response.data.data;
      setNotifications(data);
      const unreadCount = data.filter((n: Notification) => !n.read).length;
      onUnreadCountChange(unreadCount);
    } catch (err) {
      console.error('Failed to fetch notifications', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      fetchNotifications();
    }
  }, [isOpen]);

  useEffect(() => {
    const socket = getSocket();
    
    const handleNewNotification = (notification: Notification) => {
      setNotifications((prev) => [notification, ...prev]);
    };

    const handleCountUpdate = ({ unreadCount }: { unreadCount: number }) => {
      onUnreadCountChange(unreadCount);
    };

    socket.on('notification:received', handleNewNotification);
    socket.on('notification:unread_count_updated', handleCountUpdate);

    // Initial check of unread count
    apiClient.get('/notifications')
      .then((res) => {
        const count = res.data.data.filter((n: Notification) => !n.read).length;
        onUnreadCountChange(count);
      })
      .catch(() => {});

    return () => {
      socket.off('notification:received', handleNewNotification);
      socket.off('notification:unread_count_updated', handleCountUpdate);
    };
  }, [onUnreadCountChange]);

  const handleMarkAsRead = async (id: string) => {
    try {
      await apiClient.post(`/notifications/${id}/read`);
      setNotifications((prev) =>
        prev.map((n) => (n.id === id ? { ...n, read: true } : n))
      );
      // Trigger a count update recalculation
      const unread = notifications.filter((n) => n.id !== id ? !n.read : false).length;
      onUnreadCountChange(unread);
    } catch (err) {
      console.error('Failed to mark notification as read', err);
    }
  };

  const handleMarkAllRead = async () => {
    try {
      await apiClient.post('/notifications/read-all');
      setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
      onUnreadCountChange(0);
    } catch (err) {
      console.error('Failed to mark all as read', err);
    }
  };

  const getIcon = (type: string) => {
    switch (type) {
      case 'system':
        return <Settings className="w-4 h-4 text-blue-400" />;
      case 'deployment':
        return <MessageSquare className="w-4 h-4 text-indigo-400" />;
      case 'security':
        return <ShieldCheck className="w-4 h-4 text-emerald-400" />;
      case 'webhook':
        return <Mail className="w-4 h-4 text-purple-400" />;
      default:
        return <Bell className="w-4 h-4 text-neutral-400" />;
    }
  };

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        className={clsx(
          'fixed inset-0 bg-black/60 backdrop-blur-sm z-[9999] transition-opacity duration-300',
          isOpen ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
        )}
      ></div>

      {/* Drawer */}
      <div
        className={clsx(
          'fixed top-0 right-0 h-full w-full max-w-md glass-panel border-l border-white/5 z-[10000] transition-transform duration-300 ease-out flex flex-col',
          isOpen ? 'translate-x-0' : 'translate-x-full'
        )}
      >
        {/* Header */}
        <div className="p-6 border-b border-white/5 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <Bell className="w-5 h-5 text-indigo-400" />
            <h3 className="font-bold text-lg text-white">Notifications</h3>
          </div>
          <div className="flex items-center gap-3">
            {notifications.some((n) => !n.read) && (
              <button
                onClick={handleMarkAllRead}
                className="text-xs text-indigo-400 hover:text-indigo-300 font-medium flex items-center gap-1 transition-colors"
              >
                <Check className="w-3.5 h-3.5" />
                Mark all read
              </button>
            )}
            <button
              onClick={onClose}
              className="p-1.5 hover:bg-white/5 rounded-lg text-neutral-400 hover:text-white transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-grow overflow-y-auto p-6 space-y-4">
          {loading && notifications.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-40 text-neutral-500 gap-2">
              <div className="w-6 h-6 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin"></div>
              <span className="text-xs">Loading notifications...</span>
            </div>
          ) : notifications.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-40 text-neutral-500 gap-2">
              <Bell className="w-8 h-8 opacity-30" />
              <span className="text-xs font-medium">All caught up! No notifications.</span>
            </div>
          ) : (
            notifications.map((notification) => (
              <div
                key={notification.id}
                className={clsx(
                  'p-4 rounded-xl border transition-all flex gap-3 relative group',
                  notification.read
                    ? 'bg-white/[0.01] border-white/5 opacity-60'
                    : 'bg-white/[0.04] border-white/10 shadow-lg'
                )}
              >
                <div className="p-2 bg-white/5 rounded-lg h-fit flex items-center justify-center border border-white/5">
                  {getIcon(notification.type)}
                </div>

                <div className="space-y-1 pr-6 flex-grow">
                  <h4 className="font-semibold text-sm text-white leading-tight">
                    {notification.title}
                  </h4>
                  <p className="text-xs text-neutral-400 leading-relaxed font-light">
                    {notification.message}
                  </p>
                  <span className="text-[10px] text-neutral-500 block">
                    {new Date(notification.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>

                {!notification.read && (
                  <button
                    onClick={() => handleMarkAsRead(notification.id)}
                    className="absolute right-4 top-4 p-1 bg-indigo-500/10 text-indigo-400 hover:bg-indigo-500 hover:text-white rounded-md opacity-0 group-hover:opacity-100 transition-opacity"
                    title="Mark as read"
                  >
                    <Check className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </>
  );
}
