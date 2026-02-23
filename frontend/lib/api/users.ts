import apiClient from './client';

// ─── Types ──────────────────────────────────────────────────

export type UserRole = 'admin' | 'estimator' | 'viewer';

export type ApprovalStatus = 'pending' | 'approved' | 'rejected';

export interface UserProfile {
  id: string;
  email: string;
  role: UserRole;
  companyId: string;
  firstName: string | null;
  lastName: string | null;
  isActive: boolean;
  approvalStatus: ApprovalStatus;
  createdAt: string;
  updatedAt: string;
}

export interface CreateUserPayload {
  email: string;
  password: string;
  role: UserRole;
  firstName?: string;
  lastName?: string;
}

export interface UpdateUserPayload {
  email?: string;
  role?: UserRole;
  firstName?: string;
  lastName?: string;
  isActive?: boolean;
}

export interface ChangePasswordPayload {
  currentPassword: string;
  newPassword: string;
}

// ─── API Client ─────────────────────────────────────────────

export const usersApi = {
  /** Get current user profile */
  getProfile: async (): Promise<UserProfile> => {
    const res = await apiClient.get<UserProfile>('/auth/profile');
    return res.data;
  },

  /** Update current user profile */
  updateProfile: async (data: { email?: string; firstName?: string; lastName?: string }): Promise<UserProfile> => {
    const res = await apiClient.put<UserProfile>('/auth/profile', data);
    return res.data;
  },

  /** Change current user password */
  changePassword: async (data: ChangePasswordPayload): Promise<{ success: boolean }> => {
    const res = await apiClient.post<{ success: boolean }>('/auth/change-password', data);
    return res.data;
  },

  /** List all users (admin only) */
  listUsers: async (): Promise<UserProfile[]> => {
    const res = await apiClient.get<UserProfile[]>('/auth/users');
    return res.data;
  },

  /** Get a single user (admin only) */
  getUser: async (id: string): Promise<UserProfile> => {
    const res = await apiClient.get<UserProfile>(`/auth/users/${id}`);
    return res.data;
  },

  /** Create a new user (admin only) */
  createUser: async (data: CreateUserPayload): Promise<UserProfile> => {
    const res = await apiClient.post<UserProfile>('/auth/users', data);
    return res.data;
  },

  /** Update a user (admin only) */
  updateUser: async (id: string, data: UpdateUserPayload): Promise<UserProfile> => {
    const res = await apiClient.put<UserProfile>(`/auth/users/${id}`, data);
    return res.data;
  },

  /** Reset a user's password (admin only) */
  resetPassword: async (id: string, newPassword: string): Promise<{ success: boolean }> => {
    const res = await apiClient.post<{ success: boolean }>(`/auth/users/${id}/reset-password`, { newPassword });
    return res.data;
  },

  /** Deactivate a user (admin only) */
  deactivateUser: async (id: string): Promise<{ success: boolean }> => {
    const res = await apiClient.delete<{ success: boolean }>(`/auth/users/${id}`);
    return res.data;
  },

  /** Approve a pending user (admin only) */
  approveUser: async (id: string): Promise<UserProfile> => {
    const res = await apiClient.post<UserProfile>(`/auth/users/${id}/approve`, {});
    return res.data;
  },

  /** Reject a pending user (admin only) */
  rejectUser: async (id: string): Promise<UserProfile> => {
    const res = await apiClient.post<UserProfile>(`/auth/users/${id}/reject`, {});
    return res.data;
  },

  /** Get pending users count (admin only) */
  getPendingCount: async (): Promise<{ count: number }> => {
    const res = await apiClient.get<{ count: number }>('/auth/users/pending/count');
    return res.data;
  },

  /** Get online users (admin only) */
  getOnlineUsers: async (): Promise<(UserProfile & { lastActiveAt?: string | null })[]> => {
    const res = await apiClient.get('/auth/users/online');
    return res.data;
  },

  /** Get login history for a user (admin only) */
  getLoginHistory: async (userId: string): Promise<{ id: string; userId: string; ipAddress: string | null; userAgent: string | null; createdAt: string }[]> => {
    const res = await apiClient.get(`/auth/users/${userId}/login-history`);
    return res.data;
  },

  /** Platform stats for super admin dashboard (admin only) */
  getPlatformStats: async (): Promise<{ totalUsers: number; pendingUsers: number; totalCompanies: number; onlineCount: number }> => {
    const res = await apiClient.get('/auth/admin/stats');
    return res.data;
  },
};
