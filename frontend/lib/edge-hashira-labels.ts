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

/** Map UI rows (keyed by wall list index) to API labeling for enabled walls only (calculation order). */
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
