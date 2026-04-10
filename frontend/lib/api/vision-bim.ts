import apiClient from './client';

export interface VisionMassingTier {
  vertices: Array<{ x: number; y: number } | { xFrac: number; yFrac: number }>;
  topHeightMm: number;
  baseHeightMm?: number;
}

/** Premium: enriched IFC / BIM metadata from web-ifc (storeys, grids, project). */
export interface IfcStoreyInfo {
  expressId: number;
  name: string | null;
  elevationMm: number | null;
}

export interface IfcGridAxisInfo {
  axisTag: string | null;
}

export interface IfcGridSummary {
  expressId: number;
  name: string | null;
  uAxes: IfcGridAxisInfo[];
  vAxes: IfcGridAxisInfo[];
  wAxes: IfcGridAxisInfo[];
}

export interface IfcSpatialSummary {
  projectName: string | null;
  buildingNames: string[];
}

export interface IfcPremiumMetadata {
  ifcSchema: string | null;
  projectName: string | null;
  spatialSummary?: IfcSpatialSummary;
  storeys: IfcStoreyInfo[];
  grids: IfcGridSummary[];
  propertySetNameSample: string[];
}

/** Premium companion schedule import result. */
export interface PremiumScheduleImportResult {
  version: number;
  wallLengthsMm: number[];
  edgeLabels?: string[];
  baysMmByEdge?: Record<string, number[]>;
  source: 'json' | 'csv' | 'txt';
  warnings: string[];
}

/** AI suggestion for stepped / setback massing wizard (raster image upload). */
export interface SteppedMassingAiResult {
  depthMm: number;
  taperAxis: 'x' | 'y' | 'both';
  tierLengthsMm: number[];
  tierHeightsMm: number[];
  buildingHeightMm: number;
  confidence?: number;
  /** When taperAxis is "both": per-tier depth (mm), same length as tierLengthsMm. */
  tierDepthsMm?: number[];
  footprintComplexity?:
    | 'simple_rectangle'
    | 'l_shape'
    | 'u_shape'
    | 'multi_volume'
    | 'facade_bays'
    | 'unknown';
  analysisWarnings?: string[];
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
  ifcPremiumMetadata?: IfcPremiumMetadata;
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
   * AI Extraction: Upload image (PNG/JPEG/WebP/GIF/BMP), PDF, DXF, or IFC.
   * Analyzes the file and extracts footprint, dimensions, and building height.
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
   * Dimension Extraction: Upload image (PNG/JPEG/WebP), PDF, DXF, or IFC.
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

  /**
   * Premium: companion wall schedule — JSON v1, CSV (edge,length), or span-configuration .txt
   */
  importPremiumSchedule: async (file: File): Promise<PremiumScheduleImportResult> => {
    const form = new FormData();
    form.append('file', file);
    const response = await apiClient.post<PremiumScheduleImportResult>(
      '/vision-bim/import-premium-schedule',
      form,
      { timeout: 60000 },
    );
    return response.data;
  },

  /**
   * Stepped massing: upload elevation / 3D render (PNG, JPEG, WebP, GIF, BMP).
   * Returns suggested depth, taper axis, and per-tier lengths/heights for the wizard.
   */
  analyzeSteppedMassing: async (file: File): Promise<SteppedMassingAiResult> => {
    const form = new FormData();
    form.append('file', file);
    const response = await apiClient.post<SteppedMassingAiResult>(
      '/vision-bim/analyze-stepped-massing',
      form,
      { timeout: 120000 },
    );
    return response.data;
  },
};
