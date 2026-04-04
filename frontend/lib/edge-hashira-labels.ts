import type { EdgeHashiraAxisAssignment, EdgeHashiraLabeling } from '@/lib/api/scaffold-configs';

/** Single vertex label: A–Z, then V27, V28, … for >26 corners. */
export function vertexEdgeLetter(vertexIndex: number, vertexCount: number): string {
  if (vertexIndex < 0 || vertexIndex >= vertexCount) return '?';
  if (vertexCount <= 26) return String.fromCharCode(65 + vertexIndex);
  return `V${vertexIndex + 1}`;
}

/**
 * Closed footprint: wall i runs vertex i → vertex (i+1) mod n.
 * Open chain (wallCount &lt; 3): wall i runs vertex i → i+1.
 */
export function edgeChordName(wallIndex: number, wallCount: number, closed: boolean): string {
  if (wallCount < 1 || wallIndex < 0 || wallIndex >= wallCount) return '—';
  if (closed) {
    const nV = wallCount;
    return `${vertexEdgeLetter(wallIndex, nV)}${vertexEdgeLetter((wallIndex + 1) % wallCount, nV)}`;
  }
  const nV = wallCount + 1;
  return `${vertexEdgeLetter(wallIndex, nV)}${vertexEdgeLetter(wallIndex + 1, nV)}`;
}

export function defaultClosedFootprint(wallCount: number): boolean {
  return wallCount >= 3;
}

/** Human summary: `AB (X1–X4) = 13,000 mm` */
export function edgeHashiraSummaryLine(
  wallIndex: number,
  wallCount: number,
  closed: boolean,
  lengthMm: number,
  axis: '' | 'X' | 'Y',
  labelCount: number | undefined,
): string | null {
  if (axis !== 'X' && axis !== 'Y') return null;
  const chord = edgeChordName(wallIndex, wallCount, closed);
  const n = labelCount != null && labelCount > 0 ? Math.min(500, labelCount) : '…';
  const range = typeof n === 'number' ? `${axis}1–${axis}${n}` : `${axis}(auto)`;
  const len = lengthMm.toLocaleString();
  return `${chord} (${range}) = ${len} mm`;
}

export function normalizeEdgeHashiraForWallCount(
  prev: EdgeHashiraLabeling | undefined,
  wallCount: number,
): EdgeHashiraLabeling {
  const existing = prev?.assignments ?? [];
  const assignments: EdgeHashiraAxisAssignment[] = Array.from({ length: wallCount }, (_, wi) => {
    const found = existing.find((a) => a.wallIndex === wi);
    return {
      wallIndex: wi,
      axis: found?.axis === 'X' || found?.axis === 'Y' ? found.axis : ('' as const),
      ...(found?.labelCount != null && found.labelCount > 0 ? { labelCount: found.labelCount } : {}),
    };
  });
  return { assignments };
}

export type EdgeHashiraFormRow = { axis: '' | 'X' | 'Y'; countStr: string };

function rowsToLabelingAll(rows: EdgeHashiraFormRow[]): EdgeHashiraLabeling {
  return {
    assignments: rows.map((row, wi) => {
      const raw = row.countStr.trim();
      const n = raw === '' ? undefined : parseInt(raw, 10);
      const axis = row.axis === 'X' || row.axis === 'Y' ? row.axis : ('' as const);
      return {
        wallIndex: wi,
        axis,
        ...(n != null && Number.isFinite(n) && n > 0 ? { labelCount: Math.min(500, Math.floor(n)) } : {}),
      };
    }),
  };
}

/** Resize / normalize hashira rows when wall count changes; preserves assignments by index where possible. */
export function formRowsFromWallCount(prevRows: EdgeHashiraFormRow[], newCount: number): EdgeHashiraFormRow[] {
  if (newCount <= 0) return [];
  const prevLabeling = prevRows.length > 0 ? rowsToLabelingAll(prevRows) : undefined;
  const norm = normalizeEdgeHashiraForWallCount(prevLabeling, newCount);
  return norm.assignments.map((a) => ({
    axis: a.axis === 'X' || a.axis === 'Y' ? a.axis : ('' as const),
    countStr: a.labelCount != null ? String(a.labelCount) : '',
  }));
}

export function formRowsFromStoredLabeling(
  stored: EdgeHashiraLabeling | undefined,
  wallCount: number,
): EdgeHashiraFormRow[] {
  if (wallCount <= 0) return [];
  const norm = normalizeEdgeHashiraForWallCount(stored, wallCount);
  return norm.assignments.map((a) => ({
    axis: a.axis === 'X' || a.axis === 'Y' ? a.axis : ('' as const),
    countStr: a.labelCount != null ? String(a.labelCount) : '',
  }));
}

