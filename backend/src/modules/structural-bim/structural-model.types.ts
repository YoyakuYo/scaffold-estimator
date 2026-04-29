/**
 * Phase 1 — canonical structural model (grid + storeys + members).
 * All plan coordinates in millimetres; IFC export converts to metres.
 */

export interface GridLine {
  label: string;
  /** Position along the orthogonal global axis (mm). */
  positionMm: number;
}

export interface Storey {
  id: string;
  name: string;
  elevationBottomMm: number;
  elevationTopMm: number;
}

export type StructuralMemberCategory = 'column' | 'beam';

export interface GridRef {
  xLabel: string;
  yLabel: string;
}

export interface StructuralMember {
  id: string;
  mark: string;
  category: StructuralMemberCategory;
  /** Free-text profile key; mapped to rectangle in IFC writer. */
  profileName: string;
  storeyId: string;
  start: GridRef;
  /** Beams only: intersection at far end. Omit for columns. */
  end?: GridRef;
  /** Optional display / IfcSurfaceStyle */
  phaseColor?: string;
}

export interface StructuralModel {
  gridX: GridLine[];
  gridY: GridLine[];
  storeys: Storey[];
  members: StructuralMember[];
}

export function defaultStructuralModel(): StructuralModel {
  return {
    gridX: [
      { label: 'X1', positionMm: 0 },
      { label: 'X2', positionMm: 6000 },
      { label: 'X3', positionMm: 12000 },
    ],
    gridY: [
      { label: 'Y1', positionMm: 0 },
      { label: 'Y2', positionMm: 5000 },
    ],
    storeys: [
      {
        id: 's1',
        name: '1F',
        elevationBottomMm: 0,
        elevationTopMm: 4000,
      },
    ],
    members: [
      {
        id: 'm-demo-col',
        mark: 'C1',
        category: 'column',
        profileName: 'H400x200',
        storeyId: 's1',
        start: { xLabel: 'X2', yLabel: 'Y1' },
      },
      {
        id: 'm-demo-beam',
        mark: 'B1',
        category: 'beam',
        profileName: 'H300x150',
        storeyId: 's1',
        start: { xLabel: 'X1', yLabel: 'Y1' },
        end: { xLabel: 'X3', yLabel: 'Y1' },
      },
    ],
  };
}

export function parseStructuralModel(raw: unknown): StructuralModel {
  if (!raw || typeof raw !== 'object') return defaultStructuralModel();
  const o = raw as Record<string, unknown>;
  const gridX = Array.isArray(o.gridX) ? (o.gridX as GridLine[]) : [];
  const gridY = Array.isArray(o.gridY) ? (o.gridY as GridLine[]) : [];
  const storeys = Array.isArray(o.storeys) ? (o.storeys as Storey[]) : [];
  const members = Array.isArray(o.members) ? (o.members as StructuralMember[]) : [];
  if (!gridX.length || !gridY.length || !storeys.length) return defaultStructuralModel();
  return { gridX, gridY, storeys, members };
}
