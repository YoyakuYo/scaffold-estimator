import type { GridLine, Storey, StructuralMember, StructuralModel } from './structural-model.types';

export interface PlanPointMm {
  xMm: number;
  yMm: number;
}

export interface PlacedColumn {
  memberId: string;
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
  mark: string;
  profileName: string;
  x1Mm: number;
  y1Mm: number;
  x2Mm: number;
  y2Mm: number;
  zMm: number;
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

/** Phase 3 — grid intersections + storey slab elevation → 3D placement inputs. */
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
