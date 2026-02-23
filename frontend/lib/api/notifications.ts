import apiClient from './client';

export interface Notification {
  id: string;
  userId: string;
  type: string;
  title: string;
  body: string | null;
  link: string | null;
  readAt: string | null;
  createdAt: string;
}

export const notificationsApi = {
  list: async (): Promise<Notification[]> => {
    const res = await apiClient.get<Notification[]>('/notifications');
    return res.data;
  },
  getUnreadCount: async (): Promise<{ count: number }> => {
    const res = await apiClient.get<{ count: number }>('/notifications/unread-count');
    return res.data;
  },
  markRead: async (id: string): Promise<{ ok: boolean }> => {
    const res = await apiClient.patch<{ ok: boolean }>(`/notifications/${id}/read`, {});
    return res.data;
  },
  markAllRead: async (): Promise<{ ok: boolean }> => {
    const res = await apiClient.patch<{ ok: boolean }>('/notifications/read-all', {});
    return res.data;
  },
};
