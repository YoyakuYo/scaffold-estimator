import apiClient from './client';

// ─── Types ──────────────────────────────────────────────────────

/** A single straight segment of a wall face. */
export interface WallSegment {
  /** Length of this segment along the wall face (mm) */
  lengthMm: number;
  /** Perpendicular offset from the base wall line (mm).
   *  Positive = outward (towards scaffold), negative = inward (setback). */
  offsetMm: number;
}

export interface BuildingMassingTier {
  vertices: Array<{ x: number; y: number } | { xFrac: number; yFrac: number }>;
  topHeightMm: number;
  baseHeightMm?: number;
}

export interface WallInput {
  side: string; // 'north' | 'south' | 'east' | 'west' or dynamic edge names like 'edge-0', 'edge-1'
  wallLengthMm: number;
  wallHeightMm: number;
  stairAccessCount: number; // Keep for backward compatibility
  kaidanCount?: number; // Number of kaidan accesses
  kaidanOffsets?: number[]; // Array of positions in mm from left end, one per kaidan
  /** Multi-segment wall definition (stepped/L-shaped walls).
   *  If provided, wallLengthMm = sum of segments + return wall transitions. */
  segments?: WallSegment[];
  /** Per-wall scaffold width (600/900/1200). Overrides global scaffoldWidthMm. */
  scaffoldWidthMm?: number;
  /** Tier base elevation (mm). Scaffold starts at this height instead of ground level.
   *  Used for stepped/setback buildings where upper tiers have smaller footprints. */
  baseHeightMm?: number;
  /** Logical side group for BOM aggregation (e.g. 'east' groups east-T1, east-T2, east-T3). */
  tierGroup?: string;
  /** Tier index (0-based) within the tierGroup. */
  tierIndex?: number;
}

export interface CreateScaffoldConfigDto {
  projectId: string;
  drawingId?: string;
  mode: 'auto' | 'manual';
  scaffoldType?: 'kusabi' | 'wakugumi';
  structureType?: '改修工事' | 'S造' | 'RC造';
  walls: WallInput[];
  scaffoldWidthMm: number;
  /** Distance from building wall to nearest posts (mm). 250–500 so scaffold can breathe. */
  wallStandoffMm?: number;
  /** Per-side scaffold width. e.g. { north: 900, south: 600 }. Overrides scaffoldWidthMm for matching sides. */
  widthBySide?: Record<string, number>;
  // Kusabi-specific
  preferredMainTatejiMm?: number;
  topGuardHeightMm?: number;
  // Wakugumi-specific
  frameSizeMm?: number;
  /** FT-617 / FT-917 / FT-1217 walk-through frame line (sets layout width) */
  wakugumiFrameSeries?: 'FT617' | 'FT917' | 'FT1217';
  habakiCountPerSpan?: number;
  endStopperType?: 'nuno' | 'frame';
  // Common optional
  rentalType?: 'weekly' | 'monthly' | 'custom';
  rentalStartDate?: string;
  rentalEndDate?: string;
  /** Optional: Number of corners that need pattanko (non-L-shaped). When omitted, PATTANKO is not counted. */
  pattankoCornerCount?: number;
  /** Optional: Building outline polygon (for complex shapes) */
  buildingOutline?: Array<{ xFrac: number; yFrac: number }>;
  /** Optional: stacked building volumes for stepped/setback massing preview. */
  massingTiers?: BuildingMassingTier[];
  /** Optional: Detected balconies / AC areas / pillars from vision (for Buragetto / clearance) */
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
  /** Optional: URL to stored IFC file for frontend 3D rendering */
  ifcFileUrl?: string;
  /** Optional: per-upload façade colors (raster image sampling for AI BIM 3D building) */
  bimFacadeColors?: {
    lowerHex: string;
    upperHex: string;
    roofHex: string;
    windowHex?: string;
    sillHex?: string;
  };
  /** Optional: Extracted dimensions (for scaling polygon edges) */
  extractedDimensions?: {
    walls: {
      north: { lengthMm: number } | null;
      south: { lengthMm: number } | null;
      east: { lengthMm: number } | null;
      west: { lengthMm: number } | null;
    };
  };
  /** Optional: X/Y hashira labels per wall edge (saved with first calculate). */
  edgeHashiraLabeling?: EdgeHashiraLabeling;
  /** Job site / quotation header (empty strings clear stored values on update) */
  siteName?: string;
  siteAddress?: string;
  siteEmail?: string;
  sitePhone?: string;
  siteFax?: string;
  /** Persisted on calculationResult.uiInputPath — restores scaffold page tab after Recalculate. */
  inputUiPath?: 'quick' | 'drawing' | 'ai_extract' | 'cad_draw';
}

