/**
 * Area Calculation — Shoelace Formula
 *
 * Pure function. No UI, no side-effects.
 */

export interface Point2D {
  x: number;
  y: number;
}

/**
 * Calculate the signed area of a polygon using the shoelace formula.
 *
 * Positive = counter-clockwise winding
 * Negative = clockwise winding
 *
 * @param points - Ordered polygon vertices (closed loop implied)
 * @returns Signed area
 */
export function signedArea(points: Point2D[]): number {
  const n = points.length;
  if (n < 3) return 0;

  let area = 0;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    area += points[i].x * points[j].y;
    area -= points[j].x * points[i].y;
  }

  return area / 2;
}

/**
 * Calculate the absolute area of a polygon.
 */
export function polygonArea(points: Point2D[]): number {
  return Math.abs(signedArea(points));
}
