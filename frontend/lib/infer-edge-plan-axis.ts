/** Signed run (mm) on the stronger axis for edge i → i+1 (closed polygon). */
export function inferEdgePlanAxisFromVertices(
  verts: Array<{ x: number; y: number }>,
  edgeIndex: number,
  closed: boolean,
): { axis: 'X' | 'Y'; mm: number } | null {
  const n = verts.length;
  if (n < 2 || edgeIndex < 0 || edgeIndex >= n) return null;
  const next = closed ? (edgeIndex + 1) % n : edgeIndex + 1;
  if (next >= n) return null;
  const dx = Math.round(verts[next].x - verts[edgeIndex].x);
  const dy = Math.round(verts[next].y - verts[edgeIndex].y);
  if (Math.abs(dx) >= Math.abs(dy)) return { axis: 'X', mm: dx };
  return { axis: 'Y', mm: dy };
}