export interface ScaffoldConfiguration {
  id: string;
  projectId: string;
  drawingId?: string;
  mode: 'auto' | 'manual';
  scaffoldType: 'kusabi' | 'wakugumi';
  structureType?: '改修工事' | 'S造' | 'RC造';
  buildingHeightMm: number;
  siteName?: string | null;
  siteAddress?: string | null;
  siteEmail?: string | null;
  sitePhone?: string | null;
  siteFax?: string | null;
  walls: Array<{
    side: string;
    wallLengthMm: number;
    wallHeightMm?: number;
    enabled: boolean;
    stairAccessCount: number;
    segments?: WallSegment[];
    scaffoldWidthMm?: number;
    baseHeightMm?: number;
    tierGroup?: string;
    tierIndex?: number;
  }>;
  scaffoldWidthMm: number;
  /** Distance from building wall to nearest posts (mm). 250–500. */
  wallStandoffMm?: number;
  preferredMainTatejiMm: number;
  topGuardHeightMm: number;
  frameSizeMm?: number;
  wakugumiFrameSeries?: 'FT617' | 'FT917' | 'FT1217';
  habakiCountPerSpan?: number;
  endStopperType?: 'nuno' | 'frame';
  calculationResult: any;
  status: 'configured' | 'calculated' | 'reviewed';
  createdAt: string;
}

export interface CalculatedComponent {
  type: string;
  category: string;       // JP classification (基礎部材, 支柱, 水平材, etc.)
  categoryEn: string;     // EN classification
  name: string;
  nameJp: string;
  sizeSpec: string;
  unit: string;
  quantity: number;
  sortOrder: number;
  materialCode?: string;
}

export interface WallCalculationResult {
  side: string;
  sideJp: string;
  wallLengthMm: number;
  wallHeightMm?: number;
  spans: number[];
  totalSpans: number;
  postPositions: number;
  stairAccessCount: number;
  kaidanSpanIndices?: number[]; // Array of start span indices for kaidan (0-based, each covers 2 spans)
  needsExtendedBay?: boolean; // Whether extended bay pattern is used (width <= 600mm)
  /** Multi-segment wall shape (passed through from input) */
  segments?: WallSegment[];
  components: CalculatedComponent[];
  /** Façade length used for span layout after −300mm per reflex corner (inner); omit if both ends convex. */
  scaffoldFacadeBasisMm?: number;
  /** Per-wall scaffold width used (from parametric or global). */
  scaffoldWidthMm?: number;
  /** Buragetto layout: bracket = single-pole when obstacle too close. */
  layoutMode?: 'double_post' | 'bracket';
  /** Door openings with resolved span indices for hariwaku rendering. */
  doorOpenings?: Array<{
    positionMm: number;
    widthMm: number;
    startSpanIndex: number;
    spanCount: number;
    hariwakuSizeMm: number;
  }>;
  levelCalc: {
    fullLevels: number;
    jackBaseAdjustmentMm: number;
    topPlankHeightMm: number;
    topGuardHeightMm: number;
    totalScaffoldHeightMm: number;
    mainPostsPerLine: number;
    mainPostHeightMm: number;
    topGuardPostHeightMm: number;
  };
}

/** Plan-view 支柱番号: assign X or Y axis per building edge; labels X1..Xn / Y1..Yn along posts. */
export interface EdgeHashiraAxisAssignment {
  wallIndex: number;
  /** '' = no labels on this edge */
  axis: '' | 'X' | 'Y';
  /** Override number of labels (1–500). Omit = use one label per calculated post (span+1). */
  labelCount?: number;
}

export interface EdgeHashiraLabeling {
  assignments: EdgeHashiraAxisAssignment[];
}

export interface CalculationResult {
  config: ScaffoldConfiguration;
  result: {
    scaffoldType: 'kusabi' | 'wakugumi';
    walls: WallCalculationResult[];
    summary: CalculatedComponent[];
    buildingHeightMm: number;
    scaffoldWidthMm: number;
    preferredMainTatejiMm: number;
    topGuardHeightMm: number;
    frameSizeMm?: number;
    habakiCountPerSpan?: number;
    endStopperType?: 'nuno' | 'frame';
    totalLevels: number;
  };
  quantities: CalculatedQuantity[];
}

export interface CalculatedQuantity {
  id: string;
  configId: string;
  componentType: string;
  componentName: string;
  sizeSpec: string;
  unit: string;
  calculatedQuantity: number;
  adjustedQuantity: number | null;
  adjustmentReason: string | null;
  unitPrice: number;
  sortOrder: number;
}

// ─── Rules Types ─────────────────────────────────────────────

export interface SizeOption {
  value: number;
  label: string;
}

export interface DropdownOption<T = string> {
  value: T;
  label: string;
  labelJp: string;
}

