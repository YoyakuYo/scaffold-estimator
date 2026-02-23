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
}

export interface CreateScaffoldConfigDto {
  projectId: string;
  drawingId?: string;
  mode: 'auto' | 'manual';
  scaffoldType?: 'kusabi' | 'wakugumi';
  structureType?: '改修工事' | 'S造' | 'RC造';
  walls: WallInput[];
  scaffoldWidthMm: number;
  // Kusabi-specific
  preferredMainTatejiMm?: number;
  topGuardHeightMm?: number;
  // Wakugumi-specific
  frameSizeMm?: number;
  habakiCountPerSpan?: number;
  endStopperType?: 'nuno' | 'frame';
  // Common optional
  rentalType?: 'weekly' | 'monthly' | 'custom';
  rentalStartDate?: string;
  rentalEndDate?: string;
  /** Optional: Building outline polygon (for complex shapes) */
  buildingOutline?: Array<{ xFrac: number; yFrac: number }>;
  /** Optional: Extracted dimensions (for scaling polygon edges) */
  extractedDimensions?: {
    walls: {
      north: { lengthMm: number } | null;
      south: { lengthMm: number } | null;
      east: { lengthMm: number } | null;
      west: { lengthMm: number } | null;
    };
  };
}

export interface ScaffoldConfiguration {
  id: string;
  projectId: string;
  drawingId?: string;
  mode: 'auto' | 'manual';
  scaffoldType: 'kusabi' | 'wakugumi';
  structureType?: '改修工事' | 'S造' | 'RC造';
  buildingHeightMm: number;
  walls: Array<{
    side: string;
    wallLengthMm: number;
    wallHeightMm?: number;
    enabled: boolean;
    stairAccessCount: number;
    segments?: WallSegment[];
  }>;
  scaffoldWidthMm: number;
  preferredMainTatejiMm: number;
  topGuardHeightMm: number;
  frameSizeMm?: number;
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
  spans: number[];
  totalSpans: number;
  postPositions: number;
  stairAccessCount: number;
  kaidanSpanIndices?: number[]; // Array of start span indices for kaidan (0-based, each covers 2 spans)
  needsExtendedBay?: boolean; // Whether extended bay pattern is used (width <= 600mm)
  /** Multi-segment wall shape (passed through from input) */
  segments?: WallSegment[];
  components: CalculatedComponent[];
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
  topGuardOptions: SizeOption[];
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

  /** Download Excel quotation */
  exportExcel: async (configId: string): Promise<Blob> => {
    const response = await apiClient.get(`/scaffold-configs/${configId}/export/excel`, {
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
