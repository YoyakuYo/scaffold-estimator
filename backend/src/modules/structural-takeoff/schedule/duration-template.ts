import type { StructuralElementType } from '../element-types';

/**
 * Phase 4 — duration template.
 *
 * Per-element-type productivity numbers in pieces/working-day, used by the
 * erection sequencer to turn a quantity takeoff into a per-day demand schedule.
 *
 * Defaults follow conservative Japanese steel-frame field rates for a
 * typical mid-rise tower crane lift; admins can override per project later.
 */
export interface DurationTemplate {
  /** Pieces erected per working day, per element type. */
  piecesPerDay: Record<StructuralElementType, number>;
  /**
   * Slab cure delay in working days before the next floor's columns can start.
   * Standard Japanese practice: ~3 days for デッキ + コンクリート.
   */
  slabCureDays: number;
  /**
   * Block lag — how many floors `block N+1` lags behind `block N` before
   * starting. Common value 2 floors ("二段乗り入れ").
   */
  blockOverlapFloors: number;
  /**
   * Erection cycle order for a single (block, level). Activities run
   * sequentially inside one (block, level), then the next floor of the same
   * block starts after `slabCureDays`.
   */
  cycleOrder: StructuralElementType[];
}

export const DEFAULT_DURATION_TEMPLATE: DurationTemplate = {
  piecesPerDay: {
    hashira: 12, // 柱建方
    oobari: 16, // 大梁
    kobari: 24, // 小梁
    taifubari: 12,
    brace: 32,
    deck: 40,
    kaidan: 4,
    elevator: 4,
  },
  slabCureDays: 3,
  blockOverlapFloors: 2,
  cycleOrder: ['hashira', 'oobari', 'kobari', 'taifubari', 'brace', 'deck'],
};
