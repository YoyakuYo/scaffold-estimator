/**
 * Rule-based steel member extraction from 2D structural drawings (Japanese + English).
 * Consumes pre-extracted geometry and text; DXF wiring lives in dxfAdapter.ts.
 */

export type Vec2 = [number, number];

export interface SteelGeometryLine {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  /** Optional CAD layer name */
  layer?: string;
}

export interface SteelTextEntity {
  content: string;
  x: number;
  y: number;
  layer?: string;
}

export interface SteelExtractionThresholds {
  /** Degrees from horizontal to treat as beam (±). */
  beamAngleDeg: number;
  /** Degrees from vertical to treat as column (±). */
  columnAngleDeg: number;
  /** Min absolute deviation from H/V to treat as brace (deg). */
  braceMinDeviationDeg: number;
  /** Max distance (drawing units) to associate text to a member. */
  textSnapDistance: number;
  /** Min segment length to consider (filters noise). */
  minSegmentLength: number;
  /** Grid axis merge tolerance (drawing units). */
  gridAxisTolerance: number;
  /** When true, single-letter grid labels use X position; numbers use Y. */
  letterAxisIsX: boolean;
}

export const DEFAULT_STEEL_THRESHOLDS: SteelExtractionThresholds = {
  beamAngleDeg: 12,
  columnAngleDeg: 12,
  braceMinDeviationDeg: 15,
  textSnapDistance: 2500,
  minSegmentLength: 50,
  gridAxisTolerance: 400,
  letterAxisIsX: true,
};

export interface ParsedSectionSize {
  shape: string;
  /** Primary depth / height (mm when input uses mm). */
  height?: number;
  width?: number;
  webThickness?: number;
  flangeThickness?: number;
  /** Raw normalized token, e.g. H-300x150x6x9 */
  raw: string;
}

export interface SteelBeamRecord {
  type: 'beam';
  start: Vec2;
  end: Vec2;
  section: string | null;
  label: string | null;
  layer?: string;
  length: number;
  angleDeg: number;
}

export interface SteelColumnRecord {
  type: 'column';
  position: Vec2;
  section: string | null;
  label: string | null;
  layer?: string;
}

export interface SteelBraceRecord {
  type: 'brace';
  start: Vec2;
  end: Vec2;
  section: string | null;
  label: string | null;
  layer?: string;
  length: number;
  angleDeg: number;
}

export interface SteelFloorBlock {
  beams: SteelBeamRecord[];
  columns: SteelColumnRecord[];
  braces: SteelBraceRecord[];
}

export interface SteelFloorResult {
  blocks: Record<string, SteelFloorBlock>;
}

export interface GridCell {
  id: string;
  x: number;
  y: number;
}

export interface SteelExtractionResult {
  /** Keys like `2F`, `RF`, `B1F`, or `unknown` when not inferred. */
  floors: Record<string, SteelFloorResult>;
  meta: {
    gridCells: GridCell[];
    warnings: string[];
    thresholds: SteelExtractionThresholds;
  };
}

export interface SteelExtractionInput {
  lines: SteelGeometryLine[];
  texts: SteelTextEntity[];
  /** Optional hint, e.g. from DXF layer "S-2F-大梁". */
  defaultFloor?: string | null;
  thresholds?: Partial<SteelExtractionThresholds>;
}
