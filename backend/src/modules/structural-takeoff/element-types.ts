/**
 * Phase 3 — Construction Plan extraction.
 *
 * Nine structural steel categories tracked in the takeoff (no deck/slabs).
 *
 * Common JP drawing notation (varies by office):
 * - 柱: marks prefixed **C** (Column).
 * - 大梁 / G梁: **G** (Girder) → `oobari`.
 * - 小梁 / B梁 / b梁: **B** / **b** (Beam) → `kobari` (often includes tertiary beams labeled **b** only).
 * - 孫梁: beams tying **kobari** to **kobari**; drawings often reuse **b** labels → use `magobari`
 *   when the quantity row explicitly says 孫梁 / magobari.
 * - 片持ち梁 (cantilever): **CG** (cantilever girder → tie to `katamochibari`), **CB** (cantilever **b**
 *   beam → prefer `katamochibari` when explicitly cantilever; else sometimes folded into `oobari`/`kobari`).
 * - 耐風梁: plan marks **Hb** / **HB** + digits (e.g. HB30) → `taifubari` (matches Excel/DXF/AI heuristics). Offices that use **HB** for horizontal brace should spell **水平ブレース** (mapped to `brace`).
 * - Vertical braces on elevations are commonly **V** (already folded into `brace`).
 *
 * Connection vocabulary used on legends but stored via {@link ElementLineKind}: ガセットプレート,
 * スプライスプレート, 高力ボルト, ピン接合 — not separate structural categories.
 */
export type StructuralElementType =
  | 'hashira'        // 柱 (column)
  | 'oobari'         // 大梁 / G梁
  | 'kobari'         // 小梁 / B梁・b梁
  | 'magobari'       // 孫梁 — tertiary beams between kobari
  | 'katamochibari'  // 片持ち梁 — cantilever girders/beams (CG/CB style marks)
  | 'taifubari'      // 耐風梁 (wind beam; Hb/HB marks)
  | 'brace'          // ブレース (brace)
  | 'kaidan'         // 階段 (stair)
  | 'elevator'       // ELV / エレベーターシャフト等

export const STRUCTURAL_ELEMENT_TYPES: readonly StructuralElementType[] = [
  'hashira',
  'oobari',
  'kobari',
  'magobari',
  'katamochibari',
  'taifubari',
  'brace',
  'kaidan',
  'elevator',
] as const;

/**
 * Steel frame shapes only — used for erection schedule, truck packing, and steel weight rollups.
 * Stair kits / elevator line items stay in the quantity takeoff but are excluded from these flows.
 */
export const STEEL_MEMBER_ELEMENT_TYPES: readonly StructuralElementType[] = [
  'hashira',
  'oobari',
  'kobari',
  'magobari',
  'katamochibari',
  'taifubari',
  'brace',
] as const;

export type ExtractionSource = 'manual' | 'excel' | 'dxf' | 'ai' | 'ifc';

export type ElementLineKind = 'member' | 'bolt' | 'connection' | 'misc';

export const ELEMENT_LINE_KINDS: readonly ElementLineKind[] = [
  'member',
  'bolt',
  'connection',
  'misc',
] as const;

/** Drawing classification kinds — what role each uploaded file plays. */
export type DrawingKind =
  | 'framing_plan'   // 構造伏図
  | 'column_list'    // 柱リスト
  | 'beam_list'      // 大梁リスト / 小梁リスト
  | 'stair_detail'   // 階段詳細
  | 'elevator_shaft' // EVシャフト
  | 'level_diagram'  // 階高表
  | 'general'        // unspecified building plan / 立面 / etc.
  | 'unknown';

export const DRAWING_KINDS: readonly DrawingKind[] = [
  'framing_plan',
  'column_list',
  'beam_list',
  'stair_detail',
  'elevator_shaft',
  'level_diagram',
  'general',
  'unknown',
] as const;

/** Classification provenance — `manual` is sticky and never overwritten by re-runs. */
export type ClassificationSource = 'auto' | 'manual';
