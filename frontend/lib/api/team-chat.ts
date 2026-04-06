import apiClient from './client';

export interface TeamChatSender {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
}

export interface TeamChatMessage {
  id: string;
  body: string;
  createdAt: string;
  sender: TeamChatSender;
}

export const teamChatApi = {
  listMessages: async (limit = 80): Promise<{ messages: TeamChatMessage[] }> => {
    const res = await apiClient.get<{ messages: TeamChatMessage[] }>('/team-chat/messages', {
      params: { limit },
    });
    return res.data;
  },

  sendMessage: async (body: string): Promise<TeamChatMessage> => {
    const res = await apiClient.post<TeamChatMessage>('/team-chat/messages', { body });
    return res.data;
  },
};
