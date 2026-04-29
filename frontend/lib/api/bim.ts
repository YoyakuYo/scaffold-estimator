import apiClient from './client';

export type BimFileKind = 'ifc' | 'dxf' | 'pdf' | 'dwg';

export interface BimViewerModel {
  id: string;
  companyId: string | null;
  createdBy: string | null;
  filename: string;
  displayName: string | null;
  mimeType: string | null;
  sizeBytes: number | string | null;
  storagePath: string | null;
  fileKind: BimFileKind;
  conversionStatus: string;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export const bimApi = {
  /**
   * Record a BIM viewer session (local parse) for the superadmin upload feed.
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

  listModels: async (): Promise<BimViewerModel[]> => {
    const res = await apiClient.get<BimViewerModel[]>('/bim/models');
    return res.data;
  },

  uploadModel: async (file: File): Promise<BimViewerModel> => {
    const fd = new FormData();
    fd.append('file', file);
    const res = await apiClient.post<BimViewerModel>('/bim/models', fd);
    return res.data;
  },

  getModel: async (id: string): Promise<BimViewerModel> => {
    const res = await apiClient.get<BimViewerModel>(`/bim/models/${id}`);
    return res.data;
  },

  getModelDownloadUrl: async (
    id: string,
  ): Promise<{ url: string; expiresInSeconds: number; filename: string }> => {
    const res = await apiClient.get<{ url: string; expiresInSeconds: number; filename: string }>(
      `/bim/models/${id}/download-url`,
    );
    return res.data;
  },

  patchModel: async (id: string, payload: { displayName?: string | null }): Promise<BimViewerModel> => {
    const res = await apiClient.patch<BimViewerModel>(`/bim/models/${id}`, payload);
    return res.data;
  },

  deleteModel: async (id: string): Promise<{ ok: true }> => {
    const res = await apiClient.delete<{ ok: true }>(`/bim/models/${id}`);
    return res.data;
  },
};
