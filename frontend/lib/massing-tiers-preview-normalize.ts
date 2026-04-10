import type { VisionMassingTier } from '@/lib/api/vision-bim';

export type PreviewPlanVertex = { x?: number; y?: number; xFrac?: number; yFrac?: number };

function previewVertexXY(v: PreviewPlanVertex): { x: number; y: number } {
  return {
    x: v.xFrac ?? v.x ?? 0,
    y: v.yFrac ?? v.y ?? 0,
  };
}

function previewBounds(verts: PreviewPlanVertex[]): {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  spanX: number;
  spanY: number;
} {
  const pts = verts.map(previewVertexXY);
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const maxX = Math.max(...xs);
  const maxY = Math.max(...ys);
  return {
    minX,
    minY,
    maxX,
    maxY,
    spanX: Math.max(maxX - minX, 1e-9),
    spanY: Math.max(maxY - minY, 1e-9),
  };
}

function isFractionLikePreviewVerts(verts: PreviewPlanVertex[]): boolean {
  if (verts.length < 3) return false;
  const { minX, minY, maxX, maxY, spanX, spanY } = previewBounds(verts);
  const maxCoord = Math.max(Math.abs(minX), Math.abs(minY), Math.abs(maxX), Math.abs(maxY));
  return maxCoord <= 1.1 && Math.max(spanX, spanY) <= 1.1;
}

function previewPolygonArea(verts: PreviewPlanVertex[]): number {
  if (verts.length < 3) return 0;
  const pts = verts.map(previewVertexXY);
  let area = 0;
  for (let i = 0; i < pts.length; i++) {
    const j = (i + 1) % pts.length;
    area += pts[i].x * pts[j].y - pts[j].x * pts[i].y;
  }
  return Math.abs(area / 2);
}

/**
 * Align fraction-tier vertices to a mm outline and drop unusable tiers for 2D/3D preview.
 */
export function normalizeMassingTiersForPreview(
  outline: Array<{ xFrac: number; yFrac: number }>,
  massingTiers?: VisionMassingTier[],
): VisionMassingTier[] {
  if (!Array.isArray(massingTiers) || massingTiers.length === 0 || outline.length < 3) return [];

  const outlineIsFraction = isFractionLikePreviewVerts(outline);
  const outlineBox = previewBounds(outline);
  const outlineArea = Math.max(previewPolygonArea(outline), 1e-9);

  return massingTiers
    .filter((tier) => Array.isArray(tier.vertices) && tier.vertices.length >= 3)
    .map((tier) => {
      const tierVerts = tier.vertices as PreviewPlanVertex[];
      const tierIsFraction = isFractionLikePreviewVerts(tierVerts);

      if (tierIsFraction && !outlineIsFraction) {
        return {
          ...tier,
          vertices: tierVerts.map((v) => {
            const p = previewVertexXY(v);
            return {
              x: Math.round(outlineBox.minX + p.x * outlineBox.spanX),
              y: Math.round(outlineBox.minY + p.y * outlineBox.spanY),
            };
          }),
        } satisfies VisionMassingTier;
      }

      return tier;
    })
    .filter((tier) => {
      const tverts = tier.vertices as PreviewPlanVertex[];
      const tierIsFraction = isFractionLikePreviewVerts(tverts);
      if (!tierIsFraction && outlineIsFraction) return true;
      const area = previewPolygonArea(tverts);
      return area >= outlineArea * 0.002 && area <= outlineArea * 1.1;
    });
}
