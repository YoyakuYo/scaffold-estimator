import type { SteelGeometryLine, SteelTextEntity, Vec2 } from './types';

export function segmentLength(line: SteelGeometryLine): number {
  return Math.hypot(line.x2 - line.x1, line.y2 - line.y1);
}

export function segmentMidpoint(line: SteelGeometryLine): Vec2 {
  return [(line.x1 + line.x2) / 2, (line.y1 + line.y2) / 2];
}

/** Angle in degrees [0, 180) relative to +X axis. */
export function segmentAngleDeg(line: SteelGeometryLine): number {
  const dx = line.x2 - line.x1;
  const dy = line.y2 - line.y1;
  let deg = (Math.atan2(dy, dx) * 180) / Math.PI;
  while (deg < 0) deg += 360;
  while (deg >= 180) deg -= 180;
  return deg;
}

export function distance2(a: Vec2, b: Vec2): number {
  const dx = a[0] - b[0];
  const dy = a[1] - b[1];
  return dx * dx + dy * dy;
}

export function nearestTextToPoint(
  point: Vec2,
  texts: SteelTextEntity[],
  maxDistSq: number,
): { text: SteelTextEntity; d2: number } | null {
  let best: { text: SteelTextEntity; d2: number } | null = null;
  for (const t of texts) {
    const d2 = distance2(point, [t.x, t.y]);
    if (d2 > maxDistSq) continue;
    if (!best || d2 < best.d2) best = { text: t, d2 };
  }
  return best;
}
