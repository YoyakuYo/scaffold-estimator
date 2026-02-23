'use client';

import { useRef, useEffect, useCallback } from 'react';
import { Point, Segment } from '@/lib/geometry/types';
import { distance } from '@/lib/geometry/calculateEndpoint';
import { snapPointToAxis } from '@/lib/geometry/snapToAxis';

interface CanvasLayerProps {
  width: number;
  height: number;
  points: Point[];
  segments: Segment[];
  currentPreviewPoint: Point | null;
  activeSegmentIndex: number | null;
  pixelsPerMeter: number;
  isShapeClosed?: boolean;
  onCanvasClick: (point: Point) => void;
  onMouseMove: (point: Point) => void;
  onSegmentClick: (index: number) => void;
}

const GRID_SIZE = 20;
const POINT_RADIUS = 5;
const POINT_COLOR = '#2563eb'; // blue-600
const SEGMENT_COLOR = '#000000'; // black
const SEGMENT_WIDTH = 2;
const CLOSED_SEGMENT_COLOR = '#16a34a'; // green-600
const PREVIEW_COLOR = '#94a3b8'; // slate-400
const PREVIEW_WIDTH = 1;
const ACTIVE_SEGMENT_COLOR = '#3b82f6'; // blue-500
const GRID_COLOR = '#e5e7eb'; // gray-200

export function CanvasLayer({
  width,
  height,
  points,
  segments,
  currentPreviewPoint,
  activeSegmentIndex,
  pixelsPerMeter,
  isShapeClosed = false,
  onCanvasClick,
  onMouseMove,
  onSegmentClick,
}: CanvasLayerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const isDrawingRef = useRef(false);

  // Draw grid background
  const drawGrid = useCallback((ctx: CanvasRenderingContext2D) => {
    ctx.strokeStyle = GRID_COLOR;
    ctx.lineWidth = 1;

    // Vertical lines
    for (let x = 0; x <= width; x += GRID_SIZE) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();
    }

    // Horizontal lines
    for (let y = 0; y <= height; y += GRID_SIZE) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
    }
  }, [width, height]);

  // Draw all confirmed segments
  const drawSegments = useCallback((ctx: CanvasRenderingContext2D) => {
    segments.forEach((segment, index) => {
      // Use green for closed shape, blue for active, black for normal
      if (isShapeClosed && index === segments.length - 1) {
        ctx.strokeStyle = index === activeSegmentIndex ? ACTIVE_SEGMENT_COLOR : CLOSED_SEGMENT_COLOR;
      } else {
        ctx.strokeStyle = index === activeSegmentIndex ? ACTIVE_SEGMENT_COLOR : SEGMENT_COLOR;
      }
      ctx.lineWidth = SEGMENT_WIDTH;
      ctx.setLineDash([]);

      ctx.beginPath();
      ctx.moveTo(segment.start.x, segment.start.y);
      ctx.lineTo(segment.end.x, segment.end.y);
      ctx.stroke();
    });
  }, [segments, activeSegmentIndex, isShapeClosed]);

  // Draw points
  const drawPoints = useCallback((ctx: CanvasRenderingContext2D) => {
    points.forEach((point) => {
      ctx.fillStyle = POINT_COLOR;
      ctx.beginPath();
      ctx.arc(point.x, point.y, POINT_RADIUS, 0, Math.PI * 2);
      ctx.fill();
    });
  }, [points]);

  // Draw preview line
  const drawPreview = useCallback((ctx: CanvasRenderingContext2D) => {
    if (!currentPreviewPoint || points.length === 0 || isShapeClosed) return;

    const lastPoint = points[points.length - 1];
    const snappedPoint = snapPointToAxis(lastPoint, currentPreviewPoint);

    ctx.strokeStyle = PREVIEW_COLOR;
    ctx.lineWidth = PREVIEW_WIDTH;
    ctx.setLineDash([5, 5]);

    ctx.beginPath();
    ctx.moveTo(lastPoint.x, lastPoint.y);
    ctx.lineTo(snappedPoint.x, snappedPoint.y);
    ctx.stroke();
  }, [currentPreviewPoint, points, isShapeClosed]);

  // Main draw function
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Clear canvas
    ctx.clearRect(0, 0, width, height);

    // Draw grid
    drawGrid(ctx);

    // Draw segments
    drawSegments(ctx);

    // Draw preview
    drawPreview(ctx);

    // Draw points
    drawPoints(ctx);
  }, [width, height, drawGrid, drawSegments, drawPreview, drawPoints]);

  // Redraw on changes
  useEffect(() => {
    draw();
  }, [draw]);

  // Get canvas coordinates from mouse event
  const getCanvasPoint = useCallback((e: React.MouseEvent<HTMLCanvasElement>): Point => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };

    const rect = canvas.getBoundingClientRect();
    return {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    };
  }, []);

  // Check if click is on a segment
  const getSegmentAtPoint = useCallback((point: Point): number | null => {
    const THRESHOLD = 5; // pixels

    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i];
      const dist = distanceToSegment(point, segment.start, segment.end);
      if (dist < THRESHOLD) {
        return i;
      }
    }

    return null;
  }, [segments]);

  // Distance from point to line segment
  const distanceToSegment = (point: Point, start: Point, end: Point): number => {
    const A = point.x - start.x;
    const B = point.y - start.y;
    const C = end.x - start.x;
    const D = end.y - start.y;

    const dot = A * C + B * D;
    const lenSq = C * C + D * D;
    let param = -1;

    if (lenSq !== 0) {
      param = dot / lenSq;
    }

    let xx: number, yy: number;

    if (param < 0) {
      xx = start.x;
      yy = start.y;
    } else if (param > 1) {
      xx = end.x;
      yy = end.y;
    } else {
      xx = start.x + param * C;
      yy = start.y + param * D;
    }

    const dx = point.x - xx;
    const dy = point.y - yy;
    return Math.sqrt(dx * dx + dy * dy);
  };

  const handleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const point = getCanvasPoint(e);
    
    // Check if clicking on a segment
    const segmentIndex = getSegmentAtPoint(point);
    if (segmentIndex !== null) {
      onSegmentClick(segmentIndex);
      return;
    }

    // Otherwise, add a new point
    if (points.length > 0) {
      const lastPoint = points[points.length - 1];
      const snappedPoint = snapPointToAxis(lastPoint, point);
      onCanvasClick(snappedPoint);
    } else {
      onCanvasClick(point);
    }
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const point = getCanvasPoint(e);
    onMouseMove(point);
  };

  return (
    <canvas
      ref={canvasRef}
      width={width}
      height={height}
      onClick={handleClick}
      onMouseMove={handleMouseMove}
      className="border border-gray-300 cursor-crosshair"
      style={{ background: 'white' }}
    />
  );
}
