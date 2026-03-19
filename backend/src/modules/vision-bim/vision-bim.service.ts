import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'crypto';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const DxfParser = require('dxf-parser');

/** Structured footprint output from vision or CAD (2D polygon + height). */
export interface VisionFootprintResult {
  /** Polygon vertices: in mm (x, z) or 0-1 fraction. Prefer mm for scaling. */
  vertices: Array<{ x: number; y: number } | { xFrac: number; yFrac: number }>;
  /** Building height in mm */
  buildingHeightMm: number;
  /** Ground line detected (optional) */
  groundLineY?: number;
  /** Eaves line / top (optional) */
  eavesLineY?: number;
  /** Confidence 0-1 */
  confidence?: number;
  /** Scale denominator from drawing (e.g. 100 for S=1/100). */
  scaleDenominator?: number;
  /** Per-edge lengths in mm, one per polygon edge (same order as vertices). Use dimension text from plan. */
  wallLengthsMm?: number[];
  /** Inferred scaffold type from plan: 枠組足場 (1829/914 etc.) vs くさび式 (600/900 etc.). */
  scaffoldTypeHint?: 'kusabi' | 'wakugumi';
  /** Span size in mm if visible (e.g. 1829 for wakugumi, 900 for kusabi). */
  spanSizeMm?: number;
  /** Frame size in mm for 枠組足場: 1700, 1800, or 1900. */
  frameSizeMm?: number;
  /** True when wallLengthsMm was read from plan dimension text (not estimated). */
  wallLengthsFromDimText?: boolean;
  /** Number of floors detected in the image (for height estimation from 3D views). */
  floorCount?: number;
  /** URL to the stored IFC file for frontend 3D rendering (set by controller after storage upload). */
  ifcFileUrl?: string;
  /**
   * Optional obstacles / special areas that affect scaffold layout (clearance, Buragetto).
   * Balconies and AC (outdoor unit) areas reduce clearance and may trigger single-pole + bracket layout.
   * Pillars (columns) near the perimeter trigger Single-Pole + Buragetto when scaffold path intersects.
   */
  obstacles?: Array<
    | {
        type: 'balcony' | 'ac';
        /** Polygon vertices in same coordinate system as vertices (mm or xFrac/yFrac). */
        vertices: Array<{ x: number; y: number } | { xFrac: number; yFrac: number }>;
      }
    | {
        type: 'pillar';
        /** Center in same coordinate system as vertices. */
        center: { x: number; y: number } | { xFrac: number; yFrac: number };
        /** Radius in mm (or fraction of ref length). */
        radiusMm: number;
      }
    | {
        type: 'door';
        /** Which wall edge index (0-based) the door is on. */
        wallIndex?: number;
        /** Position along the wall in mm from the wall start. */
        positionMm?: number;
        /** Door opening width in mm (default ~1800). */
        widthMm?: number;
      }
  >;
}

/** Supported CAD/plan extensions (lowercase). */
const CAD_EXTENSIONS = ['.dxf', '.dwg', '.jww'];
const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp'];
const PDF_EXTENSIONS = ['.pdf'];
const IFC_EXTENSIONS = ['.ifc'];

