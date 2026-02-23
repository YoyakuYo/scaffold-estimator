import { Point, Axis } from './types';

/**
 * Determines which axis (horizontal or vertical) a line segment should snap to
 * based on comparing dx and dy.
 * 
 * @param start - Starting point
 * @param end - Ending point
 * @returns 'horizontal' if |dx| > |dy|, 'vertical' otherwise
 */
export function snapToAxis(start: Point, end: Point): Axis {
  const dx = Math.abs(end.x - start.x);
  const dy = Math.abs(end.y - start.y);
  
  return dx > dy ? 'horizontal' : 'vertical';
}

/**
 * Snaps a point to the nearest axis relative to a reference point
 * 
 * @param reference - Reference point (usually the last confirmed point)
 * @param target - Target point to snap
 * @returns Snapped point (either same x or same y as reference)
 */
export function snapPointToAxis(reference: Point, target: Point): Point {
  const axis = snapToAxis(reference, target);
  
  if (axis === 'horizontal') {
    return { x: target.x, y: reference.y };
  } else {
    return { x: reference.x, y: target.y };
  }
}
