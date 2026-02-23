import { Injectable, Logger } from '@nestjs/common';
import * as sharp from 'sharp';

/**
 * A single point on the building outline, expressed as a fraction (0-1)
 * of the original image width / height.
 */
export interface OutlinePoint {
  xFrac: number;
  yFrac: number;
}

/**
 * Automatically detects the building footprint from an architectural drawing
 * image and returns a simplified polygon.
 *
 * Algorithm:
 *   1. Resize to manageable work size
 *   2. Grayscale → threshold → binary wall mask
 *   3. Dilate to close small gaps in walls (doors/windows)
 *   4. Flood fill from image borders → mark exterior
 *   5. Everything NOT exterior = building footprint
 *   6. Keep only the largest connected component
 *   7. Fill interior holes
 *   8. Moore boundary tracing → raw contour
 *   9. Douglas-Peucker simplification → polygon
 *  10. Snap near-axis-aligned edges to true H/V
 *  11. Merge collinear edges
 */
@Injectable()
export class BuildingOutlineDetectorService {
  private readonly logger = new Logger(BuildingOutlineDetectorService.name);

  // ════════════════════════════════════════════════════════════════
  // PUBLIC API
  // ════════════════════════════════════════════════════════════════

  async detectOutline(filePath: string): Promise<OutlinePoint[] | null> {
    try {
      const WORK_SIZE = 500;
      const meta = await sharp(filePath).metadata();
      const origW = meta.width || 1;
      const origH = meta.height || 1;
      const scaleFactor = Math.min(1, WORK_SIZE / Math.max(origW, origH));
      const w = Math.max(10, Math.round(origW * scaleFactor));
      const h = Math.max(10, Math.round(origH * scaleFactor));

      this.logger.log(
        `Outline detection: orig=${origW}×${origH}, work=${w}×${h}`,
      );

      // ── 1. Grayscale raw pixels ──────────────────────────
      const grayBuf = await sharp(filePath)
        .resize(w, h, { fit: 'fill' })
        .grayscale()
        .raw()
        .toBuffer();

      // ── 2. Binary threshold ──────────────────────────────
      const WALL_THRESHOLD = 160;
      const wallMask = new Uint8Array(w * h);
      for (let i = 0; i < w * h; i++) {
        wallMask[i] = grayBuf[i] < WALL_THRESHOLD ? 1 : 0;
      }

      // ── 3. Dilate to close wall gaps ─────────────────────
      const dilated = this.dilate(wallMask, w, h, 4);

      // ── 4. Flood fill from borders → exterior ────────────
      const exterior = this.floodFillExterior(dilated, w, h);

      // ── 5. Building = NOT exterior ───────────────────────
      let building: Uint8Array = new Uint8Array(w * h);
      let buildingPx = 0;
      for (let i = 0; i < w * h; i++) {
        building[i] = exterior[i] ? 0 : 1;
        if (building[i]) buildingPx++;
      }

      const frac = buildingPx / (w * h);
      this.logger.log(
        `Building fraction: ${(frac * 100).toFixed(1)}% (${buildingPx}px)`,
      );

      if (frac < 0.02 || frac > 0.92) {
        this.logger.warn('Building fraction out of plausible range – skipping');
        return null;
      }

      // ── 6. Largest connected component ───────────────────
      building = this.keepLargestComponent(building, w, h) as Uint8Array;

      // ── 7. Fill interior holes ───────────────────────────
      building = this.fillHoles(building, w, h) as Uint8Array;

      // ── 8. Trace outer contour ───────────────────────────
      const contour = this.traceOuterContour(building, w, h);
      if (!contour || contour.length < 8) {
        this.logger.warn(`Contour too short: ${contour?.length ?? 0}`);
        return null;
      }
      this.logger.log(`Raw contour: ${contour.length} points`);

      // ── 9. Simplify ──────────────────────────────────────
      // VERY aggressive simplification - target 4-8 vertices for outer perimeter
      // Use 10% of image size to eliminate ALL interior details
      let epsilon = Math.max(15, Math.min(w, h) * 0.10);
      let simplified = this.douglasPeucker(contour, epsilon);
      this.logger.log(
        `Douglas-Peucker (first pass): ${simplified.length} pts (ε=${epsilon.toFixed(1)})`,
      );
      
      // If still too many points, simplify again with even larger epsilon
      if (simplified.length > 12) {
        epsilon = Math.max(20, Math.min(w, h) * 0.15);
        simplified = this.douglasPeucker(contour, epsilon);
        this.logger.log(
          `Douglas-Peucker (second pass): ${simplified.length} pts (ε=${epsilon.toFixed(1)})`,
        );
      }
      
      if (simplified.length < 3) return null;

      // ── 10. Snap to axes ─────────────────────────────────
      // Very aggressive axis snapping
      const snapThresh = Math.max(10, Math.min(w, h) * 0.08);
      simplified = this.snapToAxes(simplified, snapThresh);

      // ── 11. Remove duplicates + merge collinear ──────────
      simplified = this.removeDuplicates(simplified);
      simplified = this.mergeCollinear(simplified);
      
      // ── 12. Filter out very short edges (interior details) ──
      // Calculate edge lengths and remove edges that are too short
      const MIN_EDGE_LENGTH = Math.min(w, h) * 0.05; // 5% of image size (very aggressive)
      const filtered: { x: number; y: number }[] = [];
      for (let i = 0; i < simplified.length; i++) {
        const curr = simplified[i];
        const next = simplified[(i + 1) % simplified.length];
        const dx = next.x - curr.x;
        const dy = next.y - curr.y;
        const len = Math.sqrt(dx * dx + dy * dy);
        
        // Only keep edges that are long enough
        if (len >= MIN_EDGE_LENGTH) {
          // If this is the first point or different from last, add it
          if (filtered.length === 0 || 
              filtered[filtered.length - 1].x !== curr.x || 
              filtered[filtered.length - 1].y !== curr.y) {
            filtered.push(curr);
          }
        }
      }
      
      // Ensure we have at least 3 points
      if (filtered.length < 3) {
        this.logger.warn(`After filtering short edges, only ${filtered.length} points remain, using original`);
        simplified = this.removeDuplicates(simplified);
      } else {
        simplified = filtered;
      }
      
      // ── 13. Final aggressive merge of collinear edges ───────────────
      simplified = this.mergeCollinear(simplified);
      
      // ── 14. If still too many vertices, force simplification to bounding box ──
      // For rectangular buildings, we should have 4-8 vertices max
      if (simplified.length > 8) {
        this.logger.warn(`Still ${simplified.length} vertices after simplification, forcing to bounding box`);
        // Get bounding box
        const xs = simplified.map(p => p.x);
        const ys = simplified.map(p => p.y);
        const minX = Math.min(...xs);
        const maxX = Math.max(...xs);
        const minY = Math.min(...ys);
        const maxY = Math.max(...ys);
        // Create simple rectangle
        simplified = [
          { x: minX, y: minY },
          { x: maxX, y: minY },
          { x: maxX, y: maxY },
          { x: minX, y: maxY },
        ];
      }
      
      // ── 15. Final validation: ensure polygon is reasonable ──
      if (simplified.length < 3) return null;
      
      // Calculate polygon area to ensure it's not too small
      let area = 0;
      for (let i = 0; i < simplified.length; i++) {
        const j = (i + 1) % simplified.length;
        area += simplified[i].x * simplified[j].y;
        area -= simplified[j].x * simplified[i].y;
      }
      area = Math.abs(area) / 2;
      const minArea = (w * h) * 0.05; // At least 5% of image
      if (area < minArea) {
        this.logger.warn(`Polygon area too small: ${area.toFixed(0)} < ${minArea.toFixed(0)}, using bounding box`);
        const xs = simplified.map(p => p.x);
        const ys = simplified.map(p => p.y);
        const minX = Math.min(...xs);
        const maxX = Math.max(...xs);
        const minY = Math.min(...ys);
        const maxY = Math.max(...ys);
        simplified = [
          { x: minX, y: minY },
          { x: maxX, y: minY },
          { x: maxX, y: maxY },
          { x: minX, y: maxY },
        ];
      }

      this.logger.log(`Final polygon: ${simplified.length} vertices`);

      // Convert to fractional coordinates
      return simplified.map((p) => ({
        xFrac: p.x / w,
        yFrac: p.y / h,
      }));
    } catch (err) {
      this.logger.warn(`Outline detection failed: ${(err as Error).message}`);
      return null;
    }
  }

