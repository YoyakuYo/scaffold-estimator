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

  const xs = allPlanVerts.map((p) => p.xFrac ?? p.x ?? 0);
  const ys = allPlanVerts.map((p) => p.yFrac ?? p.y ?? 0);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const maxX = Math.max(...xs);
  const maxY = Math.max(...ys);
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
