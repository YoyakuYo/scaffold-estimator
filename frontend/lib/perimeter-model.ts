/**
 * ═══════════════════════════════════════════════════════════
 * Perimeter Model — PURE DATA (NO Three.js)
 * ═══════════════════════════════════════════════════════════
 *
 * Stores ordered 2D points and segments forming a building
 * perimeter polygon. Provides functions to add/move/edit
 * points and segment dimensions.
 *
 * This file must NEVER import Three.js or any rendering library.
 */

export interface PerimeterPoint {
  x: number;
  y: number;
}

export interface PerimeterSegment {
  startIndex: number;
  endIndex: number;
  /** Calculated or manually overridden length (mm) */
  length: number;
  /** If true, length was manually set and won't auto-update on point move */
  manualLengthOverride: boolean;
  /** Direction angle in degrees */
  angle: number;
}

export type PerimeterChangeListener = () => void;

export class PerimeterModel {
  private _points: PerimeterPoint[] = [];
  private _segments: PerimeterSegment[] = [];
  private _isClosed: boolean = false;
  private _listeners: PerimeterChangeListener[] = [];

  // ── Getters ──────────────────────────────────────────────

  getPoints(): PerimeterPoint[] {
    return [...this._points];
  }

  getSegments(): PerimeterSegment[] {
    return [...this._segments];
  }

  getPoint(index: number): PerimeterPoint | null {
    return this._points[index] ? { ...this._points[index] } : null;
  }

  getSegment(index: number): PerimeterSegment | null {
    return this._segments[index] ? { ...this._segments[index] } : null;
  }

  get pointCount(): number {
    return this._points.length;
  }

  get segmentCount(): number {
    return this._segments.length;
  }

  get isClosed(): boolean {
    return this._isClosed;
  }

  // ── Mutation: Add point ──────────────────────────────────

  /**
   * Add a new point to the perimeter.
   * If there's a previous point, a segment is automatically created
   * connecting the previous point to this one.
   */
  addPoint(x: number, y: number): number {
    if (this._isClosed) {
      throw new Error('Cannot add points to a closed polygon. Reopen first.');
    }

    const index = this._points.length;
    this._points.push({ x, y });

    // Create segment from previous point to this one
    if (index > 0) {
      const prevIdx = index - 1;
      const length = this._distance(this._points[prevIdx], this._points[index]);
      const angle = this._angle(this._points[prevIdx], this._points[index]);

      this._segments.push({
        startIndex: prevIdx,
        endIndex: index,
        length,
        manualLengthOverride: false,
        angle,
      });
    }

    this._notify();
    return index;
  }

  // ── Mutation: Move point ─────────────────────────────────

  /**
   * Move a point to a new position.
   * Auto-recalculates lengths of connected segments
   * (unless they have manualLengthOverride = true).
   */
  movePoint(index: number, newX: number, newY: number): void {
    if (index < 0 || index >= this._points.length) {
      throw new Error(`Point index ${index} out of range`);
    }

    this._points[index] = { x: newX, y: newY };

    // Update all connected segments
    for (const seg of this._segments) {
      if (seg.startIndex === index || seg.endIndex === index) {
        const start = this._points[seg.startIndex];
        const end = this._points[seg.endIndex];
        seg.angle = this._angle(start, end);

        if (!seg.manualLengthOverride) {
          seg.length = this._distance(start, end);
        }
      }
    }

    this._notify();
  }

  // ── Mutation: Close polygon ──────────────────────────────

  /**
   * Close the polygon by connecting the last point to the first.
   * Requires at least 3 points.
   */
  closePolygon(): void {
    if (this._points.length < 3) {
      throw new Error('Need at least 3 points to close polygon');
    }
    if (this._isClosed) return;

    const lastIdx = this._points.length - 1;
    const firstIdx = 0;
    const length = this._distance(this._points[lastIdx], this._points[firstIdx]);
    const angle = this._angle(this._points[lastIdx], this._points[firstIdx]);

    this._segments.push({
      startIndex: lastIdx,
      endIndex: firstIdx,
      length,
      manualLengthOverride: false,
      angle,
    });

    this._isClosed = true;
    this._notify();
  }

  // ── Mutation: Update segment length ──────────────────────

  /**
   * Manually override a segment's length.
   * The endpoints are NOT moved — only the stored length value changes.
   * Sets manualLengthOverride = true so future point moves won't recalculate.
   */
  updateSegmentLength(index: number, newLengthMm: number): void {
    if (index < 0 || index >= this._segments.length) {
      throw new Error(`Segment index ${index} out of range`);
    }
    if (newLengthMm <= 0) {
      throw new Error('Segment length must be positive');
    }

    this._segments[index].length = newLengthMm;
    this._segments[index].manualLengthOverride = true;
    this._notify();
  }

  /**
   * Reset a segment to auto-calculate its length from endpoints.
   */
  resetSegmentLength(index: number): void {
    if (index < 0 || index >= this._segments.length) {
      throw new Error(`Segment index ${index} out of range`);
    }

    const seg = this._segments[index];
    seg.manualLengthOverride = false;
    seg.length = this._distance(
      this._points[seg.startIndex],
      this._points[seg.endIndex],
    );
    this._notify();
  }

