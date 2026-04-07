import apiClient from './client';
import Cookies from 'js-cookie';
import { accessTokenCookieWriteAttributes } from './access-token-cookie';

export interface TeamInvitePreview {
  companyName: string;
  branchName: string;
  emailMasked: string;
  role: string;
}

export interface TeamInviteRow {
  id: string;
  email: string;
  role: string;
  status: string;
  expiresAt: string;
  createdAt: string;
  branchId: string;
}

export interface CreateTeamInvitePayload {
  email: string;
  branchId: string;
  role?: 'viewer' | 'estimator';
  companyId?: string;
}

export interface CreateTeamInviteResponse {
  id: string;
  joinUrl: string;
  emailSent: boolean;
}

export interface AuthResponse {
  access_token: string;
  user: {
    id: string;
    email: string;
    role: string;
    companyId: string;
    firstName?: string;
    lastName?: string;
  };
}

function setAuthCookie(token: string) {
  Cookies.set('access_token', token, accessTokenCookieWriteAttributes());
}

export const teamInvitesApi = {
  preview: async (token: string): Promise<TeamInvitePreview> => {
    const res = await apiClient.get<TeamInvitePreview>('/auth/team-invites/preview', {
      params: { token },
    });
    return res.data;
  },

  acceptSignup: async (payload: {
    token: string;
    password: string;
    firstName: string;
    lastName: string;
  }): Promise<AuthResponse> => {
    const res = await apiClient.post<AuthResponse>('/auth/team-invites/accept-signup', payload);
    setAuthCookie(res.data.access_token);
    return res.data;
  },

  acceptSession: async (token: string): Promise<AuthResponse> => {
    const res = await apiClient.post<AuthResponse>('/auth/team-invites/accept-session', { token });
    setAuthCookie(res.data.access_token);
    return res.data;
  },

  create: async (payload: CreateTeamInvitePayload): Promise<CreateTeamInviteResponse> => {
    const res = await apiClient.post<CreateTeamInviteResponse>('/auth/team-invites', payload);
    return res.data;
  },

  list: async (companyId?: string): Promise<TeamInviteRow[]> => {
    const res = await apiClient.get<TeamInviteRow[]>('/auth/team-invites', {
      params: companyId ? { companyId } : {},
    });
    return res.data;
  },

  revoke: async (inviteId: string, companyId?: string): Promise<{ success: boolean }> => {
    const res = await apiClient.delete<{ success: boolean }>(`/auth/team-invites/${inviteId}`, {
      params: companyId ? { companyId } : {},
    });
    return res.data;
  },
};