export interface ScaffoldRules {
  wallSides: DropdownOption[];
  scaffoldWidths: SizeOption[];
  mainTatejiOptions: SizeOption[];
  /** Fixed kusabi top guard (mm); replaces selectable topGuardOptions. */
  kusabiTopGuardHeightMm?: number;
  topGuardOptions?: SizeOption[];
  spanSizes: number[];
  spanOptions: SizeOption[];
  nunoSizes: number[];
  anchiWidths: number[];
  anchiLengths: number[];
  braceSizes: number[];
  habakiSizes: number[];
  stairAccessOptions: SizeOption[];
  levelHeightMm: number;
  // Wakugumi rules
  wakugumi?: {
    frameSizeOptions: SizeOption[];
    frameSeriesOptions: Array<{
      value: 'FT617' | 'FT917' | 'FT1217';
      label: string;
      labelJp: string;
      catalogWidthMm: number;
      scaffoldWidthMm: number;
    }>;
    frameHeightMm: number;
    spanSizes: number[];
    spanOptions: SizeOption[];
    habakiCountOptions: SizeOption[];
    endStopperTypeOptions: Array<{ value: string; label: string }>;
  };
}

// ─── Material Price Master Types ──────────────────────────────

export interface ScaffoldMaterial {
  id: string;
  code: string;
  nameJp: string;
  nameEn: string;
  category: string;
  scaffoldType: string;
  sizeSpec: string;
  unit: string;
  standardLengthMm: number | null;
  standardWidthMm: number | null;
  weightKg: number | null;
  rentalPriceMonthly: number;
  purchasePrice: number | null;
  bundleQuantity: number | null;
  pipeDiameterMm: number | null;
  isCombined: boolean;
  isActive: boolean;
  sortOrder: number;
}

// ─── API ────────────────────────────────────────────────────────

