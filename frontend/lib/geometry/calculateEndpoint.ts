import { Point, Axis } from './types';

/**
 * Calculates the endpoint of a segment given a start point, axis, and length.
 * 
 * @param start - Starting point
 * @param axis - Direction axis ('horizontal' or 'vertical')
 * @param lengthInPixels - Length in pixels (not meters)
 * @returns Calculated endpoint
 */
export function calculateEndpoint(
  start: Point,
  axis: Axis,
  lengthInPixels: number
): Point {
  if (axis === 'horizontal') {
    // Determine direction based on sign of length
    // Positive = right, negative = left
    return {
      x: start.x + lengthInPixels,
      y: start.y,
    };
  } else {
    // Positive = down, negative = up
    return {
      x: start.x,
      y: start.y + lengthInPixels,
    };
  }
}

/**
 * Converts a length in meters to pixels using a scale factor.
 * 
 * @param lengthInMeters - Length in meters
 * @param pixelsPerMeter - Scale factor (pixels per meter)
 * @returns Length in pixels
 */
export function metersToPixels(lengthInMeters: number, pixelsPerMeter: number): number {
  return lengthInMeters * pixelsPerMeter;
}

/**
 * Converts a length in pixels to meters using a scale factor.
 * 
 * @param lengthInPixels - Length in pixels
 * @param pixelsPerMeter - Scale factor (pixels per meter)
 * @returns Length in meters
 */
export function pixelsToMeters(lengthInPixels: number, pixelsPerMeter: number): number {
  return lengthInPixels / pixelsPerMeter;
}

/**
 * Calculates the distance between two points in pixels.
 * 
 * @param p1 - First point
 * @param p2 - Second point
 * @returns Distance in pixels
 */
export function distance(p1: Point, p2: Point): number {
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  return Math.sqrt(dx * dx + dy * dy);
}