  // ════════════════════════════════════════════════════════════════
  // DILATION
  // ════════════════════════════════════════════════════════════════

  /**
   * Fast separable box dilation: O(w*h) per axis instead of O(w*h*r²).
   * First dilate horizontally, then vertically.
   */
  private dilate(
    mask: Uint8Array,
    w: number,
    h: number,
    radius: number,
  ): Uint8Array {
    // Horizontal pass
    const hPass = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {
      let count = 0;
      // Initialize window for first pixel
      for (let x = 0; x <= radius && x < w; x++) {
        if (mask[y * w + x]) count++;
      }
      if (count > 0) hPass[y * w] = 1;
      for (let x = 1; x < w; x++) {
        // Add right edge
        const addX = x + radius;
        if (addX < w && mask[y * w + addX]) count++;
        // Remove left edge
        const remX = x - radius - 1;
        if (remX >= 0 && mask[y * w + remX]) count--;
        if (count > 0) hPass[y * w + x] = 1;
      }
    }
    // Vertical pass on hPass result
    const out = new Uint8Array(w * h);
    for (let x = 0; x < w; x++) {
      let count = 0;
      for (let y = 0; y <= radius && y < h; y++) {
        if (hPass[y * w + x]) count++;
      }
      if (count > 0) out[x] = 1;
      for (let y = 1; y < h; y++) {
        const addY = y + radius;
        if (addY < h && hPass[addY * w + x]) count++;
        const remY = y - radius - 1;
        if (remY >= 0 && hPass[remY * w + x]) count--;
        if (count > 0) out[y * w + x] = 1;
      }
    }
    return out;
  }