export const scaffoldConfigsApi = {
  /** Fetch all rules/dropdown options from backend */
  getRules: async (): Promise<ScaffoldRules> => {
    const response = await apiClient.get<ScaffoldRules>('/scaffold-configs/rules');
    return response.data;
  },

  /** Create config + calculate in one step */
  createAndCalculate: async (dto: CreateScaffoldConfigDto): Promise<CalculationResult> => {
    const response = await apiClient.post<CalculationResult>('/scaffold-configs', dto, {
      timeout: 60000, // 60s — calculation can be slow for complex multi-segment walls
    });
    return response.data;
  },

  /** Update existing config + recalculate (same body as create). */
  updateAndRecalculate: async (
    id: string,
    dto: CreateScaffoldConfigDto,
  ): Promise<CalculationResult> => {
    const response = await apiClient.patch<CalculationResult>(`/scaffold-configs/${id}`, dto, {
      timeout: 60000,
    });
    return response.data;
  },

  /** List configurations */
  list: async (projectId?: string): Promise<ScaffoldConfiguration[]> => {
    const params = projectId ? { projectId } : {};
    const response = await apiClient.get<ScaffoldConfiguration[]>('/scaffold-configs', { params });
    return response.data;
  },

  /** Get single configuration */
  get: async (id: string): Promise<ScaffoldConfiguration> => {
    const response = await apiClient.get<ScaffoldConfiguration>(`/scaffold-configs/${id}`);
    return response.data;
  },

  /** Merge X/Y 支柱番号 settings into stored calculation_result (no full recalc). */
  patchEdgeHashiraLabeling: async (
    id: string,
    edgeHashiraLabeling: EdgeHashiraLabeling,
  ): Promise<ScaffoldConfiguration> => {
    const response = await apiClient.patch<ScaffoldConfiguration>(
      `/scaffold-configs/${id}/result-labels`,
      { edgeHashiraLabeling },
    );
    return response.data;
  },

  /** Get config by drawing ID */
  getByDrawing: async (drawingId: string): Promise<ScaffoldConfiguration | null> => {
    const response = await apiClient.get<ScaffoldConfiguration | null>(`/scaffold-configs/by-drawing/${drawingId}`);
    return response.data;
  },

  /** Get quantities for a config */
  getQuantities: async (configId: string): Promise<CalculatedQuantity[]> => {
    const response = await apiClient.get<CalculatedQuantity[]>(`/scaffold-configs/${configId}/quantities`);
    return response.data;
  },

  /** Update a quantity row */
  updateQuantity: async (
    quantityId: string,
    adjustedQuantity: number,
    adjustmentReason?: string,
  ): Promise<CalculatedQuantity> => {
    const response = await apiClient.patch<CalculatedQuantity>(
      `/scaffold-configs/quantities/${quantityId}`,
      { adjustedQuantity, adjustmentReason },
    );
    return response.data;
  },

  /** Mark config as reviewed */
  markReviewed: async (configId: string): Promise<ScaffoldConfiguration> => {
    const response = await apiClient.post<ScaffoldConfiguration>(`/scaffold-configs/${configId}/review`);
    return response.data;
  },

  /** Download Excel quotation (`lang`: ja | en | fr — matches UI locale) */
  exportExcel: async (configId: string, lang?: string): Promise<Blob> => {
    const response = await apiClient.get(`/scaffold-configs/${configId}/export/excel`, {
      params: lang ? { lang } : undefined,
      responseType: 'blob',
      timeout: 60000, // 60s — export can be slow for large configs
    });
    return response.data;
  },

  /** Export 2D as PDF */
  export2DPdf: async (configId: string, svgContent: string): Promise<Blob> => {
    const response = await apiClient.post(
      `/scaffold-configs/${configId}/export/pdf/2d`,
      { svgContent },
      { responseType: 'blob', timeout: 60000 },
    );
    return response.data;
  },

  /** Export 3D as PDF */
  export3DPdf: async (configId: string, imageBase64: string): Promise<Blob> => {
    const response = await apiClient.post(
      `/scaffold-configs/${configId}/export/pdf/3d`,
      { imageBase64 },
      { responseType: 'blob', timeout: 60000 },
    );
    return response.data;
  },

  /** Export 2D as DXF (CAD) */
  export2DCad: async (configId: string, wallSide?: string): Promise<Blob> => {
    const params = wallSide ? { wall: wallSide } : {};
    const response = await apiClient.get(`/scaffold-configs/${configId}/export/cad/2d`, {
      params,
      responseType: 'blob',
      timeout: 60000,
    });
    return response.data;
  },

  /** Export 3D as OBJ (CAD) */
  export3DCad: async (configId: string, wallSide?: string): Promise<Blob> => {
    const params = wallSide ? { wall: wallSide } : {};
    const response = await apiClient.get(`/scaffold-configs/${configId}/export/cad/3d`, {
      params,
      responseType: 'blob',
      timeout: 60000,
    });
    return response.data;
  },

  /** Delete a configuration */
  delete: async (configId: string): Promise<void> => {
    await apiClient.delete(`/scaffold-configs/${configId}`);
  },

  // ─── Materials Price Master ──────────────────────────────────

  /** List all scaffold materials with prices */
  listMaterials: async (): Promise<ScaffoldMaterial[]> => {
    const response = await apiClient.get<ScaffoldMaterial[]>('/scaffold-configs/materials');
    return response.data;
  },

  /** Seed default materials if table is empty */
  seedMaterials: async (): Promise<{ created: number; existing: number }> => {
    const response = await apiClient.post<{ created: number; existing: number }>('/scaffold-configs/materials/seed');
    return response.data;
  },

  /** Update a single material's price */
  updateMaterialPrice: async (
    materialId: string,
    updates: { rentalPriceMonthly?: number; purchasePrice?: number; isActive?: boolean },
  ): Promise<ScaffoldMaterial> => {
    const response = await apiClient.patch<ScaffoldMaterial>(
      `/scaffold-configs/materials/${materialId}`,
      updates,
    );
    return response.data;
  },

  /** Bulk update material prices */
  bulkUpdatePrices: async (
    updates: Array<{ id: string; rentalPriceMonthly: number }>,
  ): Promise<ScaffoldMaterial[]> => {
    const response = await apiClient.patch<ScaffoldMaterial[]>(
      '/scaffold-configs/materials/bulk',
      { updates },
    );
    return response.data;
  },

  /** Upload price table (Excel) and get matched prices preview */
  uploadPriceTable: async (file: File): Promise<{
    success: boolean;
    totalRows: number;
    matched: number;
    unmatched: number;
    matches: Array<{
      materialId: string;
      materialCode: string;
      materialName: string;
      sizeSpec: string;
      oldPrice: number;
      newPrice: number;
      confidence: 'exact' | 'high' | 'medium' | 'low';
      matchReason: string;
    }>;
  }> => {
    const formData = new FormData();
    formData.append('file', file);
    const response = await apiClient.post(
      '/scaffold-configs/materials/upload-price-table',
      formData,
      {
        headers: { 'Content-Type': 'multipart/form-data' },
        timeout: 60000, // 60 seconds for parsing
      },
    );
    return response.data;
  },

  /** Apply matched prices from uploaded price table */
  applyPriceTable: async (matches: Array<{ materialId: string; newPrice: number }>): Promise<{
    success: boolean;
    updated: number;
    message: string;
  }> => {
    const response = await apiClient.post('/scaffold-configs/materials/apply-price-table', {
      matches,
    });
    return response.data;
  },
};