  // ── Mutation: Remove last point ──────────────────────────

  /**
   * Remove the last added point (undo).
   */
  removeLastPoint(): void {
    if (this._points.length === 0) return;

    if (this._isClosed) {
      // Remove closing segment first
      this._segments.pop();
      this._isClosed = false;
    } else if (this._segments.length > 0) {
      this._segments.pop();
    }

    this._points.pop();
    this._notify();
  }

  // ── Mutation: Clear all ──────────────────────────────────

  /**
   * Clear all points and segments.
   */
  clear(): void {
    this._points = [];
    this._segments = [];
    this._isClosed = false;
    this._notify();
  }

  // ── Load from CAD data ───────────────────────────────────

  /**
   * Load wall segments from CAD processing pipeline result.
   * Automatically creates points and segments, and closes the polygon.
   */
  loadFromCadData(wallSegments: Array<{
    start: { x: number; y: number };
    end: { x: number; y: number };
    length: number;
    angle: number;
  }>): void {
    this.clear();

    if (wallSegments.length === 0) return;

    // Add points from segments (using start points)
    for (const seg of wallSegments) {
      this._points.push({ x: seg.start.x, y: seg.start.y });
    }

    // Create segments
    for (let i = 0; i < wallSegments.length; i++) {
      const nextIdx = (i + 1) % this._points.length;
      this._segments.push({
        startIndex: i,
        endIndex: nextIdx,
        length: wallSegments[i].length,
        manualLengthOverride: false,
        angle: wallSegments[i].angle,
      });
    }

    this._isClosed = true;
    this._notify();
  }

  /**
   * Load from simple point array (e.g., from outline detection).
   * Points should form a closed polygon.
   */
  loadFromPoints(points: Array<{ x: number; y: number }>): void {
    this.clear();

    if (points.length < 3) return;

    for (const pt of points) {
      this._points.push({ x: pt.x, y: pt.y });
    }

    // Create segments between consecutive points
    for (let i = 0; i < points.length; i++) {
      const nextIdx = (i + 1) % points.length;
      const length = this._distance(this._points[i], this._points[nextIdx]);
      const angle = this._angle(this._points[i], this._points[nextIdx]);

      this._segments.push({
        startIndex: i,
        endIndex: nextIdx,
        length,
        manualLengthOverride: false,
        angle,
      });
    }

    this._isClosed = true;
    this._notify();
  }

  // ── Computed properties ──────────────────────────────────

  /**
   * Get total perimeter length (sum of all segment lengths).
   */
  getPerimeter(): number {
    return this._segments.reduce((sum, seg) => sum + seg.length, 0);
  }

  /**
   * Get the bounding box of all points.
   */
  getBoundingBox(): { minX: number; minY: number; maxX: number; maxY: number } {
    if (this._points.length === 0) {
      return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
    }

    let minX = Infinity, minY = Infinity;
    let maxX = -Infinity, maxY = -Infinity;

    for (const pt of this._points) {
      minX = Math.min(minX, pt.x);
      minY = Math.min(minY, pt.y);
      maxX = Math.max(maxX, pt.x);
      maxY = Math.max(maxY, pt.y);
    }

    return { minX, minY, maxX, maxY };
  }

  /**
   * Get the center of the bounding box.
   */
  getCenter(): { x: number; y: number } {
    const bb = this.getBoundingBox();
    return {
      x: (bb.minX + bb.maxX) / 2,
      y: (bb.minY + bb.maxY) / 2,
    };
  }

  /**
   * Serialize the model for storage or transmission.
   */
  serialize(): {
    points: PerimeterPoint[];
    segments: PerimeterSegment[];
    isClosed: boolean;
  } {
    return {
      points: this.getPoints(),
      segments: this.getSegments(),
      isClosed: this._isClosed,
    };
  }

  /**
   * Deserialize and load from stored data.
   */
  deserialize(data: {
    points: PerimeterPoint[];
    segments: PerimeterSegment[];
    isClosed: boolean;
  }): void {
    this._points = [...data.points];
    this._segments = [...data.segments];
    this._isClosed = data.isClosed;
    this._notify();
  }

  // ── Change listeners ─────────────────────────────────────

  onChange(listener: PerimeterChangeListener): () => void {
    this._listeners.push(listener);
    return () => {
      this._listeners = this._listeners.filter(l => l !== listener);
    };
  }

  private _notify(): void {
    for (const listener of this._listeners) {
      try {
        listener();
      } catch {
        // Ignore listener errors
      }
    }
  }

  // ── Math helpers ─────────────────────────────────────────

  private _distance(a: PerimeterPoint, b: PerimeterPoint): number {
    return Math.hypot(b.x - a.x, b.y - a.y);
  }

  private _angle(a: PerimeterPoint, b: PerimeterPoint): number {
    let deg = Math.atan2(b.y - a.y, b.x - a.x) * (180 / Math.PI);
    if (deg < 0) deg += 360;
    return Math.round(deg * 100) / 100;
  }
}