  // ════════════════════════════════════════════════════════════════
  // FLOOD FILL FROM BORDERS
  // ════════════════════════════════════════════════════════════════

  private floodFillExterior(
    wallMask: Uint8Array,
    w: number,
    h: number,
  ): Uint8Array {
    const ext = new Uint8Array(w * h);
    const queue: number[] = [];

    // Seed all non-wall border pixels
    for (let x = 0; x < w; x++) {
      if (!wallMask[x] && !ext[x]) {
        ext[x] = 1;
        queue.push(x);
      }
      const bot = (h - 1) * w + x;
      if (!wallMask[bot] && !ext[bot]) {
        ext[bot] = 1;
        queue.push(bot);
      }
    }
    for (let y = 0; y < h; y++) {
      const left = y * w;
      if (!wallMask[left] && !ext[left]) {
        ext[left] = 1;
        queue.push(left);
      }
      const right = y * w + w - 1;
      if (!wallMask[right] && !ext[right]) {
        ext[right] = 1;
        queue.push(right);
      }
    }

    // BFS 4-connectivity
    const DX = [1, -1, 0, 0];
    const DY = [0, 0, 1, -1];
    let head = 0;
    while (head < queue.length) {
      const idx = queue[head++];
      const cy = (idx / w) | 0;
      const cx = idx % w;
      for (let d = 0; d < 4; d++) {
        const nx = cx + DX[d];
        const ny = cy + DY[d];
        if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue;
        const ni = ny * w + nx;
        if (ext[ni] || wallMask[ni]) continue;
        ext[ni] = 1;
        queue.push(ni);
      }
    }
    return ext;
  }

  // ════════════════════════════════════════════════════════════════
  // LARGEST CONNECTED COMPONENT
  // ════════════════════════════════════════════════════════════════

