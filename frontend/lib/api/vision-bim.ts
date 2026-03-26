import apiClient from './client';

export interface VisionMassingTier {
  vertices: Array<{ x: number; y: number } | { xFrac: number; yFrac: number }>;
  topHeightMm: number;
  baseHeightMm?: number;
}

export interface VisionFootprintResult {
  vertices: Array<{ x: number; y: number } | { xFrac: number; yFrac: number }>;
  buildingHeightMm: number;
  groundLineY?: number;
  eavesLineY?: number;
  confidence?: number;
  scaleDenominator?: number;
  wallLengthsMm?: number[];
  scaffoldTypeHint?: 'kusabi' | 'wakugumi';
  spanSizeMm?: number;
  frameSizeMm?: number;
  wallLengthsFromDimText?: boolean;
  floorCount?: number;
  wallHeightsMm?: number[];
  massingTiers?: VisionMassingTier[];
  heightConfidence?: 'high' | 'medium' | 'low';
  drawingType?: 'plan' | '3d' | 'elevation' | 'section';
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
    | {
        type: 'door';
        wallIndex?: number;
        positionMm?: number;
        widthMm?: number;
      }
  >;
}

export const visionBimApi = {
  /**
   * AI Extraction: Upload image (PNG/JPEG/WebP/GIF/BMP), PDF, or DXF.
   * AI analyzes the drawing and extracts footprint, dimensions, and building height.
   */
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

  /**
   * Dimension Extraction: Upload image (PNG/JPEG/WebP), PDF, or DXF.
   * Extracts dimensions and shape from clearly dimensioned drawings.
   * For DXF: deterministic parse. For images/PDFs: AI-assisted dimension reading.
   */
  extractDimensions: async (file: File): Promise<VisionFootprintResult> => {
    const form = new FormData();
    form.append('file', file);
    const response = await apiClient.post<VisionFootprintResult>(
      '/vision-bim/extract-dimensions',
      form,
      { timeout: 120000 },
    );
    return response.data;
  },
};