/** X/Y summary lines for Overall totals, 2D, material breakdown, etc. */
export function edgeHashiraSummariesFromResult(
  labeling: EdgeHashiraLabeling | undefined | null,
  walls: Array<{ wallLengthMm?: number }>,
  closedFootprint: boolean,
): string[] {
  if (!labeling || walls.length === 0) return [];
  const norm = normalizeEdgeHashiraForWallCount(labeling, walls.length);
  const out: string[] = [];
  for (let wi = 0; wi < walls.length; wi++) {
    const a = norm.assignments[wi];
    const axis = a?.axis === 'X' || a?.axis === 'Y' ? a.axis : ('' as const);
    const len = walls[wi]?.wallLengthMm ?? 0;
    const line = edgeHashiraSummaryLine(wi, walls.length, closedFootprint, len, axis, a?.labelCount);
    if (line) out.push(line);
  }
  return out;
}

export function edgeHashiraLineForWallIndex(
  labeling: EdgeHashiraLabeling | undefined | null,
  wallIndex: number,
  walls: Array<{ wallLengthMm?: number }>,
  closedFootprint: boolean,
): string | null {
  if (!labeling || wallIndex < 0 || wallIndex >= walls.length) return null;
  const norm = normalizeEdgeHashiraForWallCount(labeling, walls.length);
  const a = norm.assignments[wallIndex];
  const axis = a?.axis === 'X' || a?.axis === 'Y' ? a.axis : ('' as const);
  const len = walls[wallIndex]?.wallLengthMm ?? 0;
  return edgeHashiraSummaryLine(wallIndex, walls.length, closedFootprint, len, axis, a?.labelCount);
}

/** Map UI rows (keyed by wall list index) to API labeling for enabled walls only (calculation order). */
/** Max station chips rendered in material breakdown per edge (wider spans → range text only). */
const MAX_HASHIRA_STATION_CHIPS = 28;

/** Max station index offered in wall-dimension dropdowns (full range still accepts up to 500 via planning panel). */
export const EDGE_HASHIRA_STATION_SELECT_MAX = 100;

/**
 * Parse `X1-X10` / `Y2–Y5` (ASCII or en-dash) into `X1`, `X2`, … (null if not a single-axis range).
 */
export function stationsFromAxisRangeFragment(fragment: string, maxLabels = MAX_HASHIRA_STATION_CHIPS): string[] | null {
  const t = fragment.replace(/\s+/g, '').toUpperCase();
  const m = t.match(/^([XY])(\d+)[-–]([XY])(\d+)$/);
  if (!m || m[1] !== m[3]) return null;
  const axis = m[1];
  const lo = Math.min(parseInt(m[2], 10), parseInt(m[4], 10));
  const hi = Math.max(parseInt(m[2], 10), parseInt(m[4], 10));
  if (!Number.isFinite(lo) || !Number.isFinite(hi) || lo < 1) return null;
  if (hi - lo + 1 > maxLabels) return null;
  return Array.from({ length: hi - lo + 1 }, (_, i) => `${axis}${lo + i}`);
}

/**
 * From wall `sideJp` / `side`: cross grid (e.g. Y1) and along span (e.g. X1-X10) as in CAD labels.
 */
export function parseWallSideCrossAlong(sideJp: string, side: string): { cross: string | null; alongFragment: string | null } {
  const raw = (sideJp || side || '').trim();
  const slashMatch = raw.match(/([XY]\d+)\s*\/\s*([XY]\d+\s*[-–]\s*[XY]\d+)/i);
  if (slashMatch) {
    return {
      cross: slashMatch[1].toUpperCase(),
      alongFragment: slashMatch[2].toUpperCase().replace(/\s+/g, ''),
    };
  }
  const match = raw.match(/(Y\d+).*(X\d+\s*[-–]\s*X\d+)|(X\d+\s*[-–]\s*X\d+).*(Y\d+)/i);
  if (match) {
    if (match[1] && match[2]) {
      return {
        cross: match[1].toUpperCase(),
        alongFragment: match[2].toUpperCase().replace(/\s+/g, ''),
      };
    }
    if (match[3] && match[4]) {
      return {
        cross: match[4].toUpperCase(),
        alongFragment: match[3].toUpperCase().replace(/\s+/g, ''),
      };
    }
  }
  const compact = raw.replace(/\s+/g, '');
  const onlyAlong = compact.match(/^([XY])(\d+)[-–]([XY])(\d+)$/i);
  if (onlyAlong && onlyAlong[1].toUpperCase() === onlyAlong[3].toUpperCase()) {
    const ax = onlyAlong[1].toUpperCase();
    return {
      cross: null,
      alongFragment: `${ax}${onlyAlong[2]}-${ax}${onlyAlong[4]}`,
    };
  }
  return { cross: null, alongFragment: null };
}

