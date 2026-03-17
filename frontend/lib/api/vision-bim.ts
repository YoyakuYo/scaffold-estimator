import apiClient from './client';

export interface VisionFootprintResult {
  vertices: Array<{ x: number; y: number } | { xFrac: number; yFrac: number }>;
  buildingHeightMm: number;
  groundLineY?: number;
  eavesLineY?: number;
  confidence?: number;
  /** Scale from drawing (e.g. 100 for S=1/100). */
  scaleDenominator?: number;
  /** Per-edge lengths in mm (one per vertex/edge); from dimension text on plan. */
  wallLengthsMm?: number[];
  /** Inferred from plan: 枠組足場 (1829 etc.) vs くさび式 (600/900 etc.). */
  scaffoldTypeHint?: 'kusabi' | 'wakugumi';
  spanSizeMm?: number;
  /** For 枠組: 1700, 1800, or 1900. */
  frameSizeMm?: number;
  /** True when wallLengthsMm came from explicit dimension text on the plan. */
  wallLengthsFromDimText?: boolean;
  /** Detected balconies, AC areas, and pillars; affects clearance / Buragetto. */
  obstacles?: Array<
    | {
        type: 'balcony' | 'ac';
        vertices: Array<{ x: number; y: number } | { xFrac: number; yFrac: number }>;
      }
    | {
        type: 'pillar';
        center: { x: number; y: number } | { xFrac: number; yFrac: number };
        radiusMm: number;
      }
  >;
}

export const visionBimApi = {
  /** Upload image (photo or blueprint); returns footprint JSON for BuildingGraph. */
  analyze: async (file: File): Promise<VisionFootprintResult> => {
    const form = new FormData();
    form.append('file', file);
    const response = await apiClient.post<VisionFootprintResult>(
      '/vision-bim/analyze',
      form,
      { timeout: 120000 },
    );
    return response.data;
  },

  /** Upload IFC (BIM) file; returns footprint JSON extracted from 3D geometry. */
  fromIfc: async (file: File): Promise<VisionFootprintResult> => {
    const form = new FormData();
    form.append('file', file);
    const response = await apiClient.post<VisionFootprintResult>(
      '/vision-bim/from-ifc',
      form,
      { timeout: 120000 },
    );
    return response.data;
  },
};
