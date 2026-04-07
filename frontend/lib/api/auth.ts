import apiClient from './client';
import Cookies from 'js-cookie';
import { accessTokenCookieWriteAttributes, clearAccessTokenCookie } from './access-token-cookie';
import { clearScaffoldWizardDraft } from '@/lib/scaffold-wizard-draft-storage';
import { clearDrawingUploadSession } from '@/lib/drawing-upload-persist';

export interface LoginCredentials {
  email: string;
  password: string;
  /** Set true only when logging in via /superadmin. Backend rejects cross-use. */
  superadmin?: boolean;
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

export interface RegisterPayload {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  companyName: string;
  companyAddress?: string;
  companyPhone?: string;
  companyEmail?: string;
  companyPostalCode?: string;
  companyPrefecture?: string;
  companyCity?: string;
  companyTown?: string;
  companyAddressLine?: string;
  companyBuilding?: string;
}

export interface RegisterResponse {
  success: boolean;
  message: string;
  userId: string;
}

export interface ForgotPasswordResponse {
  ok: true;
  message: string;
}

export const authApi = {
  register: async (payload: RegisterPayload): Promise<RegisterResponse> => {
    const response = await apiClient.post<RegisterResponse>('/auth/register', payload);
    return response.data;
  },

  login: async (credentials: LoginCredentials): Promise<AuthResponse> => {
    const response = await apiClient.post<AuthResponse>('/auth/login', credentials);
    Cookies.set('access_token', response.data.access_token, accessTokenCookieWriteAttributes());
    return response.data;
  },

  logout: () => {
    if (typeof window !== 'undefined') {
      clearScaffoldWizardDraft();
      void clearDrawingUploadSession();
    }
    clearAccessTokenCookie();
    window.location.href = '/';
  },

  getToken: (): string | undefined => {
    return Cookies.get('access_token');
  },

  heartbeat: async (): Promise<{ ok: boolean }> => {
    const response = await apiClient.post<{ ok: boolean }>('/auth/heartbeat', {});
    return response.data;
  },

  forgotPassword: async (email: string): Promise<ForgotPasswordResponse> => {
    const response = await apiClient.post<ForgotPasswordResponse>('/auth/forgot-password', { email });
    return response.data;
  },

  resetPasswordWithToken: async (payload: {
    token: string;
    newPassword: string;
  }): Promise<{ success: boolean }> => {
    const response = await apiClient.post<{ success: boolean }>('/auth/reset-password', payload);
    return response.data;
  },

  verifyBankActivation: async (code: string): Promise<{ ok: true; plan: string }> => {
    const response = await apiClient.post<{ ok: true; plan: string }>('/auth/verify-bank-activation', { code });
    return response.data;
  },
};
