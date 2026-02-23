/**
 * Kusabi Ashiba (くさび式足場) Scaffolding Constants
 *
 * All measurements in meters unless otherwise noted.
 * Single source of truth for scaffold geometry rules.
 */

// ─── Span & Level ────────────────────────────────────────────

/** Standard span distance between tateji (m) */
export const SPAN_LENGTH_M = 1.8;

/** Standard level height (m) — fixed at 1800 mm */
export const LEVEL_HEIGHT_M = 1.8;

// ─── Post (支柱) Catalog — MA series, φ48.6mm ───────────────
// Kept here for future material breakdown by size

export const POST_CATALOG = [
  { code: 'MA-2',  lengthMm: 225,  weightKg: undefined },
  { code: 'MA-4',  lengthMm: 450,  weightKg: 2.1 },
  { code: 'MA-6',  lengthMm: 600,  weightKg: undefined },
  { code: 'MA-9',  lengthMm: 900,  weightKg: 3.8 },
  { code: 'MA-13', lengthMm: 1350, weightKg: undefined },
  { code: 'MA-18', lengthMm: 1800, weightKg: 6.9 },
  { code: 'MA-27', lengthMm: 2700, weightKg: 10.0 },
  { code: 'MA-36', lengthMm: 3600, weightKg: 13.2 },
] as const;

// ─── Scaffold Width Options (mm) ────────────────────────────

export const SCAFFOLD_WIDTH_OPTIONS_MM = [600, 900, 1200] as const;

// ─── Future expansion constants (placeholders) ──────────────

// export const DIAGONAL_BRACE_ANGLE_DEG = 45;
// export const GUARD_RAIL_HEIGHT_M = 0.9;
// export const TOE_BOARD_HEIGHT_MM = 150;
