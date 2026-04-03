export type VertexCornerKind = 'convex' | 'reflex';

/**
 * Per-vertex classification matching backend `inferReflexVerticesFromOutline`
 * (simple polygon, vertex i = junction before wall i along the closed walk).
 */
export function inferVertexCornerKindsFromPolygonMm(
  vertices: Array<{ x: number; y: number }>,
): VertexCornerKind[] {
  const n = vertices.length;
  if (n < 3) return Array.from({ length: n }, () => 'convex');
  let area2 = 0;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    area2 += vertices[i]!.x * vertices[j]!.y - vertices[j]!.x * vertices[i]!.y;
  }
  const isCCW = area2 > 0;
  const out: VertexCornerKind[] = [];
  for (let i = 0; i < n; i++) {
    const prev = vertices[(i - 1 + n) % n]!;
    const curr = vertices[i]!;
    const next = vertices[(i + 1) % n]!;
    const cross =
      (curr.x - prev.x) * (next.y - curr.y) - (curr.y - prev.y) * (next.x - curr.x);
    const isReflex = isCCW ? cross < 0 : cross > 0;
    out.push(isReflex ? 'reflex' : 'convex');
  }
  return out;
}
