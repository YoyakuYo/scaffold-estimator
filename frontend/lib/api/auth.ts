import apiClient from './client';
import Cookies from 'js-cookie';

export interface LoginCredentials {
  email: string;
  password: string;
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

export const authApi = {
  register: async (payload: RegisterPayload): Promise<RegisterResponse> => {
    const response = await apiClient.post<RegisterResponse>('/auth/register', payload);
    return response.data;
  },

  login: async (credentials: LoginCredentials): Promise<AuthResponse> => {
    const response = await apiClient.post<AuthResponse>('/auth/login', credentials);
    // Store token in cookie with longer expiration
    Cookies.set('access_token', response.data.access_token, {
      expires: 7, // 7 days (longer than JWT expiration, but token will be refreshed)
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax', // Changed from 'strict' to allow cross-origin requests
      path: '/',
      // Add domain for better persistence (optional, works for localhost)
      ...(process.env.NODE_ENV === 'production' ? { domain: window.location.hostname } : {}),
    });
    return response.data;
  },

  logout: () => {
    Cookies.remove('access_token', { path: '/' });
    window.location.href = '/';
  },

  getToken: (): string | undefined => {
    return Cookies.get('access_token');
  },

  heartbeat: async (): Promise<{ ok: boolean }> => {
    const response = await apiClient.post<{ ok: boolean }>('/auth/heartbeat', {});
    return response.data;
  },
};
