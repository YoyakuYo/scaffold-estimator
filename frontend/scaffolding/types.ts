/**
 * Kusabi Ashiba (くさび式足場) Scaffolding Calculation Types
 *
 * Pure type definitions — no logic, no UI.
 * Reusable across calculator, export (PDF/Excel), and 3D renderer.
 */

// ─── Input Types ─────────────────────────────────────────────

export interface SegmentInput {
  start: { x: number; y: number };
  end: { x: number; y: number };
  /** Wall segment length in meters */
  length: number;
}

export interface KusabiCalculationInput {
  /** Closed building outline segments (horizontal/vertical only) */
  segments: SegmentInput[];
  /** Total scaffold height in meters */
  height: number;
}

// ─── Per-Wall Breakdown ──────────────────────────────────────

export interface WallCalculation {
  /** Wall index (0-based) */
  wallIndex: number;
  /** Wall length in meters */
  wallLength: number;
  /** Number of spans for this wall */
  spanCount: number;
  /** Tateji (支柱) count: front + back, all levels */
  tateji: number;
  /** Yokoji (横地) count: base level only, front + back */
  yokoji: number;

  // ── Future expansion (placeholders) ──
  // diagonalBracing: number;
  // guardRails: number;
  // toeBoards: number;
}

// ─── Totals ──────────────────────────────────────────────────

export interface KusabiCalculationResult {
  /** Sum of all segment lengths (m) */
  totalPerimeter: number;
  /** Sum of spans across all walls */
  totalSpans: number;
  /** Number of scaffold levels = ceil(height / levelHeight) */
  levels: number;
  /** Total tateji (支柱) across all walls */
  tateji: number;
  /** Total yokoji (横地, base level only) across all walls */
  yokoji: number;
  /** Per-wall breakdown */
  walls: WallCalculation[];

  // ── Future expansion (placeholders) ──
  // diagonalBracing: number;
  // guardRails: number;
  // toeBoards: number;
}
