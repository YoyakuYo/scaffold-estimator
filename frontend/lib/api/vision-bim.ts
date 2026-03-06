import apiClient from './client';

export interface VisionFootprintResult {
  vertices: Array<{ x: number; y: number } | { xFrac: number; yFrac: number }>;
  buildingHeightMm: number;
  groundLineY?: number;
  eavesLineY?: number;
  confidence?: number;
}

export const visionBimApi = {
  /** Upload image (photo or blueprint); returns footprint JSON for BuildingGraph. */
  analyze: async (file: File): Promise<VisionFootprintResult> => {
    const form = new FormData();
    form.append('file', file);
    const response = await apiClient.post<VisionFootprintResult>(
      '/vision-bim/analyze',
      form,
      { timeout: 60000 },
    );
    return response.data;
  },
};
