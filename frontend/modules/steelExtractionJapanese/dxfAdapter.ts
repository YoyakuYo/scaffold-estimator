/**
 * Maps raw `dxf-parser` entities to {@link SteelExtractionInput} geometry + text.
 * Does not parse DXF bytes — use `parseDxf` from `@/cad/parseDxf` first.
 */

import { extractSteelMembersJapanese } from './extractSteelMembersJapanese';
import type { SteelExtractionInput, SteelExtractionResult, SteelGeometryLine, SteelTextEntity } from './types';

function pushLineSegmentsFromVertices(
  vertices: Array<{ x?: number; y?: number; 0?: number; 1?: number }>,
  closed: boolean,
  layer: string,
  out: SteelGeometryLine[],
): void {
  const pts: { x: number; y: number }[] = [];
  for (const v of vertices) {
    const x = (v as any).x ?? (v as any)[0];
    const y = (v as any).y ?? (v as any)[1];
    if (typeof x === 'number' && typeof y === 'number' && Number.isFinite(x) && Number.isFinite(y)) {
      pts.push({ x, y });
    }
  }
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i]!;
    const b = pts[i + 1]!;
    out.push({ x1: a.x, y1: a.y, x2: b.x, y2: b.y, layer });
  }
  if (closed && pts.length >= 3) {
    const a = pts[pts.length - 1]!;
    const b = pts[0]!;
    out.push({ x1: a.x, y1: a.y, x2: b.x, y2: b.y, layer });
  }
}

/**
 * Convert parsed DXF `entities` array into lines + texts for steel extraction.
 */
export function steelInputsFromDxfEntities(entities: unknown[]): {
  lines: SteelGeometryLine[];
  texts: SteelTextEntity[];
  layers: string[];
} {
  const lines: SteelGeometryLine[] = [];
  const texts: SteelTextEntity[] = [];
  const layerSet = new Set<string>();

  if (!Array.isArray(entities)) {
    return { lines, texts, layers: [] };
  }

  for (const raw of entities) {
    const ent = raw as Record<string, unknown>;
    const type = ent.type as string | undefined;
    const layer = ((ent.layer as string) || '0').trim() || '0';
    layerSet.add(layer);

    if (type === 'LINE') {
      const s = ent.start as { x?: number; y?: number } | undefined;
      const e = ent.end as { x?: number; y?: number } | undefined;
      if (s && e && typeof s.x === 'number' && typeof s.y === 'number' && typeof e.x === 'number' && typeof e.y === 'number') {
        lines.push({ x1: s.x, y1: s.y, x2: e.x, y2: e.y, layer });
      }
      continue;
    }

    if (type === 'LWPOLYLINE' || type === 'POLYLINE') {
      const verts = (ent.vertices || ent.points || []) as Array<{
        x?: number;
        y?: number;
        0?: number;
        1?: number;
      }>;
      const closed = !!(ent.shape || ent.closed);
      pushLineSegmentsFromVertices(verts, closed, layer, lines);
      continue;
    }

    if (type === 'TEXT' || type === 'MTEXT') {
      const pos = (ent.position || ent.start || { x: 0, y: 0 }) as { x?: number; y?: number };
      const x = typeof pos.x === 'number' ? pos.x : 0;
      const y = typeof pos.y === 'number' ? pos.y : 0;
      const content = String(ent.text ?? ent.string ?? '').replace(/\r/g, '');
      if (content.trim()) {
        texts.push({ content, x, y, layer });
      }
    }
  }

  return { lines, texts, layers: Array.from(layerSet).sort() };
}

/** Parsed DXF document shape from `dxf-parser` (entities array). */
export interface DxfDocumentLike {
  entities?: unknown[] | null;
}

/**
 * Run steel extraction on an already-parsed DXF document.
 */
export function extractSteelMembersJapaneseFromDxfDocument(
  dxf: DxfDocumentLike,
  options?: Omit<SteelExtractionInput, 'lines' | 'texts'>,
): SteelExtractionResult {
  const { lines, texts } = steelInputsFromDxfEntities(dxf.entities || []);
  return extractSteelMembersJapanese({ lines, texts, ...options });
}
