/**
 * Kusabi Ashiba (くさび式足場) Scaffolding Calculator
 *
 * Pure function — no UI, no side-effects.
 * Takes building outline segments + height and returns material quantities.
 *
 * ─── Business Rules ──────────────────────────────────────────
 * • Span spacing: 1.8 m (standard)
 * • Level height: 1.8 m (fixed)
 * • Each span requires FRONT and BACK tateji (2 rows)
 * • Yokoji is counted at BASE LEVEL ONLY
 * • numberOfLevels = ceil(height / 1.8)
 * ─────────────────────────────────────────────────────────────
 */

import {
  KusabiCalculationInput,
  KusabiCalculationResult,
  WallCalculation,
} from './types';
import { SPAN_LENGTH_M, LEVEL_HEIGHT_M } from './constants';

/**
 * Calculate kusabi scaffold material quantities for a closed building outline.
 *
 * @param input - segments (closed outline) + scaffold height (m)
 * @returns Full material quantities with per-wall breakdown
 * @throws Error if input is invalid
 */
export function calculateKusabi(
  input: KusabiCalculationInput,
): KusabiCalculationResult {
  // ── Validation ─────────────────────────────────────────────
  if (!input.segments || input.segments.length < 3) {
    throw new Error(
      'At least 3 segments are required for a closed building outline.',
    );
  }

  if (input.height <= 0) {
    throw new Error('Scaffold height must be greater than 0.');
  }

  // ── Levels ─────────────────────────────────────────────────
  const levels = Math.ceil(input.height / LEVEL_HEIGHT_M);

  // ── Per-wall calculation ───────────────────────────────────
  const walls: WallCalculation[] = input.segments.map((segment, index) => {
    const wallLength = segment.length;

    if (wallLength <= 0) {
      throw new Error(`Wall ${index} has invalid length: ${wallLength}`);
    }

    // Number of spans for this wall
    const spanCount = Math.ceil(wallLength / SPAN_LENGTH_M);

    // ── Tateji (支柱) ──────────────────────────────────────
    // Each span needs 2 tateji (front + back).
    // Repeated for every level.
    const tateji = spanCount * 2 * levels;

    // ── Yokoji (横地) ──────────────────────────────────────
    // Base level ONLY: each span has 1 yokoji front + 1 yokoji back.
    const yokoji = spanCount * 2;

    return {
      wallIndex: index,
      wallLength,
      spanCount,
      tateji,
      yokoji,
    };
  });

  // ── Totals ─────────────────────────────────────────────────
  const totalPerimeter = walls.reduce((sum, w) => sum + w.wallLength, 0);
  const totalSpans = walls.reduce((sum, w) => sum + w.spanCount, 0);
  const totalTateji = walls.reduce((sum, w) => sum + w.tateji, 0);
  const totalYokoji = walls.reduce((sum, w) => sum + w.yokoji, 0);

  return {
    totalPerimeter,
    totalSpans,
    levels,
    tateji: totalTateji,
    yokoji: totalYokoji,
    walls,

    // ── Future expansion (placeholders) ────────────────────
    // diagonalBracing: 0,
    // guardRails: 0,
    // toeBoards: 0,
  };
}
