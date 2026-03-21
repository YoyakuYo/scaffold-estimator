/**
 * Shared plan → horizontal metres (XZ) mapping for AI BIM building preview and
 * scaffold 3D. Matches `Building3DPreview` in scaffold/page.tsx: one scale and
 * origin from the bounding box of the ground outline PLUS every massing tier
 * vertex, so stacked tiers keep the same relative positions as on the confirm screen.
 */

export type BimPreviewVertex = {
  x?: number;
  y?: number;
  xFrac?: number;
  yFrac?: number;
};

function minMax2D(coords: Array<{ x: number; y: number }>): { minX: number; minY: number; maxX: number; maxY: number } {
  if (coords.length === 0) {
    return { minX: 0, minY: 0, maxX: 1e-6, maxY: 1e-6 };
  }
  let minX = coords[0]!.x;
  let minY = coords[0]!.y;
  let maxX = minX;
  let maxY = minY;
  for (let i = 1; i < coords.length; i++) {
    const p = coords[i]!;
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY };
}

export function computeBimPreviewPlanToM(params: {
  outline: BimPreviewVertex[];
  massingTiers?: Array<{ vertices: BimPreviewVertex[] }>;
  wallLengthsMm?: number[];
}): {
  toPlanM: (verts: BimPreviewVertex[]) => Array<{ x: number; z: number }>;
  /** Ground-plan extent in metres (horizontal), for grid / ground plane sizing */
  planSpanXM: number;
  planSpanZM: number;
} {
  const { outline, massingTiers, wallLengthsMm } = params;

  const allPlanVerts: BimPreviewVertex[] = [
    ...outline,
    ...(massingTiers?.flatMap((tier) => tier.vertices) ?? []),
  ];

  const xyPairs = allPlanVerts.map((p) => ({
    x: p.xFrac ?? p.x ?? 0,
    y: p.yFrac ?? p.y ?? 0,
  }));
  const { minX, minY, maxX, maxY } = minMax2D(xyPairs);
  const spanX = Math.max(maxX - minX, 1e-6);
  const spanY = Math.max(maxY - minY, 1e-6);

  const maxCoord = Math.max(spanX, spanY);
  let toM: number;
  if (maxCoord > 500) {
    toM = 0.001;
  } else if (maxCoord > 5) {
    toM = 1;
  } else {
    const perimeter = wallLengthsMm?.reduce((s, l) => s + (typeof l === 'number' ? l : 0), 0) ?? 40000;
    toM = (perimeter * 0.001) / (2 * (spanX + spanY));
  }

  const toPlanM = (verts: BimPreviewVertex[]) =>
    verts.map((p) => {
      const px = p.xFrac ?? p.x ?? 0;
      const py = p.yFrac ?? p.y ?? 0;
      return {
        x: (px - minX) * toM,
        z: (py - minY) * toM,
      };
    });

  return { toPlanM, planSpanXM: spanX * toM, planSpanZM: spanY * toM };
}
