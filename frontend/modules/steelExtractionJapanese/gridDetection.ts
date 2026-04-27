import { isGridLetterToken, isGridNumberToken } from './patterns';
import { normalizeSteelDrawingText } from './textNormalize';
import type { GridCell, SteelExtractionThresholds, SteelTextEntity } from './types';

interface AxisCluster {
  pos: number;
  label: string;
}

function cluster1D(
  items: { value: number; label: string }[],
  tolerance: number,
): AxisCluster[] {
  if (items.length === 0) return [];
  const sorted = [...items].sort((a, b) => a.value - b.value);
  const clusters: AxisCluster[] = [];
  let cur: typeof sorted = [sorted[0]!];
  for (let i = 1; i < sorted.length; i++) {
    const it = sorted[i]!;
    if (Math.abs(it.value - cur[0]!.value) <= tolerance) {
      cur.push(it);
    } else {
      clusters.push(finishCluster(cur));
      cur = [it];
    }
  }
  clusters.push(finishCluster(cur));
  return clusters;
}

function finishCluster(group: { value: number; label: string }[]): AxisCluster {
  const pos = group.reduce((s, g) => s + g.value, 0) / group.length;
  const labels = [...new Set(group.map((g) => g.label))].sort();
  return { pos, label: labels[0] || '?' };
}

/**
 * Build grid intersection cells from single-letter and small integer text labels.
 * `letterAxisIsX` true: letters sit on varying X (column grid), numbers on varying Y (row grid).
 * false: numbers on X, letters on Y.
 */
export function buildGridFromTexts(
  texts: SteelTextEntity[],
  thresholds: SteelExtractionThresholds,
): GridCell[] {
  const letterAlongX: { value: number; label: string }[] = [];
  const numberAlongY: { value: number; label: string }[] = [];
  const numberAlongX: { value: number; label: string }[] = [];
  const letterAlongY: { value: number; label: string }[] = [];

  for (const t of texts) {
    const c = normalizeSteelDrawingText(t.content).trim();
    if (isGridLetterToken(c)) {
      letterAlongX.push({ value: t.x, label: c.toUpperCase() });
      letterAlongY.push({ value: t.y, label: c.toUpperCase() });
    } else if (isGridNumberToken(c)) {
      numberAlongY.push({ value: t.y, label: c });
      numberAlongX.push({ value: t.x, label: c });
    }
  }

  let xClusters: AxisCluster[];
  let yClusters: AxisCluster[];
  if (thresholds.letterAxisIsX) {
    xClusters = cluster1D(letterAlongX, thresholds.gridAxisTolerance);
    yClusters = cluster1D(numberAlongY, thresholds.gridAxisTolerance);
  } else {
    xClusters = cluster1D(numberAlongX, thresholds.gridAxisTolerance);
    yClusters = cluster1D(letterAlongY, thresholds.gridAxisTolerance);
  }

  const cells: GridCell[] = [];
  for (const xc of xClusters) {
    for (const yc of yClusters) {
      const id = thresholds.letterAxisIsX
        ? `${xc.label}-${yc.label}`
        : `${yc.label}-${xc.label}`;
      cells.push({ id, x: xc.pos, y: yc.pos });
    }
  }
  return cells;
}

export function nearestGridCell(point: [number, number], cells: GridCell[]): GridCell | null {
  if (cells.length === 0) return null;
  let best: GridCell | null = null;
  let bestD = Infinity;
  for (const c of cells) {
    const d = (c.x - point[0]) ** 2 + (c.y - point[1]) ** 2;
    if (d < bestD) {
      bestD = d;
      best = c;
    }
  }
  return best;
}
