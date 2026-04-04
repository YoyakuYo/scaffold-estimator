/**
 * Footprint vertices for the small 2D wall-config preview (mm coordinates).
 * Falls back to a synthetic axis-aligned walk when stored polygon looks broken
 * (pixel/fraction coords vs mm lengths, outliers, etc.).
 */

export type FootprintPt = { x: number; y: number };

export type WallPreviewGeom = Readonly<{
  lengthMm: number;
  edgePlanAxis?: 'X' | 'Y';
  edgePlanAxisMm?: number;
}>;

function bboxDiagMm(vertices: ReadonlyArray<FootprintPt>): number {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of vertices) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  const w = maxX - minX;
  const h = maxY - minY;
  return Math.hypot(Math.max(0, w), Math.max(0, h));
}

/** True when outline bbox is incompatible with summed wall lengths (common unit mixups). */
export function polygonPreviewLooksBroken(
  vertices: ReadonlyArray<FootprintPt>,
  wallsPerimeterMm: number,
): boolean {
  if (vertices.length < 3 || wallsPerimeterMm < 500) return true;
  const diag = bboxDiagMm(vertices);
  if (!Number.isFinite(diag) || diag < 1) return true;
  if (wallsPerimeterMm > 3000 && diag < wallsPerimeterMm * 0.1) return true;
  if (diag > wallsPerimeterMm * 20) return true;
  return false;
}

/**
 * Corners p0..p_{n-1} from axis signed steps; closed n-gon uses edge i: p_i → p_{i+1 mod n}.
 */
export function buildSyntheticFootprintFromWalls(
  walls: ReadonlyArray<WallPreviewGeom>,
  closedFootprint: boolean,
): FootprintPt[] | null {
  const nW = walls.length;
  if (nW < 3) return null;
  const pts: FootprintPt[] = [{ x: 0, y: 0 }];
  let x = 0;
  let y = 0;
  for (let i = 0; i < nW; i++) {
    const L = Math.max(1, walls[i].lengthMm);
    const axis = walls[i].edgePlanAxis ?? 'X';
    const mm = walls[i].edgePlanAxisMm;
    const sign = mm != null && mm < 0 ? -1 : 1;
    if (axis === 'X') x += sign * L;
    else y += sign * L;
    pts.push({ x, y });
  }
  if (closedFootprint) {
    return pts.slice(0, nW);
  }
  return pts;
}

export function footprintVerticesForWallPreview(
  polygonMm: ReadonlyArray<FootprintPt> | null | undefined,
  walls: ReadonlyArray<WallPreviewGeom>,
  closedFootprint: boolean,
): FootprintPt[] | null {
  const perim = walls.reduce((s, w) => s + Math.max(0, w.lengthMm), 0);
  if (polygonMm && polygonMm.length >= 3 && perim > 0 && !polygonPreviewLooksBroken(polygonMm, perim)) {
    return [...polygonMm];
  }
  return buildSyntheticFootprintFromWalls(walls, closedFootprint);
}