const VISION_SYSTEM_PROMPT = `You are a construction drawing analyst for Japanese scaffold estimation. Analyze the image (blueprint, plan, photo, or 3D BIM render) and extract the building exterior footprint, dimensions, and scaffold hints.

OUTPUT FORMAT: Output ONLY a raw JSON object. No markdown, no code fences, no prose before or after.

Required fields:
- vertices: array of polygon vertices tracing the EXTERIOR building wall outline AS SEEN FROM ABOVE (plan/top-down view) in perimeter order (clockwise or counter-clockwise).
  CONTOUR-FOLLOWING (critical): Trace the actual perimeter — do NOT use bounding boxes or convex hulls.
  Include INTERIOR VERTICES for L-shapes, notches, and indents: if a wall indents inward, add a vertex at that corner so the scaffold path follows the indent exactly.
  Each vertex: { x, y } in millimeters, or { xFrac, yFrac } for 0-1 normalized.
  UNITS: If the drawing shows a scale (S=1/100, S=1/200, 縮尺 etc.) you MUST output { x, y } in real mm. Never use fractions when scale is readable.
- buildingHeightMm: total building height in mm (ground to eaves/top). If not shown, use typical 3000mm per story.

Optional fields (read from dimension lines and annotations):
- scaleDenominator: scale from drawing (e.g. 100 for S=1/100, 200 for S=1/200).
- wallLengthsMm: array of lengths in mm, one per edge, same count as vertices.
  Edge i = vertex[i] → vertex[i+1]; last edge = last vertex → first vertex (closes polygon).
  Read dimension annotations: "2945", "10@1829=18290" means 18290mm.
  IMPORTANT: Always output in mm. If plan shows metres (e.g. "7.200 m") multiply by 1000. If centimetres (e.g. "720 cm") multiply by 10.
  Only omit if no dimension annotations are visible at all.
- wallLengthsFromDimText: true if wallLengthsMm was read from explicit dimension lines; false/omit if only estimated from proportions.
- scaffoldTypeHint: "wakugumi" for 枠組足場 or imperial spans (1829/914/1219/1524); "kusabi" for くさび式 or metric spans (600/900/1200/1500/1800). Omit if unclear.
- spanSizeMm: main span in mm if visible (1829, 914, 900, 1200, etc.).
- frameSizeMm: for 枠組足場 only — 1700, 1800, or 1900 if shown.
- groundLineY, eavesLineY: optional y coordinates if visible.
- confidence: 0-1.
- floorCount: number of visible floors/stories (count them). Use for height estimation when no explicit height is given.
- obstacles: optional array of special areas that affect scaffold clearance and layout.
  Balconies/AC: { "type": "balcony" | "ac", "vertices": [ { x, y } or { xFrac, yFrac } ] } — closed polygon in same units as vertices.
  Pillars/columns: { "type": "pillar", "center": { x, y } or { xFrac, yFrac }, "radiusMm": number } — circular or square columns near the perimeter.
  Doors/entrances: { "type": "door", "wallIndex": number, "positionMm": number, "widthMm": number } — ground-level openings that need a 梁枠 (beam frame / hariwaku) in the scaffold. wallIndex = which wall edge (0-based), positionMm = distance along that wall from start, widthMm = opening width (typically 1800-5500mm).
  When a scaffold path (600/900/1200mm from wall) would intersect a pillar, the system switches to Single-Pole + Buragetto (bracket) layout.
  Balconies: protruding floor areas. AC: outdoor unit areas. Pillars: 柱, コラム, circular or square structural columns at building corners or along walls. Doors: entrances, exits, loading bays, garage openings at ground level.
  Omit obstacles if none are clearly visible or labeled.

═══ 3D BIM RENDERS / ISOMETRIC / PERSPECTIVE VIEWS (CRITICAL) ═══
If the image is a 3D rendering, isometric view, perspective view, or BIM screenshot (e.g. from Revit, ArchiCAD, Tekla, SketchUp):
- You are seeing the building from an ANGLE, not from above. The visible outline in the image is a 2D projection of a 3D object — it is NOT the plan footprint.
- You MUST mentally "look down" from above and reconstruct the TOP-DOWN plan footprint of the building.
- DETECT COMPLEX SHAPES: Look carefully for L-shaped, U-shaped, or T-shaped buildings. In 3D views, these shapes have visible setbacks, wings, or recesses. Key indicators:
  * An L-shaped building has TWO WINGS meeting at a corner — one wing is shorter/narrower than the other. From above, this is 6 vertices.
  * A U-shaped building has a central courtyard or recess. From above, this is 8 vertices.
  * A T-shaped building has a protruding central section. From above, this is 8 vertices.
  * IMPORTANT: If you can see that one part of the building extends further than another in any direction, or there is a visible step/setback in the facade, it is NOT a simple rectangle. Output the correct number of vertices for the actual shape.
- For a rectangular building (all walls flush, no setbacks) seen in perspective/isometric: output 4 vertices forming a RECTANGLE.
- For an L-shaped building in 3D: output 6 vertices tracing the L from above. Estimate the wing proportions from the visible geometry.
- Use the visible proportions (width vs depth vs height) to estimate the plan shape.
- Count visible floors to estimate height: typical floor height is 3000–4000mm per story. If you see 3 floors, buildingHeightMm ≈ 9000–12000.
- Do NOT trace the perspective outline (silhouette) of the 3D view — that gives wrong shapes (hexagons, trapezoids). Reconstruct the PLAN footprint.
- When the building shape is unclear but is definitely not rectangular, output your best L/U/T approximation rather than defaulting to a rectangle.
- Set wallLengthsFromDimText: false and confidence: 0.5–0.7 (lower than for dimensioned plans).

Polygon rules — follow these exactly:
1. CLOSED polygon: the last edge must connect back to vertex[0]. Do NOT add a duplicate of vertex[0] at the end.
   The scaffold wraps the entire building without gaps — explicitly close the loop.

2. CONCAVE HULL (no bounding box): Trace the real perimeter. L-shaped buildings need 6 vertices (not 4).
   Interior corners (indents, notches) must each be a vertex. Never simplify to a rectangle if the plan shows an L, U, or stepped outline.

3. JAPANESE SCAFFOLD PLANS (仮設計画図) — blue lines:
   Japanese scaffold drawings use color coding that you must understand:
   - BLUE FILLED/HATCHED ZONE: this is the scaffold overhang area (the zone between the building wall and the outer scaffold edge). DO NOT trace its outer boundary.
   - BLUE PERIMETER LINE (the inner boundary of the blue zone, adjacent to the building): this IS the building wall face. TRACE THIS LINE as your polygon.
   - Confirm: the dimension strings on the plan (e.g. "10@1829=18290") should match the edges you are tracing. If a long dimension string aligns with your traced edge, you have the right line.
   For non-scaffold plans (architectural cross-sections, photos): trace the visible outer wall boundary.

4. SHAPE REALITY CHECK — Most buildings are elongated rectangles. If your polygon looks like a REGULAR PENTAGON or has roughly equal side lengths and equal angles, you almost certainly traced the wrong outline or traced a 3D silhouette instead of the plan footprint. Re-examine and extract the correct plan shape.

5. CURVED FACADES — If the plan shows ONE curved exterior wall (e.g. a long convex curve along the top): represent it with ONE or TWO straight segments connecting the same endpoints. Do NOT approximate the curve with many short segments; that creates a zigzag and wrong sharp angles. Output 4–6 vertices total: left, bottom, right, and the curved side as one or two segments (e.g. top-left and top-right). The result must look like an elongated rectangle with one gently bent side, not a narrow V or arrowhead.

6. Angled corners and cut corners must each be a separate vertex (do not simplify to a rectangle if the plan shows a notch or diagonal).

7. Vertex order: clockwise or counter-clockwise — be consistent around the whole perimeter.

8. wallLengthsMm count must equal vertices count exactly (one length per edge). Use dimension strings (e.g. 11'-6", 3500) to set a single global scale for both X and Y axes so the 3D model proportions match real-world measurements.

9. ORTHOGONAL: For walls intended to be perpendicular, vertices should form 90° angles — avoid "squashed" or narrow looks.

CRITICAL — structural grid vs. building edge (most common error):
Construction plans show internal structural grids (e.g. Y1/Y2/Y3/Y4/Y5 lines spaced 7200 mm, X1/X2 lines, column circles). These are NOT building edges.
- NEVER place an extra vertex where a grid line crosses an exterior wall. A straight or diagonal exterior wall is ONE edge (2 vertices: start and end), even if 4 grid lines cross it.
- NEVER trace a diagonal edge as a staircase of alternating horizontal/vertical steps. A slanted wall = one straight edge.
- WARNING SIGN: if you have 3 or more consecutive edges with the same length (e.g. four × 7200 mm in a row), you are following a grid, not the building perimeter. Replace those segments with the single outer wall they belong to.
- Typical buildings have 4–8 vertices. Complex multi-wing buildings (hospitals, schools, offices) may have 10–16 vertices. More than 20 almost always means grid-line tracing errors — review and remove spurious vertices before outputting.
- MULTI-WING BUILDINGS: Large institutional/commercial buildings often have multiple connected wings forming complex shapes. Trace the OUTER perimeter of the entire connected structure as ONE polygon. Each wing junction creates 2+ vertices. Common patterns: H-shape (12 vertices), E-shape (12 vertices), courtyard buildings (8+ vertices).

Self-check before outputting (fix issues silently — never output the check itself):
- edges count == vertices count (not vertices count + 1)
- no duplicate consecutive vertices
- no self-intersecting edges
- if wallLengthsMm provided: sum of lengths is a plausible building perimeter (>4 m, <2000 m)
- total of wallLengthsMm matches the plan's dimension string sums as closely as possible
- no run of 3+ consecutive edges with the same length unless the building genuinely has those equal-length faces
- polygon must NOT be a regular polygon (equal sides + equal angles) unless the building genuinely is one
- if the image is a 3D view: your polygon should be a plan-view shape (rectangle, L, U), NOT a silhouette/trapezoid
- if the image is a 3D view and the building has visible setbacks, wings, or L/U/T shape: you MUST output 6+ vertices (NOT 4). Outputting a rectangle for a non-rectangular building is the #1 most common error.

If the drawing has a scale (S=1/100, S=1/200), set scaleDenominator and output vertices in real mm.
If scale is unknown, use xFrac/yFrac for shape.`;

@Injectable()
export class VisionBimService {
  private readonly logger = new Logger(VisionBimService.name);
  private static readonly imageCache = new Map<
    string,
    { savedAtMs: number; result: VisionFootprintResult }
  >();