export type EdgeHashiraXYResolved = {
  /** Grid line perpendicular to the edge (e.g. Y1). */
  crossLabel: string | null;
  /** Along-edge station range (e.g. X1–X10). */
  alongRange: string | null;
  /** Individual station ids for chip UI (subset if very long edge). */
  alongStations: string[];
};

/**
 * Merge saved X/Y labeling with wall side text so the breakdown can show both dimensions.
 * Labeling axis + count defines along-range when set; cross comes from side text (Y1 / X1–X10).
 */
export function resolveEdgeHashiraXY(
  labeling: EdgeHashiraLabeling | null | undefined,
  wallIndex: number,
  wallCount: number,
  sideJp: string,
  side: string,
): EdgeHashiraXYResolved {
  const hints = parseWallSideCrossAlong(sideJp, side);
  const norm = normalizeEdgeHashiraForWallCount(labeling ?? undefined, wallCount);
  const a = norm.assignments[wallIndex];

  let alongRange: string | null = null;
  let alongStations: string[] = [];

  if (a?.axis === 'X' || a?.axis === 'Y') {
    const n = a.labelCount;
    if (n != null && n > 0) {
      const axis = a.axis;
      const capped = Math.min(500, Math.floor(n));
      alongRange = `${axis}1–${axis}${capped}`;
      if (capped <= MAX_HASHIRA_STATION_CHIPS) {
        alongStations = Array.from({ length: capped }, (_, i) => `${axis}${i + 1}`);
      }
    }
  }

  if (!alongRange && hints.alongFragment) {
    const parsed = stationsFromAxisRangeFragment(hints.alongFragment, MAX_HASHIRA_STATION_CHIPS);
    if (parsed && parsed.length > 0) {
      alongStations = parsed;
      const t = hints.alongFragment.replace(/\s+/g, '').toUpperCase();
      const m = t.match(/^([XY])(\d+)[-–]([XY])(\d+)$/);
      if (m && m[1] === m[3]) {
        const lo = Math.min(parseInt(m[2], 10), parseInt(m[4], 10));
        const hi = Math.max(parseInt(m[2], 10), parseInt(m[4], 10));
        alongRange = `${m[1]}${lo}–${m[1]}${hi}`;
      } else {
        alongRange = hints.alongFragment.replace(/-/g, '–');
      }
    }
  }

  return {
    crossLabel: hints.cross,
    alongRange,
    alongStations,
  };
}

/**
 * Compact range for quotation/matrix column headers, e.g. "X1–X10", "Y1–Y5".
 * Matches 辺名・支柱番号 summaries; falls back to axis × post count along the edge.
 */
export function edgeHashiraColumnRangeSegment(
  labeling: EdgeHashiraLabeling | null | undefined,
  wallIndex: number,
  wallCount: number,
  sideJp: string,
  side: string,
  postCountAlongEdge: number,
): string | null {
  const xy = resolveEdgeHashiraXY(labeling, wallIndex, wallCount, sideJp, side);
  if (xy.alongRange) return xy.alongRange;
  if (xy.alongStations.length > 0) {
    return `${xy.alongStations[0]}–${xy.alongStations[xy.alongStations.length - 1]}`;
  }
  if (postCountAlongEdge >= 2) {
    const norm = normalizeEdgeHashiraForWallCount(labeling ?? undefined, wallCount);
    const axis = norm.assignments[wallIndex]?.axis === 'Y' ? 'Y' : 'X';
    return `${axis}1–${axis}${postCountAlongEdge}`;
  }
  return null;
}

export function labelingForEnabledWallIndices(
  enabledOriginalIndices: number[],
  rows: EdgeHashiraFormRow[],
): EdgeHashiraLabeling | undefined {
  if (enabledOriginalIndices.length === 0) return undefined;
  const assignments: EdgeHashiraAxisAssignment[] = enabledOriginalIndices.map((origIdx, newIdx) => {
    const row = rows[origIdx] ?? { axis: '' as const, countStr: '' };
    const raw = row.countStr.trim();
    const n = raw === '' ? undefined : parseInt(raw, 10);
    const axis = row.axis === 'X' || row.axis === 'Y' ? row.axis : ('' as const);
    return {
      wallIndex: newIdx,
      axis,
      ...(n != null && Number.isFinite(n) && n > 0 ? { labelCount: Math.min(500, Math.floor(n)) } : {}),
    };
  });
  return { assignments };
}
