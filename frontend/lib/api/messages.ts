import apiClient from './client';

export interface ConversationWithUser {
  id: string;
  userId: string;
  createdAt: string;
  updatedAt: string;
  user?: { id: string; email: string; firstName?: string; lastName?: string };
  unreadCount?: number;
  lastMessage?: Message;
}

export interface Message {
  id: string;
  conversationId: string;
  senderId: string;
  body: string;
  readAt: string | null;
  createdAt: string;
  sender?: { id: string; email: string; firstName?: string; lastName?: string; role: string };
}

export const messagesApi = {
  getMyConversation: async (): Promise<{ conversation: ConversationWithUser | null; messages: Message[] }> => {
    const res = await apiClient.get('/messages/me');
    return res.data;
  },
  getUnreadCount: async (): Promise<{ count: number }> => {
    const res = await apiClient.get<{ count: number }>('/messages/unread-count');
    return res.data;
  },
  sendMessage: async (body: string): Promise<Message> => {
    const res = await apiClient.post<Message>('/messages/send', { body });
    return res.data;
  },
  markRead: async (): Promise<{ ok: boolean }> => {
    const res = await apiClient.post<{ ok: boolean }>('/messages/mark-read', {});
    return res.data;
  },
  // Admin
  listConversations: async (): Promise<ConversationWithUser[]> => {
    const res = await apiClient.get<ConversationWithUser[]>('/messages/admin/conversations');
    return res.data;
  },
  getConversationMessages: async (conversationId: string): Promise<Message[]> => {
    const res = await apiClient.get<Message[]>(`/messages/admin/conversations/${conversationId}/messages`);
    return res.data;
  },
  adminReply: async (conversationId: string, body: string): Promise<Message> => {
    const res = await apiClient.post<Message>(`/messages/admin/conversations/${conversationId}/reply`, { body });
    return res.data;
  },
  adminMarkRead: async (conversationId: string): Promise<{ ok: boolean }> => {
    const res = await apiClient.post<{ ok: boolean }>(`/messages/admin/conversations/${conversationId}/mark-read`, {});
    return res.data;
  },
};
