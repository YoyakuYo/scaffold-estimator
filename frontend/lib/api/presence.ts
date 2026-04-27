import apiClient from './client';

export interface PresenceUpdatePayload {
  pageKey?: string | null;
  label?: string | null;
}

export interface PresenceActionPayload {
  action: string;
  pageKey?: string | null;
  label?: string | null;
}

export interface LivePresenceRow {
  userId: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  role: string;
  companyId: string | null;
  companyName: string | null;
  pageKey: string | null;
  label: string | null;
  lastAction: string | null;
  lastActionAt: string | null;
  updatedAt: string;
  ipAddress: string | null;
}

export interface UploadEventRow {
  id: string;
  userId: string;
  userEmail: string | null;
  userFirstName: string | null;
  userLastName: string | null;
  companyId: string | null;
  companyName: string | null;
  productCode: string;
  kind: string;
  filename: string | null;
  mimeType: string | null;
  sizeBytes: number | null;
  refId: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

export const presenceApi = {
  update: async (payload: PresenceUpdatePayload): Promise<{ ok: boolean }> => {
    const res = await apiClient.post<{ ok: boolean }>('/presence/update', payload);
    return res.data;
  },

  recordAction: async (payload: PresenceActionPayload): Promise<{ ok: boolean }> => {
    const res = await apiClient.post<{ ok: boolean }>('/presence/action', payload);
    return res.data;
  },

  getLivePresence: async (): Promise<LivePresenceRow[]> => {
    const res = await apiClient.get<LivePresenceRow[]>('/admin/presence/live');
    return res.data;
  },

  getRecentUploads: async (params?: {
    limit?: number;
    sinceIso?: string;
    productCode?: string;
    companyId?: string;
  }): Promise<UploadEventRow[]> => {
    const res = await apiClient.get<UploadEventRow[]>('/admin/upload-events', {
      params: {
        limit: params?.limit,
        since: params?.sinceIso,
        productCode: params?.productCode,
        companyId: params?.companyId,
      },
    });
    return res.data;
  },
};
