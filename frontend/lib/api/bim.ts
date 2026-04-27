import apiClient from './client';

export const bimApi = {
  /**
   * Phase 5 — record a BIM viewer upload event so it shows in the unified
   * superadmin upload feed. Parsing happens client-side via web-ifc.
   */
  trackUpload: async (payload: {
    filename: string;
    mimeType?: string;
    sizeBytes?: number;
    metadata?: Record<string, unknown>;
  }): Promise<{ ok: boolean }> => {
    const res = await apiClient.post<{ ok: boolean }>('/bim/track-upload', payload);
    return res.data;
  },
};
