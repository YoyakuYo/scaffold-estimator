/**
 * Map free-text profile names to extrusion rectangle (mm).
 * Phase 4 — small built-in catalog; extend with JIS tables later.
 */
export function profileRectangleMm(profileName: string): { bMm: number; dMm: number } {
  const s = profileName.trim().toUpperCase();
  const m = s.match(/(\d+)\s*[Xx×]\s*(\d+)/);
  if (m) {
    const a = Math.min(Number(m[1]), Number(m[2]));
    const b = Math.max(Number(m[1]), Number(m[2]));
    return { bMm: a, dMm: b };
  }
  return { bMm: 200, dMm: 200 };
}
