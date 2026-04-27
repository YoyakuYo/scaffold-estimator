import { buildGridFromTexts, nearestGridCell } from './gridDetection';
import { segmentMidpoint } from './geometry';
import { classifySteelLine } from './memberDetection';
import { extractFloorFromText, layerSuggestsFloor } from './patterns';
import {
  DEFAULT_STEEL_THRESHOLDS,
  type SteelExtractionInput,
  type SteelExtractionResult,
  type SteelFloorBlock,
  type SteelFloorResult,
  type SteelGeometryLine,
  type SteelTextEntity,
  type Vec2,
} from './types';

function emptyBlock(): SteelFloorBlock {
  return { beams: [], columns: [], braces: [] };
}

function ensureFloor(floors: Record<string, SteelFloorResult>, floor: string): SteelFloorResult {
  if (!floors[floor]) {
    floors[floor] = { blocks: {} };
  }
  return floors[floor]!;
}

function ensureBlock(fr: SteelFloorResult, blockId: string): SteelFloorBlock {
  if (!fr.blocks[blockId]) {
    fr.blocks[blockId] = emptyBlock();
  }
  return fr.blocks[blockId]!;
}

function inferFloorForGeometry(
  midpoint: Vec2,
  layer: string | undefined,
  texts: SteelTextEntity[],
  defaultFloor: string | null | undefined,
  snap: number,
): string {
  const fromLayer = layerSuggestsFloor(layer);
  if (fromLayer) return fromLayer;

  const maxD2 = snap * snap;
  for (const t of texts) {
    const dx = t.x - midpoint[0];
    const dy = t.y - midpoint[1];
    if (dx * dx + dy * dy > maxD2) continue;
    const f = extractFloorFromText(t.content);
    if (f) return f;
  }

  if (defaultFloor && defaultFloor.trim()) return defaultFloor.trim();
  return 'unknown';
}

/**
 * Rule-based extraction: beams, columns, braces with section + labels,
 * grouped by inferred floor and nearest grid cell (e.g. A-1).
 */
export function extractSteelMembersJapanese(input: SteelExtractionInput): SteelExtractionResult {
  const thresholds = { ...DEFAULT_STEEL_THRESHOLDS, ...input.thresholds };
  const warnings: string[] = [];

  const gridCells = buildGridFromTexts(input.texts, thresholds);
  if (gridCells.length === 0) {
    warnings.push(
      'No grid intersections from A–Z / 1–99 text labels; members placed in block "unassigned".',
    );
  }

  const floors: Record<string, SteelFloorResult> = {};

  for (const line of input.lines) {
    const c = classifySteelLine(line, input.texts, thresholds);
    if (c.kind === 'ignore') continue;

    const mid: Vec2 =
      c.kind === 'column'
        ? c.record.position
        : segmentMidpoint(line as SteelGeometryLine);

    const floor = inferFloorForGeometry(
      mid,
      line.layer,
      input.texts,
      input.defaultFloor,
      thresholds.textSnapDistance,
    );
    const fr = ensureFloor(floors, floor);

    const cell = nearestGridCell(mid, gridCells);
    const blockId = cell?.id ?? 'unassigned';

    const blk = ensureBlock(fr, blockId);
    if (c.kind === 'beam') blk.beams.push(c.record);
    else if (c.kind === 'column') blk.columns.push(c.record);
    else blk.braces.push(c.record);
  }

  if (Object.keys(floors).length === 0) {
    warnings.push('No structural line segments classified; check geometry scale and thresholds.');
    ensureFloor(floors, 'unknown');
    ensureBlock(floors['unknown']!, 'unassigned');
  }

  return {
    floors,
    meta: { gridCells, warnings, thresholds },
  };
}
