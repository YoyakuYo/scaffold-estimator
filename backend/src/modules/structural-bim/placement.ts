import type { GridLine, Storey, StructuralMember, StructuralModel } from './structural-model.types';

export interface PlanPointMm {
  xMm: number;
  yMm: number;
}

export interface PlacedColumn {
  memberId: string;
  storeyId: string;
  mark: string;
  profileName: string;
  xMm: number;
  yMm: number;
  zBottomMm: number;
  heightMm: number;
  phaseColor?: string;
}

export interface PlacedBeam {
  memberId: string;
  storeyId: string;
  mark: string;
  profileName: string;
  x1Mm: number;
  y1Mm: number;
  x2Mm: number;
  y2Mm: number;
  zMm: number;
  phaseColor?: string;
}

/** Thin floor slab per storey (grid bounding box). */
export interface PlacedSlab {
  storeyId: string;
  name: string;
  xMinMm: number;
  xMaxMm: number;
  yMinMm: number;
  yMaxMm: number;
  zBottomMm: number;
  thicknessMm: number;
  phaseColor?: string;
}

/** Gross joint proxy where a beam meets a column on the same grid + storey. */
export interface PlacedConnection {
  storeyId: string;
  mark: string;
  xMm: number;
  yMm: number;
  zBottomMm: number;
  sizeMm: number;
  thicknessMm: number;
  phaseColor?: string;
}

function axisMap(lines: GridLine[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const g of lines) {
    m.set(String(g.label).trim(), g.positionMm);
  }
  return m;
}

export function intersectionMm(model: StructuralModel, xLabel: string, yLabel: string): PlanPointMm {
  const xm = axisMap(model.gridX);
  const ym = axisMap(model.gridY);
  const x = xm.get(xLabel.trim());
  const y = ym.get(yLabel.trim());
  if (x === undefined) throw new Error(`Unknown X grid label: ${xLabel}`);
  if (y === undefined) throw new Error(`Unknown Y grid label: ${yLabel}`);
  return { xMm: x, yMm: y };
}

export function getStorey(model: StructuralModel, storeyId: string): Storey {
  const s = model.storeys.find((t) => t.id === storeyId);
  if (!s) throw new Error(`Unknown storey id: ${storeyId}`);
  return s;
}

function gridBoundsMm(model: StructuralModel): { xMin: number; xMax: number; yMin: number; yMax: number } {
  const xs = model.gridX.map((g) => g.positionMm);
  const ys = model.gridY.map((g) => g.positionMm);
  return {
    xMin: Math.min(...xs),
    xMax: Math.max(...xs),
    yMin: Math.min(...ys),
    yMax: Math.max(...ys),
  };
}

export function modelExportOptions(model: StructuralModel): { slabs: boolean; connections: boolean } {
  const o = (model as StructuralModel & { options?: { slabs?: boolean; connections?: boolean } }).options;
  return {
    slabs: o?.slabs !== false,
    connections: o?.connections !== false,
  };
}

/** One slab per storey at top − thickness (visual floor plate). */
export function computeSlabsPerStorey(model: StructuralModel): PlacedSlab[] {
  const { xMin, xMax, yMin, yMax } = gridBoundsMm(model);
  const thicknessMm = 250;
  return model.storeys.map((s) => ({
    storeyId: s.id,
    name: `Slab-${s.name}`,
    xMinMm: xMin,
    xMaxMm: xMax,
    yMinMm: yMin,
    yMaxMm: yMax,
    zBottomMm: s.elevationTopMm - thicknessMm,
    thicknessMm,
    phaseColor: '#c8d4e0',
  }));
}

/**
 * IfcPlate proxies at grid nodes where a column exists and a beam ends (same storey).
 */
export function computeFrameConnections(model: StructuralModel): PlacedConnection[] {
  const colKeys = new Set<string>();
  for (const m of model.members) {
    if (m.category === 'column') {
      colKeys.add(`${m.storeyId}|${m.start.xLabel.trim()}|${m.start.yLabel.trim()}`);
    }
  }
  const seen = new Set<string>();
  const out: PlacedConnection[] = [];
  const sizeMm = 320;
  const thicknessMm = 40;

  for (const m of model.members) {
    if (m.category !== 'beam' || !m.end) continue;
    const storey = getStorey(model, m.storeyId);
    const zBeam = storey.elevationTopMm - 200;
    for (const end of [m.start, m.end]) {
      const key = `${m.storeyId}|${end.xLabel.trim()}|${end.yLabel.trim()}`;
      if (!colKeys.has(key) || seen.has(key)) continue;
      seen.add(key);
      const p = intersectionMm(model, end.xLabel, end.yLabel);
      out.push({
        storeyId: m.storeyId,
        mark: `JC-${end.xLabel}-${end.yLabel}`,
        xMm: p.xMm,
        yMm: p.yMm,
        zBottomMm: zBeam - thicknessMm / 2,
        sizeMm,
        thicknessMm,
        phaseColor: m.phaseColor ?? '#f59e0b',
      });
    }
  }
  return out;
}

/** Grid intersections + storey → 3D placement inputs. */
export function placeMembers(model: StructuralModel): {
  columns: PlacedColumn[];
  beams: PlacedBeam[];
} {
  const columns: PlacedColumn[] = [];
  const beams: PlacedBeam[] = [];

  for (const m of model.members) {
    const storey = getStorey(model, m.storeyId);
    const zTop = storey.elevationTopMm;
    const zBottom = storey.elevationBottomMm;
    const heightMm = Math.max(100, zTop - zBottom);

    if (m.category === 'column') {
      const p = intersectionMm(model, m.start.xLabel, m.start.yLabel);
      columns.push({
        memberId: m.id,
        storeyId: m.storeyId,
        mark: m.mark,
        profileName: m.profileName,
        xMm: p.xMm,
        yMm: p.yMm,
        zBottomMm: zBottom,
        heightMm,
        phaseColor: m.phaseColor,
      });
    } else {
      if (!m.end) throw new Error(`Beam ${m.mark} requires end grid.`);
      const a = intersectionMm(model, m.start.xLabel, m.start.yLabel);
      const b = intersectionMm(model, m.end.xLabel, m.end.yLabel);
      beams.push({
        memberId: m.id,
        storeyId: m.storeyId,
        mark: m.mark,
        profileName: m.profileName,
        x1Mm: a.xMm,
        y1Mm: a.yMm,
        x2Mm: b.xMm,
        y2Mm: b.yMm,
        zMm: zTop - 200,
        phaseColor: m.phaseColor,
      });
    }
  }

  return { columns, beams };
}
