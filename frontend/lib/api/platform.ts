import apiClient from './client';

export interface PlatformPublicStatus {
  maintenanceMode: boolean;
  maintenanceMessage: string | null;
  signupDisabled: boolean;
}

export interface PlatformSettings extends PlatformPublicStatus {
  featureDisableSignup: boolean;
  featureDisableAiExtraction: boolean;
  featureDisableFileUploads: boolean;
  maintenanceMode: boolean;
  maintenanceMessage: string | null;
  updatedAt: string | null;
  updatedByUserId: string | null;
}

export interface PlatformAnalyticsSummary {
  /** Rows / paths aggregated over this trailing window (7, 14, or 28). */
  telemetryWindowDays: number;
  pageViews24h: number;
  pageViews7d: number;
  logins24h: number;
  logins7d: number;
  visitsByDay: { day: string; count: number }[];
  pageViewsTopPaths: { path: string; count: number }[];
  uploadEventsByKind: { kind: string; count: number }[];
  uploadEventsByProduct: { productCode: string; count: number }[];
  uploadsPeriodTotal: number;
  tenantApprovedUsers: number;
  tenantPendingUsers: number;
  tenantCompaniesWithMembers: number;
}

export type TelemetryWindowDays = 7 | 14 | 28;

export const platformApi = {
  getPublicStatus: async (): Promise<PlatformPublicStatus> => {
    const res = await apiClient.get<PlatformPublicStatus>('/platform/public-status');
    return res.data;
  },

  trackPageView: async (payload: { path: string; referrer?: string; anonKey?: string }): Promise<void> => {
    await apiClient.post('/platform/analytics/track', {
      eventType: 'page_view',
      ...payload,
    });
  },

  /** Superadmin */
  getSettings: async (): Promise<PlatformSettings> => {
    const res = await apiClient.get<PlatformSettings>('/platform/settings');
    return res.data;
  },

  updateSettings: async (patch: Partial<PlatformSettings>): Promise<PlatformSettings> => {
    const res = await apiClient.put<PlatformSettings>('/platform/settings', patch);
    return res.data;
  },

  getAnalyticsSummary: async (params?: { telemetryDays?: TelemetryWindowDays }): Promise<PlatformAnalyticsSummary> => {
    const res = await apiClient.get<PlatformAnalyticsSummary>('/platform/analytics/summary', {
      params:
        params?.telemetryDays !== undefined ? { telemetryDays: params.telemetryDays } : undefined,
    });
    return res.data;
  },

  listRecentLogins: async (): Promise<Array<Record<string, unknown> & { userEmail?: string | null; companyName?: string | null }>> => {
    const res = await apiClient.get('/platform/analytics/logins?limit=100');
    return res.data;
  },

  listAudit: async (): Promise<Array<Record<string, unknown>>> => {
    const res = await apiClient.get('/platform/audit?limit=100');
    return res.data;
  },

  broadcast: async (body: {
    title: string;
    body?: string;
    link?: string;
    audience?: 'subscribed' | 'all_approved';
    sendEmail?: boolean;
  }) => {
    const res = await apiClient.post<{ notified: number; emailsAttempted: number }>('/platform/broadcast', body);
    return res.data;
  },
};
