/**
 * Phase 3 — Construction Plan extraction.
 *
 * The eight structural element categories tracked in the takeoff. Names follow
 * Japanese steel-frame convention (柱・大梁・小梁・耐風梁・ブレース・階段・エレベーター・デッキ).
 */
export type StructuralElementType =
  | 'hashira'    // 柱 (column)
  | 'oobari'     // 大梁 (main beam)
  | 'kobari'     // 小梁 (small beam)
  | 'taifubari'  // 耐風梁 (wind beam)
  | 'brace'      // ブレース (brace)
  | 'kaidan'     // 階段 (stair)
  | 'elevator'   // エレベーター (elevator shaft / cab kit)
  | 'deck';      // デッキ (deck plate / slab)

export const STRUCTURAL_ELEMENT_TYPES: readonly StructuralElementType[] = [
  'hashira',
  'oobari',
  'kobari',
  'taifubari',
  'brace',
  'kaidan',
  'elevator',
  'deck',
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