  constructor(private readonly config: ConfigService) {}

  /**
   * Process uploaded file: image → Claude Vision; DXF/CAD → parse outline; PDF → fallback or future PDF-to-image.
   * Filename is used for type detection when magic bytes are ambiguous.
   */
  async processFile(buffer: Buffer, filename?: string): Promise<VisionFootprintResult> {
    const ext = filename ? (filename.includes('.') ? '.' + filename.split('.').pop()!.toLowerCase() : '') : '';
    const isDxfBuffer = this.looksLikeDxf(buffer);
    const isDxf = CAD_EXTENSIONS.includes(ext) || isDxfBuffer;
    const isPdf = PDF_EXTENSIONS.includes(ext) || (buffer[0] === 0x25 && buffer[1] === 0x50 && buffer[2] === 0x44);
    const isImage = IMAGE_EXTENSIONS.includes(ext) || this.looksLikeImage(buffer);

    if (ext === '.dwg' || ext === '.jww') {
      if (!isDxfBuffer) {
        throw new Error(
          'DWG/JWW はサーバーで直接解析できません。CADで DXF 形式にエクスポートしてからアップロードしてください。 / ' +
          'Please export the file as DXF from your CAD software and upload the DXF file.',
        );
      }
    }
    if (isDxf) {
      return this.processDxf(buffer);
    }
    const isIfc = IFC_EXTENSIONS.includes(ext) || this.looksLikeIfc(buffer);
    if (isIfc) {
      return this.processIfc(buffer);
    }
    if (isPdf) {
      this.logger.log('PDF upload: export as PNG/JPEG for vision analysis, or upload DXF for CAD plans');
      return this.getFallbackFootprint();
    }
    if (isImage) {
      return this.processImage(buffer);
    }
    this.logger.warn('Unknown file type; trying as image');
    return this.processImage(buffer);
  }

  private looksLikeDxf(buffer: Buffer): boolean {
    if (buffer.length < 20) return false;
    const head = buffer.slice(0, 200).toString('utf8');
    return head.includes('ENTITIES') || /^\s*0\s*\n/.test(head) || head.includes('  0\n');
  }

