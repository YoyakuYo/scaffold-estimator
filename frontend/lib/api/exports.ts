import apiClient from './client';

export const exportsApi = {
  generate: async (
    estimateId: string,
    format: 'pdf' | 'excel'
  ): Promise<Blob> => {
    const response = await apiClient.get(`/exports/estimates/${estimateId}`, {
      params: { format },
      responseType: 'blob',
    });
    return response.data;
  },

  download: async (exportId: string): Promise<Blob> => {
    const response = await apiClient.get(`/exports/${exportId}`, {
      responseType: 'blob',
    });
    return response.data;
  },
};
