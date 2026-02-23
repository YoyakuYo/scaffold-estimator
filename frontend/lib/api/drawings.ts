import apiClient from './client';

export interface Drawing {
  id: string;
  filename: string;
  fileFormat: 'pdf' | 'dxf' | 'dwg' | 'jww' | 'jpg' | 'jpeg' | 'png' | 'gif' | 'bmp' | 'webp' | 'svg' | 'tif' | 'tiff';
  uploadStatus: 'pending' | 'processing' | 'completed' | 'failed';
  detectedStructureType?: '改修工事' | 'S造' | 'RC造';
  uploadedAt: string;
  normalizedGeometry?: any;
}

export type DrawingType = 'floor_plan' | 'section' | 'elevation' | 'unknown';
export type DimensionUnit = 'mm' | 'cm' | 'm' | 'ft_in' | 'unknown';

export interface ExtractedWallDimension {
  lengthMm: number;
  heightMm: number;
}

export interface ExtractionWarning {
  level: 'info' | 'warning' | 'error';
  code: 'LOW_RESOLUTION' | 'VERY_LOW_RESOLUTION' | 'LOW_OCR_CONFIDENCE' | 'NO_DIMENSIONS_FOUND' | 'FEW_DIMENSIONS_FOUND';
  message: string;
  messageJa: string;
}

/** A point on the detected building outline (fractional coords 0-1) */
export interface OutlinePoint {
  xFrac: number;
  yFrac: number;
}

export interface ExtractedDimensions {
  drawingType: DrawingType;
  detectedUnit: DimensionUnit;
  walls: {
    north: ExtractedWallDimension | null;
    south: ExtractedWallDimension | null;
    east: ExtractedWallDimension | null;
    west: ExtractedWallDimension | null;
  };
  buildingHeightMm: number | null;
  /** Estimated number of above-ground floors (from OCR text) */
  estimatedFloorCount: number;
  /** Estimated building height in mm (floorCount × typical height) */
  estimatedBuildingHeightMm: number | null;
  rawDimensionTexts: string[];
  parsedDimensionsMm: number[];
  confidence: number;
  viewCount: number;
  /** Image resolution info */
  imageResolution?: { width: number; height: number } | null;
  /** Quality warnings from extraction */
  warnings?: ExtractionWarning[];
  /** Auto-detected building outline polygon */
  buildingOutline?: OutlinePoint[] | null;
}

// ── CAD Processing Data ────────────────────────────────────

export interface CadWallSegment {
  id: number;
  start: { x: number; y: number };
  end: { x: number; y: number };
  /** Length in mm */
  length: number;
  /** Direction angle in degrees */
  angle: number;
}

export interface CadGeometrySegment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface CadExtractionData {
  perimeterTotal: number;
  wallSegments: CadWallSegment[];
  buildingHeight: number | null;
  heightNote: string;
  unit: string;
  /** All cleaned DXF line segments for rendering as background reference */
  allGeometry?: CadGeometrySegment[];
}

export interface CadExtractionInfo {
  rawSegmentCount: number;
  cleanedSegmentCount: number;
  graphNodes: number;
  graphEdges: number;
  loopsFound: number;
  outerBoundaryPoints: number;
  wallSegmentCount: number;
  unit: string;
  cleaningStats: {
    tooShort: number;
    duplicates: number;
    disconnected: number;
    merged: number;
  };
}

export interface UploadDrawingResponse {
  id: string;
  message: string;
  status: string;
  /** Present for image uploads */
  extractedDimensions?: ExtractedDimensions | null;
  /** Present for CAD uploads (DXF/DWG/JWW) */
  cadData?: CadExtractionData | null;
  /** CAD processing details */
  extractionInfo?: CadExtractionInfo | null;
}

export const drawingsApi = {
  upload: async (
    file: File,
    projectId: string
  ): Promise<UploadDrawingResponse> => {
    const formData = new FormData();
    formData.append('file', file);

    // Don't set Content-Type header - let browser set it with boundary
    // Use longer timeout for uploads — OCR/CAD processing can take time
    const response = await apiClient.post<UploadDrawingResponse>(
      `/drawings/upload?projectId=${encodeURIComponent(projectId)}`,
      formData,
      { timeout: 300000 } // 5 minutes for large files + processing
    );
    return response.data;
  },

  /** Get the URL for the uploaded drawing file (served by backend) */
  getFileUrl: (drawingId: string): string => {
    const baseUrl =
      process.env.NEXT_PUBLIC_BACKEND_URL ||
      process.env.NEXT_PUBLIC_API_URL ||
      'http://localhost:3000/api/v1';
    return `${baseUrl}/drawings/${drawingId}/file`;
  },

  list: async (projectId?: string): Promise<Drawing[]> => {
    const params = projectId ? { projectId } : {};
    const response = await apiClient.get<Drawing[]>('/drawings', { params });
    return response.data;
  },

  get: async (id: string): Promise<Drawing> => {
    const response = await apiClient.get<Drawing>(`/drawings/${id}`);
    return response.data;
  },
};