  private keepLargestComponent(
    mask: Uint8Array,
    w: number,
    h: number,
  ): Uint8Array {
    const labels = new Int32Array(w * h).fill(-1);
    let nextLabel = 0;
    const sizes: number[] = [];
    const DX = [1, -1, 0, 0];
    const DY = [0, 0, 1, -1];

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const idx = y * w + x;
        if (!mask[idx] || labels[idx] >= 0) continue;
        const label = nextLabel++;
        const q = [idx];
        labels[idx] = label;
        let sz = 0;
        let head = 0;
        while (head < q.length) {
          const ci = q[head++];
          sz++;
          const cy = (ci / w) | 0;
          const cx = ci % w;
          for (let d = 0; d < 4; d++) {
            const nx = cx + DX[d];
            const ny = cy + DY[d];
            if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue;
            const ni = ny * w + nx;
            if (!mask[ni] || labels[ni] >= 0) continue;
            labels[ni] = label;
            q.push(ni);
          }
        }
        sizes.push(sz);
      }
    }

    if (sizes.length === 0) return mask;
    let maxSz = 0;
    let maxLbl = 0;
    for (let i = 0; i < sizes.length; i++) {
      if (sizes[i] > maxSz) {
        maxSz = sizes[i];
        maxLbl = i;
      }
    }

    const out = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) {
      out[i] = labels[i] === maxLbl ? 1 : 0;
    }
    return out;
  }

  // ════════════════════════════════════════════════════════════════
  // FILL INTERIOR HOLES
  // ════════════════════════════════════════════════════════════════

  private fillHoles(building: Uint8Array, w: number, h: number): Uint8Array {
    // Flood fill the NON-building region from borders.
    // Any non-building pixel NOT reached = interior hole → fill it.
    const extNonBuilding = new Uint8Array(w * h);
    const queue: number[] = [];

    for (let x = 0; x < w; x++) {
      if (!building[x] && !extNonBuilding[x]) {
        extNonBuilding[x] = 1;
        queue.push(x);
      }
      const bot = (h - 1) * w + x;
      if (!building[bot] && !extNonBuilding[bot]) {
        extNonBuilding[bot] = 1;
        queue.push(bot);
      }
    }
    for (let y = 0; y < h; y++) {
      const left = y * w;
      if (!building[left] && !extNonBuilding[left]) {
        extNonBuilding[left] = 1;
        queue.push(left);
      }
      const right = y * w + w - 1;
      if (!building[right] && !extNonBuilding[right]) {
        extNonBuilding[right] = 1;
        queue.push(right);
      }
    }

    const DX = [1, -1, 0, 0];
    const DY = [0, 0, 1, -1];
    let head = 0;
    while (head < queue.length) {
      const idx = queue[head++];
      const cy = (idx / w) | 0;
      const cx = idx % w;
      for (let d = 0; d < 4; d++) {
        const nx = cx + DX[d];
        const ny = cy + DY[d];
        if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue;
        const ni = ny * w + nx;
        if (building[ni] || extNonBuilding[ni]) continue;
        extNonBuilding[ni] = 1;
        queue.push(ni);
      }
    }

    const out = new Uint8Array(building);
    for (let i = 0; i < w * h; i++) {
      if (!building[i] && !extNonBuilding[i]) {
        out[i] = 1; // fill hole
      }
    }
    return out;
  }

  // ════════════════════════════════════════════════════════════════
  // MOORE BOUNDARY TRACING
  // ════════════════════════════════════════════════════════════════

  private traceOuterContour(
    mask: Uint8Array,
    w: number,
    h: number,
  ): { x: number; y: number }[] | null {
    // Find topmost-leftmost building pixel
    let startX = -1;
    let startY = -1;
    outer: for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (mask[y * w + x]) {
          startX = x;
          startY = y;
          break outer;
        }
      }
    }
    if (startX < 0) return null;

    const isB = (x: number, y: number) =>
      x >= 0 && x < w && y >= 0 && y < h && mask[y * w + x] === 1;

    // 8-connected directions (CW): E SE S SW W NW N NE
    const DX = [1, 1, 0, -1, -1, -1, 0, 1];
    const DY = [0, 1, 1, 1, 0, -1, -1, -1];

    const contour: { x: number; y: number }[] = [];
    let cx = startX;
    let cy = startY;
    // The pixel to the left of start is not building (leftmost in row).
    let backDir = 4; // backtrack direction = West

    const maxIter = w * h * 2;
    for (let iter = 0; iter < maxIter; iter++) {
      contour.push({ x: cx, y: cy });

      // Search clockwise starting from (backDir + 1) % 8
      let found = false;
      for (let i = 0; i < 8; i++) {
        const d = (backDir + 1 + i) % 8;
        const nx = cx + DX[d];
        const ny = cy + DY[d];
        if (isB(nx, ny)) {
          cx = nx;
          cy = ny;
          backDir = (d + 4) % 8; // opposite
          found = true;
          break;
        }
      }
      if (!found) break;
      if (cx === startX && cy === startY) break;
    }

    return contour;
  }

  // ════════════════════════════════════════════════════════════════
  // DOUGLAS-PEUCKER SIMPLIFICATION
  // ════════════════════════════════════════════════════════════════

  private douglasPeucker(
    pts: { x: number; y: number }[],
    epsilon: number,
  ): { x: number; y: number }[] {
    if (pts.length <= 2) return pts;

    let maxDist = 0;
    let maxIdx = 0;
    const s = pts[0];
    const e = pts[pts.length - 1];

    for (let i = 1; i < pts.length - 1; i++) {
      const d = this.perpDist(pts[i], s, e);
      if (d > maxDist) {
        maxDist = d;
        maxIdx = i;
      }
    }

    if (maxDist > epsilon) {
      const left = this.douglasPeucker(pts.slice(0, maxIdx + 1), epsilon);
      const right = this.douglasPeucker(pts.slice(maxIdx), epsilon);
      return [...left.slice(0, -1), ...right];
    }
    return [s, e];
  }

  private perpDist(
    p: { x: number; y: number },
    a: { x: number; y: number },
    b: { x: number; y: number },
  ): number {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const lenSq = dx * dx + dy * dy;
    if (lenSq === 0) {
      const ex = p.x - a.x;
      const ey = p.y - a.y;
      return Math.sqrt(ex * ex + ey * ey);
    }
    return (
      Math.abs(dy * p.x - dx * p.y + b.x * a.y - b.y * a.x) /
      Math.sqrt(lenSq)
    );
  }

  // ════════════════════════════════════════════════════════════════
  // AXIS SNAPPING
  // ════════════════════════════════════════════════════════════════

  private snapToAxes(
    pts: { x: number; y: number }[],
    threshold: number,
  ): { x: number; y: number }[] {
    const out = pts.map((p) => ({ ...p }));
    for (let i = 0; i < out.length; i++) {
      const j = (i + 1) % out.length;
      const dx = Math.abs(out[j].x - out[i].x);
      const dy = Math.abs(out[j].y - out[i].y);
      const len = Math.sqrt(dx * dx + dy * dy);
      if (len < 2) continue;

      if (dy / len < 0.15 && dy < threshold) {
        const avg = Math.round((out[i].y + out[j].y) / 2);
        out[i].y = avg;
        out[j].y = avg;
      } else if (dx / len < 0.15 && dx < threshold) {
        const avg = Math.round((out[i].x + out[j].x) / 2);
        out[i].x = avg;
        out[j].x = avg;
      }
    }
    return out;
  }

  // ════════════════════════════════════════════════════════════════
  // REMOVE DUPLICATES
  // ════════════════════════════════════════════════════════════════

  private removeDuplicates(
    pts: { x: number; y: number }[],
  ): { x: number; y: number }[] {
    if (pts.length <= 1) return pts;
    const out = [pts[0]];
    for (let i = 1; i < pts.length; i++) {
      if (pts[i].x !== pts[i - 1].x || pts[i].y !== pts[i - 1].y) {
        out.push(pts[i]);
      }
    }
    if (
      out.length > 1 &&
      out[0].x === out[out.length - 1].x &&
      out[0].y === out[out.length - 1].y
    ) {
      out.pop();
    }
    return out;
  }

  // ════════════════════════════════════════════════════════════════
  // MERGE COLLINEAR EDGES
  // ════════════════════════════════════════════════════════════════

  private mergeCollinear(
    pts: { x: number; y: number }[],
  ): { x: number; y: number }[] {
    if (pts.length <= 3) return pts;
    const out = [pts[0]];
    // Very aggressive collinear merging - only keep points with significant angle changes
    // This helps eliminate interior details and keep only the outer perimeter
    const tolerance = 2.0; // Increased tolerance to merge more aggressively
    for (let i = 1; i < pts.length; i++) {
      const prev = out[out.length - 1];
      const curr = pts[i];
      const next = pts[(i + 1) % pts.length];
      
      // Calculate cross product to detect angle change
      const dx1 = curr.x - prev.x;
      const dy1 = curr.y - prev.y;
      const dx2 = next.x - curr.x;
      const dy2 = next.y - curr.y;
      const cross = dx1 * dy2 - dy1 * dx2;
      
      // Calculate edge lengths
      const len1 = Math.sqrt(dx1 * dx1 + dy1 * dy1);
      const len2 = Math.sqrt(dx2 * dx2 + dy2 * dy2);
      
      // Normalize cross product by edge lengths to get angle measure
      const normalizedCross = len1 > 0 && len2 > 0 ? Math.abs(cross) / (len1 * len2) : Math.abs(cross);
      
      // Only keep point if it creates a significant angle change (not collinear)
      // Use a threshold based on normalized cross product
      if (normalizedCross > 0.1 || Math.abs(cross) > tolerance) {
        out.push(curr);
      }
    }
    
    // Ensure we have at least 3 points
    if (out.length < 3 && pts.length >= 3) {
      // If we merged too aggressively, keep at least the first, middle, and last
      return [pts[0], pts[Math.floor(pts.length / 2)], pts[pts.length - 1]];
    }
    
    return out;
  }
}