  private looksLikeImage(buffer: Buffer): boolean {
    if (buffer.length < 4) return false;
    if (buffer[0] === 0xff && buffer[1] === 0xd8) return true;
    if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e) return true;
    if (buffer.length >= 12 && buffer.slice(0, 4).toString('ascii') === 'RIFF' && buffer.slice(8, 12).toString('ascii') === 'WEBP') return true;
    if (buffer.length >= 4 && buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46) return true;
    return false;
  }

  private detectImageMediaType(buffer: Buffer): 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif' {
    if (buffer[0] === 0xff && buffer[1] === 0xd8) return 'image/jpeg';
    if (buffer.length >= 12 && buffer.slice(0, 4).toString('ascii') === 'RIFF' && buffer.slice(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
    if (buffer.length >= 4 && buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46) return 'image/gif';
    return 'image/png';
  }

  private looksLikeIfc(buffer: Buffer): boolean {
    if (buffer.length < 20) return false;
    const head = buffer.slice(0, 100).toString('utf8');
    return head.includes('ISO-10303-21') || head.includes('HEADER;');
  }

  /**
   * Parse DXF buffer and extract building footprint (closed polyline or bounding outline) and height.
   */
  async processDxf(buffer: Buffer): Promise<VisionFootprintResult> {
    try {
      const text = buffer.toString('utf-8');
      const parser = new DxfParser();
      const dxf = parser.parse(text);
      if (!dxf || !dxf.entities) {
        this.logger.warn('DXF parse returned no entities');
        return this.getFallbackFootprint();
      }
      const unit = this.detectDxfUnit(dxf);
      const scaleToMm = unit === 'm' ? 1000 : unit === 'cm' ? 10 : 1;
      let bestVertices: Array<{ x: number; y: number }> = [];
      let bestArea = 0;
      let buildingHeightMm = 3000;
      const dimensions: Array<{ value: number; vertical: boolean }> = [];

      for (const entity of dxf.entities) {
        if (entity.type === 'LWPOLYLINE' || entity.type === 'POLYLINE') {
          const pts = (entity.vertices || entity.points || []).map((v: any) => ({
            x: (v.x ?? v[0] ?? 0) * scaleToMm,
            y: (v.y ?? v[1] ?? 0) * scaleToMm,
          }));
          const closed = entity.shape === true || (entity as any).closed === true || (entity as any).closed === 1;
          if (pts.length >= 3 && closed) {
            const area = Math.abs(this.polygonArea(pts));
            if (area > bestArea) {
              bestArea = area;
              bestVertices = pts;
            }
          }
        }
        if (entity.type === 'DIMENSION' && (entity as any).measurement != null) {
          const dim = entity as any;
          const vertical = Math.abs((dim.end?.y ?? 0) - (dim.start?.y ?? 0)) > Math.abs((dim.end?.x ?? 0) - (dim.start?.x ?? 0));
          dimensions.push({ value: dim.measurement * scaleToMm, vertical });
        }
      }
      const maxVerticalDim = dimensions.filter((d) => d.vertical).map((d) => d.value).reduce((a, b) => Math.max(a, b), 0);
      if (maxVerticalDim > 500) buildingHeightMm = Math.round(maxVerticalDim);

      let vertices = bestVertices;
      if (vertices.length < 3) {
        // Try LINE-based polygon detection (concave hull) instead of bounding box
        const linePoly = this.detectPolygonFromLines(dxf.entities, scaleToMm);
        if (linePoly.length >= 3) {
          vertices = linePoly;
          this.logger.log(`DXF: extracted polygon from ${linePoly.length} LINE segments (no LWPOLYLINE)`);
        } else {
          // Fallback: bounding box only when LINE-based detection fails
          let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
          for (const e of dxf.entities) {
            if (e.type === 'LINE' && e.start && e.end) {
              const s = e.start as { x: number; y: number };
              const en = e.end as { x: number; y: number };
              minX = Math.min(minX, s.x, en.x); maxX = Math.max(maxX, s.x, en.x);
              minY = Math.min(minY, s.y, en.y); maxY = Math.max(maxY, s.y, en.y);
            }
          }
          if (minX !== Infinity && maxX - minX > 100 && maxY - minY > 100) {
            vertices = [
              { x: minX * scaleToMm, y: minY * scaleToMm },
              { x: maxX * scaleToMm, y: minY * scaleToMm },
              { x: maxX * scaleToMm, y: maxY * scaleToMm },
              { x: minX * scaleToMm, y: maxY * scaleToMm },
            ];
          }
        }
      }

      // Extract CIRCLE entities as pillar obstacles (near perimeter)
      const pillars = this.extractPillarsFromDxf(dxf.entities, vertices, scaleToMm);
      const obstacles =
        pillars.length > 0
          ? pillars.map((p) => ({ type: 'pillar' as const, center: p.center, radiusMm: p.radiusMm }))
          : undefined;

      return { vertices, buildingHeightMm, confidence: 0.8, ...(obstacles && { obstacles }) };
    } catch (err) {
      this.logger.error('DXF processing failed', (err as Error)?.message);
      return this.getFallbackFootprint();
    }
  }

  /**
   * Build closed polygon from LINE entities (concave hull).
   * Uses adjacency + loop walking; selects largest-area loop.
   * Avoids bounding box when a real perimeter can be traced.
   */
  private detectPolygonFromLines(
    entities: any[],
    scaleToMm: number,
  ): Array<{ x: number; y: number }> {
    const segments: Array<{ x1: number; y1: number; x2: number; y2: number }> = [];
    for (const e of entities) {
      if (e.type === 'LINE' && e.start && e.end) {
        const s = e.start as { x: number; y: number };
        const en = e.end as { x: number; y: number };
        segments.push({
          x1: s.x * scaleToMm,
          y1: s.y * scaleToMm,
          x2: en.x * scaleToMm,
          y2: en.y * scaleToMm,
        });
      }
    }
    if (segments.length < 3) return [];

    const snap = 5;
    const key = (x: number, y: number) =>
      `${Math.round(x / snap) * snap},${Math.round(y / snap) * snap}`;
    const adj = new Map<string, string[]>();
    const add = (a: string, b: string) => {
      if (a === b) return;
      if (!adj.has(a)) adj.set(a, []);
      if (!adj.get(a)!.includes(b)) adj.get(a)!.push(b);
    };
    for (const seg of segments) {
      const k1 = key(seg.x1, seg.y1);
      const k2 = key(seg.x2, seg.y2);
      add(k1, k2);
      add(k2, k1);
    }

    const polygons: Array<{ points: Array<{ x: number; y: number }>; area: number }> = [];

    const walkLoop = (start: string): string[] | null => {
      const path: string[] = [start];
      let cur = start;
      const maxSteps = adj.size + 5;
      for (let step = 0; step < maxSteps; step++) {
        const nexts = adj.get(cur) ?? [];
        let found = false;
        for (const n of nexts) {
          if (n === start && path.length >= 3) return path;
          if (!path.includes(n)) {
            path.push(n);
            cur = n;
            found = true;
            break;
          }
        }
        if (!found) return null;
      }
      return null;
    };

    for (const [node] of adj) {
      const loop = walkLoop(node);
      if (loop && loop.length >= 3) {
        const pts = loop.map((k) => {
          const [x, y] = k.split(',').map(Number);
          return { x, y };
        });
        const area = Math.abs(this.polygonArea(pts));
        if (area > 1) polygons.push({ points: pts, area });
      }
    }

    if (polygons.length === 0) return [];
    polygons.sort((a, b) => b.area - a.area);
    return polygons[0].points;
  }

  /**
   * Extract CIRCLE entities near the building perimeter as pillar obstacles.
   */
  private extractPillarsFromDxf(
    entities: any[],
    vertices: Array<{ x: number; y: number }>,
    scaleToMm: number,
  ): Array<{ center: { x: number; y: number }; radiusMm: number }> {
    const pillars: Array<{ center: { x: number; y: number }; radiusMm: number }> = [];
    const n = vertices.length;
    const perimeter = vertices.reduce((sum, p, i) => {
      const next = vertices[(i + 1) % n];
      return sum + Math.hypot(next.x - p.x, next.y - p.y);
    }, 0);
    const nearDist = Math.min(perimeter * 0.1, 2000);

    for (const e of entities) {
      if (e.type === 'CIRCLE' && e.center != null) {
        const c = e.center as { x: number; y: number };
        const r = (e.radius ?? 0) * scaleToMm;
        const cx = c.x * scaleToMm;
        const cy = c.y * scaleToMm;
        const distToPerimeter = vertices.reduce((min, p, i) => {
          const next = vertices[(i + 1) % n];
          const d = this.pointToSegmentDist(cx, cy, p.x, p.y, next.x, next.y);
          return Math.min(min, d);
        }, Infinity);
        if (distToPerimeter <= nearDist && r > 50 && r < 2000) {
          pillars.push({ center: { x: cx, y: cy }, radiusMm: Math.round(r) });
        }
      }
    }
    return pillars;
  }

  private pointToSegmentDist(
    px: number,
    py: number,
    x1: number,
    y1: number,
    x2: number,
    y2: number,
  ): number {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const len = Math.hypot(dx, dy);
    if (len < 1e-9) return Math.hypot(px - x1, py - y1);
    const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / (len * len)));
    const projX = x1 + t * dx;
    const projY = y1 + t * dy;
    return Math.hypot(px - projX, py - projY);
  }

  private polygonArea(pts: Array<{ x: number; y: number }>): number {
    let area = 0;
    const n = pts.length;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      area += pts[i].x * pts[j].y - pts[j].x * pts[i].y;
    }
    return area / 2;
  }

  private detectDxfUnit(dxf: any): 'mm' | 'cm' | 'm' {
    const insunits = dxf?.header?.$INSUNITS ?? dxf?.header?.headerVars?.$INSUNITS;
    if (insunits === 4) return 'mm';
    if (insunits === 5) return 'cm';
    if (insunits === 6) return 'm';
    const measurement = dxf?.header?.$MEASUREMENT ?? dxf?.header?.headerVars?.$MEASUREMENT;
    return measurement === 0 ? 'mm' : 'cm';
  }

  /**
   * Process an image buffer (photo or blueprint) with Claude 3.5 Sonnet Vision.
   * Returns structured footprint JSON for the BuildingGraph / scaffold estimator.
   */
  async processImage(buffer: Buffer): Promise<VisionFootprintResult> {
    const apiKey = this.config.get<string>('ANTHROPIC_API_KEY');
    if (!apiKey) {
      throw new Error('ANTHROPIC_API_KEY is not set (AI BIM vision analysis is unavailable)');
    }

    try {
      // Determinism + repeatability: cache by file hash so re-uploading the same plan
      // returns the same extracted footprint (within this server process lifetime).
      const cacheTtlMs = 1000 * 60 * 60; // 1 hour
      const modelForKey =
        this.config.get<string>('ANTHROPIC_VISION_MODEL') || 'claude-sonnet-4-6';
      const hash = createHash('sha256').update(buffer).digest('hex');
      const cacheKey = `vision-bim:v1:${modelForKey}:${hash}`;
      const cached = VisionBimService.imageCache.get(cacheKey);
      if (cached && Date.now() - cached.savedAtMs < cacheTtlMs) {
        this.logger.log(`Vision BIM cache hit: ${hash.slice(0, 12)}`);
        return cached.result;
      }

      const Anthropic = await import('@anthropic-ai/sdk');
      const client = new Anthropic.default({ apiKey });

      const base64 = buffer.toString('base64');
      const mediaType = this.detectImageMediaType(buffer);

      // Use env override or a current vision-capable model (claude-3-5-sonnet-20241022 was retired)
      const model =
        this.config.get<string>('ANTHROPIC_VISION_MODEL') ||
        'claude-sonnet-4-6';
      const message = await client.messages.create({
        model,
        max_tokens: 2048,
        // Reduce randomness to avoid shape changes between identical uploads
        // (Anthropic supports temperature on messages.create).
        temperature: 0,
        system: VISION_SYSTEM_PROMPT,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'image',
                source: {
                  type: 'base64',
                  media_type: mediaType,
                  data: base64,
                },
              },
              {
                type: 'text',
                text: 'Extract the exterior building footprint as a CLOSED polygon (last edge returns to vertex[0], no duplicate closing vertex). CONTOUR-FOLLOW: trace the real perimeter including L-shapes and indents — do NOT use bounding box or convex hull. IMPORTANT: If this is a 3D rendering, isometric, or perspective BIM view (e.g. Revit screenshot), do NOT trace the visible silhouette. Instead reconstruct the TOP-DOWN PLAN footprint. CRITICAL SHAPE DETECTION: Look for L-shaped (6 vertices), U-shaped (8 vertices), or T-shaped (8 vertices) buildings — visible setbacks, wings, or recesses mean it is NOT a simple rectangle. An L-shaped building in 3D shows two wings of different length/width meeting at a corner. Output the correct polygon shape (L=6 vertices, U=8, T=8, rectangle=4). Count floors and estimate height as floors × 3000–4000mm. Return raw JSON only (no markdown). Include: vertices, buildingHeightMm, floorCount, and if visible: scaleDenominator, wallLengthsMm (one mm value per edge, same count as vertices), wallLengthsFromDimText, scaffoldTypeHint, spanSizeMm, frameSizeMm. If the plan shows balconies, AC areas, pillars/columns (柱, コラム), or doors/entrances (ドア, 入口, 出入口), add obstacles: type "balcony"/"ac" with vertices, type "pillar" with center and radiusMm, or type "door" with wallIndex, positionMm, and widthMm.',
              },
            ],
          },
        ],
      });

      const textBlock = message.content.find((b: any) => b.type === 'text');
      const text =
        textBlock && typeof (textBlock as any).text === 'string'
          ? (textBlock as any).text
          : '';

      // Robust JSON extraction: take only the first complete {...} object (ignore trailing text or second JSON).
      const cleaned = text.replace(/```json?\s*/gi, '').replace(/```/g, '').trim();
      const start = cleaned.indexOf('{');
      if (start < 0) throw new Error('Vision model did not return JSON');
      let depth = 0;
      let end = -1;
      let i = start;
      while (i < cleaned.length) {
        const c = cleaned[i];
        if (c === '"' && depth > 0) {
          i++;
          while (i < cleaned.length) {
            if (cleaned[i] === '\\') i += 2;
            else if (cleaned[i] === '"') break;
            else i++;
          }
          i++;
          continue;
        }
        if (c === '{') depth++;
        else if (c === '}') {
          depth--;
          if (depth === 0) {
            end = i;
            break;
          }
        }
        i++;
      }
      if (end < start) throw new Error('Vision model did not return valid JSON object');
      const jsonStr = cleaned.slice(start, end + 1);
      const parsed = JSON.parse(jsonStr) as VisionFootprintResult;

      this.logger.log(
        `Vision BIM raw response: ${parsed.vertices?.length ?? 0} vertices, ` +
        `height=${parsed.buildingHeightMm}mm, wallLengths=${JSON.stringify(parsed.wallLengthsMm ?? 'none')}`,
      );

      if (!parsed.vertices || !Array.isArray(parsed.vertices) || parsed.vertices.length < 3) {
        throw new Error('Vision returned invalid footprint vertices');
      }
      if (!parsed.buildingHeightMm || parsed.buildingHeightMm < 1000) {
        const floors = typeof (parsed as any).floorCount === 'number' && (parsed as any).floorCount >= 1
          ? (parsed as any).floorCount
          : 1;
        parsed.buildingHeightMm = floors * 3000;
      }
      if (typeof (parsed as any).floorCount === 'number' && (parsed as any).floorCount >= 1) {
        parsed.floorCount = (parsed as any).floorCount;
      }
      const n = parsed.vertices.length;
      let wallLengths = Array.isArray(parsed.wallLengthsMm) && parsed.wallLengthsMm.length === n
        ? parsed.wallLengthsMm as number[]
        : undefined;

      if (wallLengths) {
        const maxVal = Math.max(...wallLengths);
        // If all values look like metres (max < 100), auto-convert to mm
        if (maxVal < 100 && wallLengths.every((l) => typeof l === 'number' && l > 0)) {
          wallLengths = wallLengths.map((l) => Math.round(l * 1000));
          this.logger.warn(`wallLengthsMm auto-converted from m→mm (max was ${maxVal})`);
        }
        // Fix 1: one value 3xxx (e.g. 3593) when dimension was 33.593 m – even if another small (e.g. 1733) exists
        const threeK = wallLengths.filter((l) => typeof l === 'number' && l >= 3000 && l < 4000);
        const hasLarge = wallLengths.some((l) => typeof l === 'number' && l >= 10000);
        if (threeK.length === 1 && hasLarge) {
          wallLengths = wallLengths.map((l) =>
            typeof l === 'number' && l >= 3000 && l < 4000 ? l + 30000 : l,
          ) as number[];
          this.logger.warn('wallLengthsMm: corrected one value 3xxx→33xxx (leading digit dropped)');
        }
        // Fix 2: one value 1xxx–5xxx and all others >= 10000
        const small = wallLengths.filter((l) => typeof l === 'number' && l >= 1000 && l < 6000);
        const large = wallLengths.filter((l) => typeof l === 'number' && l >= 10000);
        if (small.length === 1 && large.length === wallLengths.length - 1) {
          wallLengths = wallLengths.map((l) =>
            typeof l === 'number' && l >= 1000 && l < 6000 ? l + 30000 : l,
          ) as number[];
          this.logger.warn(
            'wallLengthsMm: corrected one value 1xxx/4xxx→31xxx/34xxx (leading digit dropped)',
          );
        }
        // Discard if any value is still below minimum scaffold wall (600mm)
        if (!wallLengths.every((l) => typeof l === 'number' && l >= 600)) {
          wallLengths = undefined;
        }
      }
      parsed.wallLengthsMm = wallLengths;
      parsed.wallLengthsFromDimText = wallLengths != null
        ? (parsed.wallLengthsFromDimText === true)
        : undefined;
      if (parsed.scaffoldTypeHint !== 'kusabi' && parsed.scaffoldTypeHint !== 'wakugumi') {
        parsed.scaffoldTypeHint = undefined;
      }
      if (typeof parsed.frameSizeMm !== 'number' || ![1700, 1800, 1900].includes(parsed.frameSizeMm)) {
        parsed.frameSizeMm = undefined;
      }
      // Normalize optional obstacles (balcony / AC areas / pillars / doors)
      if (Array.isArray(parsed.obstacles) && parsed.obstacles.length > 0) {
        parsed.obstacles = parsed.obstacles
          .filter(
            (o: any) =>
              o &&
              (((o.type === 'balcony' || o.type === 'ac') && Array.isArray(o.vertices) && o.vertices.length >= 3) ||
                (o.type === 'pillar' && o.center && typeof o.radiusMm === 'number' && o.radiusMm > 0) ||
                (o.type === 'door')),
          )
          .map((o: any) => {
            if (o.type === 'pillar') {
              return { type: 'pillar' as const, center: o.center, radiusMm: o.radiusMm };
            }
            if (o.type === 'door') {
              return {
                type: 'door' as const,
                wallIndex: typeof o.wallIndex === 'number' ? o.wallIndex : undefined,
                positionMm: typeof o.positionMm === 'number' ? o.positionMm : undefined,
                widthMm: typeof o.widthMm === 'number' && o.widthMm > 0 ? o.widthMm : 1800,
              };
            }
            return {
              type: o.type as 'balcony' | 'ac',
              vertices: o.vertices as Array<{ x: number; y: number } | { xFrac: number; yFrac: number }>,
            };
          });
        if ((parsed.obstacles as any[]).length === 0) parsed.obstacles = undefined;
      } else {
        parsed.obstacles = undefined;
      }
      // Remove collinear intermediate vertices caused by grid-line tracing.
      this.cleanupPolygon(parsed);
      // Save to cache after successful parse/cleanup.
      VisionBimService.imageCache.set(cacheKey, {
        savedAtMs: Date.now(),
        result: parsed as VisionFootprintResult,
      });
      return parsed as VisionFootprintResult;
    } catch (err) {
      const msg = (err as Error)?.message || String(err);
      this.logger.error('Vision BIM processing failed', msg);
      throw new Error(`Vision BIM processing failed: ${msg}`);
    }
  }

  /**
   * Post-process extracted polygon to remove collinear intermediate vertices.
   *
   * The most common AI error on technical plans is placing a vertex at every
   * structural-grid crossing along a straight or diagonal wall edge, producing
   * runs of 3-6 identical-length edges where one edge should be.
   *
   * Algorithm (iterative until stable):
   *  1. Remove duplicate consecutive vertices.
   *  2. Remove any vertex B where the turn angle A→B→C is ≤ SIN_THR (≈12°),
   *     i.e. B lies essentially on the straight line from A to C.
   *  3. After simplification, recompute wallLengthsMm from the new geometry
   *     (valid for mm-coordinate vertices; for fractional, clear it so the
   *     engine falls back to vertex-distance-derived lengths).
   */
  private cleanupPolygon(parsed: VisionFootprintResult): void {
    const verts = parsed.vertices;
    if (!Array.isArray(verts) || verts.length < 5) return;

    // Conservative: preserve intentional shape vertices.
    // L/U/T shapes have 6-8 vertices; multi-wing buildings may have 10-16.
    // Grid-tracing artifacts produce runs of 3+ equal-length edges on a straight wall.
    // Only simplify when there are clearly too many vertices (>= 8 original).
    const minVertices = Math.max(4, Math.min(verts.length - 2, 12));

    const isMm = 'x' in verts[0];

    // Normalise to {x, y} in whatever unit the AI used (mm or 0-1 fraction).
    let pts: Array<{ x: number; y: number }> = verts.map((v) =>
      isMm
        ? { x: (v as { x: number; y: number }).x, y: (v as { x: number; y: number }).y }
        : { x: (v as { xFrac: number; yFrac: number }).xFrac, y: (v as { xFrac: number; yFrac: number }).yFrac },
    );

    // ── Pass 1: remove duplicate / degenerate consecutive vertices ──────────
    const polyExtent = (arr: Array<{ x: number; y: number }>) => {
      const xs = arr.map((p) => p.x);
      const ys = arr.map((p) => p.y);
      return Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
    };
    const minDist = polyExtent(pts) * 0.0005; // 0.05 % of extent
    pts = pts.filter((p, i, a) => {
      const next = a[(i + 1) % a.length];
      return Math.hypot(p.x - next.x, p.y - next.y) > minDist;
    });
    if (pts.length < 4) return;

    // ── Pass 2: iteratively remove near-collinear vertices ───────────────────
    // Threshold: sin(angle at B) < 0.09 ≈ deviation ≤ 5°.
    // More conservative than before (was 0.13 / 7.5°) to avoid removing valid
    // corners of slightly non-orthogonal buildings.
    const SIN_THR = 0.09;
    let changed = true;
    while (changed && pts.length > minVertices) {
      changed = false;
      for (let i = 0; i < pts.length; i++) {
        const a = pts[(i - 1 + pts.length) % pts.length];
        const b = pts[i];
        const c = pts[(i + 1) % pts.length];
        const abx = b.x - a.x, aby = b.y - a.y;
        const bcx = c.x - b.x, bcy = c.y - b.y;
        const abLen = Math.hypot(abx, aby);
        const bcLen = Math.hypot(bcx, bcy);
        if (abLen < 1e-12 || bcLen < 1e-12) {
          pts.splice(i, 1);
          changed = true;
          break;
        }
        const sinAngle = Math.abs(abx * bcy - aby * bcx) / (abLen * bcLen);
        if (sinAngle < SIN_THR) {
          pts.splice(i, 1);
          changed = true;
          break;
        }
      }
    }

    if (pts.length >= verts.length || pts.length < 3) return; // nothing changed

    this.logger.log(
      `cleanupPolygon: reduced ${verts.length} → ${pts.length} vertices (removed collinear grid-line artifacts)`,
    );

    // Rebuild vertices in the original coordinate format.
    parsed.vertices = pts.map((p) =>
      isMm
        ? { x: Math.round(p.x), y: Math.round(p.y) }
        : { xFrac: p.x, yFrac: p.y },
    ) as VisionFootprintResult['vertices'];

    // Recompute wallLengthsMm from the cleaned geometry.
    if (isMm) {
      const n = pts.length;
      parsed.wallLengthsMm = pts.map((p, i) => {
        const next = pts[(i + 1) % n];
        return Math.round(Math.hypot(next.x - p.x, next.y - p.y));
      });
      // Lengths are now geometry-derived, not from dimension text.
      parsed.wallLengthsFromDimText = false;
    } else {
      // Fractional vertices: lengths were in mm units from the AI but now refer
      // to different edges — clear so the caller recomputes from vertex distances.
      parsed.wallLengthsMm = undefined;
      parsed.wallLengthsFromDimText = undefined;
    }
  }

  /**
   * Parse IFC (BIM) buffer using web-ifc and extract the actual building
   * footprint polygon (L-shapes, U-shapes, multi-wing) via 2D occupancy grid.
   * Falls back to bounding box rectangle if grid extraction fails.
   */
  async processIfc(buffer: Buffer): Promise<VisionFootprintResult> {
    let ifcApi: any = null;
    let modelID = -1;
    try {
      const WebIFC = await import('web-ifc');
      ifcApi = new WebIFC.IfcAPI();
      await ifcApi.Init();
      modelID = ifcApi.OpenModel(new Uint8Array(buffer));
      if (modelID < 0) {
        throw new Error('IFC ファイルを開けませんでした / Failed to open IFC model');
      }

      let minX = Infinity, minY = Infinity, minZ = Infinity;
      let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
      let vertexCount = 0;
      const xyPoints: Array<{ x: number; y: number }> = [];

      ifcApi.StreamAllMeshes(modelID, (mesh: any) => {
        const numGeoms = mesh.geometries.size();
        for (let gi = 0; gi < numGeoms; gi++) {
          const placedGeom = mesh.geometries.get(gi);
          const geom = ifcApi.GetGeometry(modelID, placedGeom.geometryExpressID);
          const vData = ifcApi.GetVertexArray(geom.GetVertexData(), geom.GetVertexDataSize());
          const tf = placedGeom.flatTransformation;

          const stride = 6;
          for (let vi = 0; vi < vData.length; vi += stride) {
            const ox = vData[vi];
            const oy = vData[vi + 1];
            const oz = vData[vi + 2];
            const tx = tf[0] * ox + tf[4] * oy + tf[8] * oz + tf[12];
            const ty = tf[1] * ox + tf[5] * oy + tf[9] * oz + tf[13];
            const tz = tf[2] * ox + tf[6] * oy + tf[10] * oz + tf[14];
            minX = Math.min(minX, tx); maxX = Math.max(maxX, tx);
            minY = Math.min(minY, ty); maxY = Math.max(maxY, ty);
            minZ = Math.min(minZ, tz); maxZ = Math.max(maxZ, tz);
            xyPoints.push({ x: tx, y: ty });
            vertexCount++;
          }
          geom.delete();
        }
      });

      if (vertexCount === 0 || minX === Infinity) {
        throw new Error('IFC にジオメトリが見つかりません / No geometry found in IFC');
      }

      const spanX = maxX - minX;
      const spanY = maxY - minY;
      const spanZ = maxZ - minZ;
      const maxSpan = Math.max(spanX, spanY, spanZ);
      const toMm = maxSpan < 500 ? 1000 : 1;
      const buildingHeightMm = Math.max(1000, Math.round(spanZ * toMm));

      // Try grid-based footprint extraction (captures L/U/T and complex shapes)
      const footprint = this.extractFootprintFromXY(
        xyPoints, minX, minY, maxX, maxY, toMm,
      );
      if (footprint && footprint.length >= 3) {
        const n = footprint.length;
        const wallLengthsMm = footprint.map((v, i) => {
          const next = footprint[(i + 1) % n];
          return Math.round(Math.hypot(next.x - v.x, next.y - v.y));
        });
        this.logger.log(
          `IFC footprint: ${n} vertices (grid-based), height=${buildingHeightMm}mm, ` +
          `walls=${wallLengthsMm.join('/')}mm`,
        );
        return {
          vertices: footprint,
          buildingHeightMm,
          wallLengthsMm,
          wallLengthsFromDimText: true,
          confidence: 0.85,
        };
      }

      // Fallback: bounding box rectangle
      const x0 = Math.round(minX * toMm);
      const y0 = Math.round(minY * toMm);
      const x1 = Math.round(maxX * toMm);
      const y1 = Math.round(maxY * toMm);
      const wX = Math.round(spanX * toMm);
      const wY = Math.round(spanY * toMm);
      this.logger.log(
        `IFC fallback bbox: ${spanX.toFixed(1)}×${spanY.toFixed(1)}×${spanZ.toFixed(1)}, ` +
        `toMm=${toMm}, height=${buildingHeightMm}mm`,
      );
      return {
        vertices: [
          { x: x0, y: y0 }, { x: x1, y: y0 },
          { x: x1, y: y1 }, { x: x0, y: y1 },
        ],
        buildingHeightMm,
        wallLengthsMm: [wX, wY, wX, wY],
        wallLengthsFromDimText: true,
        confidence: 0.9,
      };
    } catch (err) {
      const msg = (err as Error)?.message || String(err);
      this.logger.error('IFC processing failed', msg);
      throw new Error(`IFC processing failed: ${msg}`);
    } finally {
      try {
        if (ifcApi && modelID >= 0 && ifcApi.IsModelOpen(modelID)) {
          ifcApi.CloseModel(modelID);
        }
      } catch { /* ignore cleanup errors */ }
    }
  }

  // ═══════════════════════════════════════════════════════════
  // Grid-based footprint extraction for IFC models
  // ═══════════════════════════════════════════════════════════

  /**
   * Project all mesh vertices to XY, build an occupancy grid,
   * flood-fill exterior, then trace the boundary polygon.
   * Returns the actual building footprint (L/U/T/complex shapes).
   */
  private extractFootprintFromXY(
    xyPoints: Array<{ x: number; y: number }>,
    minX: number, minY: number, maxX: number, maxY: number,
    toMm: number,
  ): Array<{ x: number; y: number }> | null {
    const spanX = (maxX - minX) * toMm;
    const spanY = (maxY - minY) * toMm;
    if (spanX < 100 || spanY < 100) return null;

    const cellMm = Math.max(250, Math.min(1000,
      Math.max(spanX, spanY) / 150,
    ));
    const pad = 2;
    const gw = Math.ceil(spanX / cellMm) + pad * 2;
    const gh = Math.ceil(spanY / cellMm) + pad * 2;
    if (gw * gh > 200000) return null;

    const originXMm = minX * toMm - pad * cellMm;
    const originYMm = minY * toMm - pad * cellMm;
    const grid = new Uint8Array(gw * gh);

    for (const p of xyPoints) {
      const gx = Math.floor((p.x * toMm - originXMm) / cellMm);
      const gy = Math.floor((p.y * toMm - originYMm) / cellMm);
      if (gx >= 0 && gx < gw && gy >= 0 && gy < gh) {
        grid[gy * gw + gx] = 1;
      }
    }

    this.dilateGrid(grid, gw, gh, Math.max(2, Math.ceil(1500 / cellMm)));
    this.floodFillExterior(grid, gw, gh);

    const boundary = this.extractBoundaryFromGrid(grid, gw, gh, originXMm, originYMm, cellMm);
    if (boundary.length < 3) return null;

    const simplified = this.removeCollinearVertices(boundary, cellMm * cellMm * 0.5);
    return simplified.length >= 3 ? simplified : null;
  }

  private dilateGrid(grid: Uint8Array, w: number, h: number, radius: number): void {
    const original = new Uint8Array(grid);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (!original[y * w + x]) continue;
        const r2 = radius * radius;
        for (let dy = -radius; dy <= radius; dy++) {
          for (let dx = -radius; dx <= radius; dx++) {
            if (dx * dx + dy * dy > r2) continue;
            const nx = x + dx, ny = y + dy;
            if (nx >= 0 && nx < w && ny >= 0 && ny < h) {
              grid[ny * w + nx] = 1;
            }
          }
        }
      }
    }
  }

  private floodFillExterior(grid: Uint8Array, w: number, h: number): void {
    const visited = new Uint8Array(w * h);
    const queue: number[] = [];
    for (let x = 0; x < w; x++) {
      for (const y of [0, h - 1]) {
        const idx = y * w + x;
        if (!grid[idx] && !visited[idx]) { visited[idx] = 1; queue.push(idx); }
      }
    }
    for (let y = 1; y < h - 1; y++) {
      for (const x of [0, w - 1]) {
        const idx = y * w + x;
        if (!grid[idx] && !visited[idx]) { visited[idx] = 1; queue.push(idx); }
      }
    }
    let head = 0;
    while (head < queue.length) {
      const idx = queue[head++];
      const x = idx % w, y = (idx - x) / w;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue;
        const nIdx = ny * w + nx;
        if (visited[nIdx] || grid[nIdx]) continue;
        visited[nIdx] = 1;
        queue.push(nIdx);
      }
    }
    for (let i = 0; i < w * h; i++) {
      if (!grid[i] && !visited[i]) grid[i] = 1;
    }
  }

  /**
   * Trace the outer boundary of occupied cells using column/row profiles.
   * Produces a clockwise polygon with vertices at grid cell corners.
   * Correctly captures L-shapes, U-shapes, T-shapes, and multi-wing buildings.
   */
  private extractBoundaryFromGrid(
    grid: Uint8Array, w: number, h: number,
    originXMm: number, originYMm: number, cellMm: number,
  ): Array<{ x: number; y: number }> {
    const isOcc = (gx: number, gy: number) =>
      gx >= 0 && gx < w && gy >= 0 && gy < h && grid[gy * w + gx] === 1;

    const colTop = new Array(w).fill(-1);
    const colBot = new Array(w).fill(-1);
    for (let x = 0; x < w; x++) {
      for (let y = 0; y < h; y++) {
        if (isOcc(x, y)) {
          if (colTop[x] < 0) colTop[x] = y;
          colBot[x] = y;
        }
      }
    }
    const rowLeft = new Array(h).fill(-1);
    const rowRight = new Array(h).fill(-1);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (isOcc(x, y)) {
          if (rowLeft[y] < 0) rowLeft[y] = x;
          rowRight[y] = x;
        }
      }
    }

    let minOccX = w, maxOccX = -1;
    for (let x = 0; x < w; x++) {
      if (colTop[x] >= 0) { minOccX = Math.min(minOccX, x); maxOccX = x; }
    }
    if (minOccX > maxOccX) return [];

    const mmX = (gx: number) => Math.round(originXMm + gx * cellMm);
    const mmY = (gy: number) => Math.round(originYMm + gy * cellMm);
    const pts: Array<{ x: number; y: number }> = [];
    const add = (gx: number, gy: number) => {
      const p = { x: mmX(gx), y: mmY(gy) };
      const last = pts[pts.length - 1];
      if (last && last.x === p.x && last.y === p.y) return;
      pts.push(p);
    };

    // Phase 1: Top edge (left → right)
    let prevTopY = colTop[minOccX];
    add(minOccX, prevTopY);
    for (let x = minOccX + 1; x <= maxOccX; x++) {
      if (colTop[x] < 0) continue;
      if (colTop[x] !== prevTopY) {
        add(x, prevTopY);
        add(x, colTop[x]);
        prevTopY = colTop[x];
      }
    }
    add(maxOccX + 1, prevTopY);

    // Phase 2: Right edge (top → bottom)
    const rightStartY = prevTopY;
    let rightEndY = 0;
    for (let y = 0; y < h; y++) if (rowRight[y] >= 0) rightEndY = y;
    let prevRightX = rowRight[rightStartY] >= 0 ? rowRight[rightStartY] + 1 : maxOccX + 1;
    for (let y = rightStartY + 1; y <= rightEndY; y++) {
      if (rowRight[y] < 0) continue;
      const rx = rowRight[y] + 1;
      if (rx !== prevRightX) {
        add(prevRightX, y);
        add(rx, y);
        prevRightX = rx;
      }
    }
    add(prevRightX, rightEndY + 1);

    // Phase 3: Bottom edge (right → left)
    let prevBotY = colBot[maxOccX] >= 0 ? colBot[maxOccX] + 1 : rightEndY + 1;
    for (let x = maxOccX - 1; x >= minOccX; x--) {
      if (colBot[x] < 0) continue;
      const by = colBot[x] + 1;
      if (by !== prevBotY) {
        add(x + 1, prevBotY);
        add(x + 1, by);
        prevBotY = by;
      }
    }
    add(minOccX, prevBotY);

    // Phase 4: Left edge (bottom → top)
    let leftStartY = 0;
    for (let y = h - 1; y >= 0; y--) { if (rowLeft[y] >= 0) { leftStartY = y; break; } }
    let prevLeftX = rowLeft[leftStartY] >= 0 ? rowLeft[leftStartY] : minOccX;
    for (let y = leftStartY - 1; y >= colTop[minOccX]; y--) {
      if (rowLeft[y] < 0) continue;
      const lx = rowLeft[y];
      if (lx !== prevLeftX) {
        add(prevLeftX, y + 1);
        add(lx, y + 1);
        prevLeftX = lx;
      }
    }

    return pts;
  }

  private removeCollinearVertices(
    pts: Array<{ x: number; y: number }>,
    tolerance: number,
  ): Array<{ x: number; y: number }> {
    if (pts.length <= 3) return pts;
    const result: typeof pts = [];
    for (let i = 0; i < pts.length; i++) {
      const prev = pts[(i - 1 + pts.length) % pts.length];
      const curr = pts[i];
      const next = pts[(i + 1) % pts.length];
      const cross = (curr.x - prev.x) * (next.y - curr.y)
                  - (curr.y - prev.y) * (next.x - curr.x);
      if (Math.abs(cross) > tolerance) result.push(curr);
    }
    return result.length >= 3 ? result : pts;
  }

  private getFallbackFootprint(): VisionFootprintResult {
    return {
      vertices: [
        { x: 0, y: 0 },
        { x: 10000, y: 0 },
        { x: 10000, y: 8000 },
        { x: 0, y: 8000 },
      ],
      buildingHeightMm: 3000,
      confidence: 0,
    };
  }
}
