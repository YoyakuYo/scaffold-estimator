import { Point, Segment } from './types';
import { calculateEndpoint, metersToPixels } from './calculateEndpoint';
import { snapToAxis } from './snapToAxis';

/**
 * Recalculates a chain of segments starting from a modified segment.
 * When a segment's length is changed, all subsequent connected segments
 * must be recalculated to maintain the shape.
 * 
 * @param segments - Array of all segments
 * @param modifiedIndex - Index of the segment that was modified
 * @param newLength - New length in meters for the modified segment
 * @param pixelsPerMeter - Scale factor for conversion
 * @returns Updated array of segments with recalculated points
 */
export function recalculateChain(
  segments: Segment[],
  modifiedIndex: number,
  newLength: number,
  pixelsPerMeter: number
): { segments: Segment[]; points: Point[] } {
  if (segments.length === 0) {
    return { segments: [], points: [] };
  }

  // Create a copy of segments to avoid mutating the original
  const updatedSegments = [...segments];
  const updatedPoints: Point[] = [];

  // Rebuild points array from segments
  // First point is always the start of the first segment
  if (updatedSegments.length > 0) {
    updatedPoints.push({ ...updatedSegments[0].start });
  }

  // Process all segments in order, recalculating from the modified one
  for (let i = 0; i < updatedSegments.length; i++) {
    const segment = updatedSegments[i];
    
    // Determine the actual start point
    const actualStart = i === 0 
      ? segment.start 
      : updatedSegments[i - 1].end;

    // Determine the length to use
    const segmentLength = i === modifiedIndex ? newLength : segment.length;
    
    // Determine axis from the original segment direction (preserve direction)
    const originalEnd = segment.end;
    const axis = snapToAxis(actualStart, originalEnd);
    
    // Calculate direction based on original endpoint position
    let lengthInPixels = metersToPixels(segmentLength, pixelsPerMeter);
    if (axis === 'horizontal') {
      // If original end was to the left, make length negative
      if (originalEnd.x < actualStart.x) {
        lengthInPixels = -Math.abs(lengthInPixels);
      } else {
        lengthInPixels = Math.abs(lengthInPixels);
      }
    } else {
      // If original end was above, make length negative
      if (originalEnd.y < actualStart.y) {
        lengthInPixels = -Math.abs(lengthInPixels);
      } else {
        lengthInPixels = Math.abs(lengthInPixels);
      }
    }
    
    const newEnd = calculateEndpoint(actualStart, axis, lengthInPixels);

    updatedSegments[i] = {
      start: actualStart,
      end: newEnd,
      length: segmentLength,
    };

    // Update or add the endpoint to points array
    if (i + 1 < updatedPoints.length) {
      updatedPoints[i + 1] = newEnd;
    } else {
      updatedPoints.push(newEnd);
    }
  }

  return {
    segments: updatedSegments,
    points: updatedPoints,
  };
}
