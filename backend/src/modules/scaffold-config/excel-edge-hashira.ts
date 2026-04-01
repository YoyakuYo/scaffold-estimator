/**
 * Minimal copy of frontend edge-hashira resolution for Excel 材料明細 (UTF-8 safe).
 */

export interface EdgeHashiraAxisAssignment {
  wallIndex: number;
  axis: '' | 'X' | 'Y';
  labelCount?: number;
}

export interface EdgeHashiraLabeling {
  assignments: EdgeHashiraAxisAssignment[];
}

const MAX_HASHIRA_STATION_CHIPS = 28;

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
  crossLabel: string | null;
  alongRange: string | null;
  alongStations: string[];
};

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

export function edgeChordNameExcel(wallIndex: number, wallCount: number, closed: boolean): string {
  const vertexEdgeLetter = (i: number, n: number): string => {
    if (i < 0 || i >= n) return '?';
    if (n <= 26) return String.fromCharCode(65 + i);
    return `V${i + 1}`;
  };
  if (wallCount < 1 || wallIndex < 0 || wallIndex >= wallCount) return '—';
  if (closed) {
    const nV = wallCount;
    return `${vertexEdgeLetter(wallIndex, nV)}${vertexEdgeLetter((wallIndex + 1) % wallCount, nV)}`;
  }
  const nV = wallCount + 1;
  return `${vertexEdgeLetter(wallIndex, nV)}${vertexEdgeLetter(wallIndex + 1, nV)}`;
}

/**
 * Matches frontend `edgeHashiraColumnRangeSegment` — along-edge station range for column headers.
 */
export function edgeHashiraColumnRangeSegmentExcel(
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

export type ExcelWallHeaderInput = {
  side: string;
  sideJp?: string;
  spans?: number[];
  baseHeightMm?: number;
};

/**
 * Multi-line header for 見積表 / 面別列: chord (AB), optional (X1–Xn), optional tier GL+m (matches result page).
 */
export function excelQuotationWallColumnHeader(
  wallIndex: number,
  walls: ExcelWallHeaderInput[],
  closedFootprint: boolean,
  labeling: EdgeHashiraLabeling | undefined,
): string {
  const wallCount = walls.length;
  const chord = edgeChordNameExcel(wallIndex, wallCount, closedFootprint);
  const wall = walls[wallIndex];
  if (!wall) return chord;
  const postAlong = (Array.isArray(wall.spans) ? wall.spans.length : 0) + 1;
  const seg = edgeHashiraColumnRangeSegmentExcel(
    labeling,
    wallIndex,
    wallCount,
    wall.sideJp ?? '',
    wall.side ?? '',
    postAlong,
  );
  const lines: string[] = [chord];
  if (seg) lines.push(`(${seg})`);
  const baseH = wall.baseHeightMm ?? 0;
  if (baseH > 0) {
    lines.push(` GL+${(baseH / 1000).toFixed(0)}m`);
  }
  return lines.join('\n');
}
