/**
 * Geometry types for building outline editor
 */

export interface Point {
  x: number;
  y: number;
}

export interface Segment {
  start: Point;
  end: Point;
  length: number; // in meters
}

export type Axis = 'horizontal' | 'vertical';
