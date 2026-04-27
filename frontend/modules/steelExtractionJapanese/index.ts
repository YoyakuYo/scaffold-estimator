/**
 * Japanese structural steel extraction (rule-based, no ML).
 *
 * Existing repo capabilities this module builds on (do not duplicate):
 * - DXF parsing: `frontend/cad/parseDxf.ts`, `backend/.../dxf.parser.ts`,
 *   `backend/.../dxf-geometry-extractor.service.ts` (geometry-only server path).
 * - Construction-plan layer heuristics: `backend/.../dxf-layer-extractor.service.ts`.
 * - Section weights: `backend/.../schedule/jis-sections.ts` (kg/m catalog; separate from geometry).
 */
export {
  extractSteelMembersJapanese,
} from './extractSteelMembersJapanese';
export {
  steelInputsFromDxfEntities,
  extractSteelMembersJapaneseFromDxfDocument,
  type DxfDocumentLike,
} from './dxfAdapter';
export { buildSteelExtractionDebugSvg } from './debugOverlay';
export { parseJapaneseSectionString, extractFirstSectionFromText } from './sectionParser';
export { normalizeSteelDrawingText, compactSectionKey } from './textNormalize';
export {
  DEFAULT_STEEL_THRESHOLDS,
  type SteelExtractionInput,
  type SteelExtractionResult,
  type SteelExtractionThresholds,
  type SteelGeometryLine,
  type SteelTextEntity,
  type SteelBeamRecord,
  type SteelColumnRecord,
  type SteelBraceRecord,
  type SteelFloorBlock,
  type SteelFloorResult,
  type GridCell,
  type ParsedSectionSize,
  type Vec2,
} from './types';
