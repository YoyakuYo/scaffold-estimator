import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'crypto';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const DxfParser = require('dxf-parser');

/** Structured footprint output from vision or CAD (2D polygon + height). */
export interface VisionMassingTier {
  vertices: Array<{ x: number; y: number } | { xFrac: number; yFrac: number }>;
  topHeightMm: number;
  baseHeightMm?: number;
}

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
  /**
   * Per-edge wall heights in mm (one per polygon edge, same order as vertices).
   * For stepped/tiered buildings where different facades have different heights.
   * When omitted, all walls use buildingHeightMm uniformly.
   */
  wallHeightsMm?: number[];
  /**
   * Optional stacked massing tiers for setback / terrace buildings where upper floors
   * have smaller footprints than the ground floor.
   */
  massingTiers?: VisionMassingTier[];
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
  COORDINATE SYSTEM (critical): Use IMAGE/SCREEN coordinates — x increases to the RIGHT, y increases DOWNWARD (same direction as image pixels). Do NOT use mathematical/geographic coordinates where y increases upward. The top-left of the plan = {x:0, y:0}, bottom-right has the largest x and y values. This ensures the rendered plan matches the original drawing orientation.
  UNITS: If the drawing shows a scale (S=1/100, S=1/200, 縮尺 etc.) you MUST output { x, y } in real mm. Never use fractions when scale is readable.
- buildingHeightMm: total building height in mm (ground to highest point/eaves/top). If not shown, use typical 3000mm per story.

Optional fields (read from dimension lines and annotations):
- wallHeightsMm: array of heights in mm, one per edge, same count as vertices.
  For STEPPED / TIERED / SETBACK buildings where different facade sections have different heights:
  * A stepped building (like a wedding cake or cascading tower) has wings or sections at different roof levels.
  * Each polygon edge (wall) should get the height of the roof/eaves above THAT specific wall section.
  * Example: A building with a 5-story wing (15000mm) on the left and a 12-story tower (36000mm) on the right → the left-side walls get 15000, the right-side walls get 36000.
  * For walls connecting sections of different height (transition walls), use the TALLER adjacent section's height.
  * IMPORTANT: if a long straight facade contains multiple height zones along its length, SPLIT that facade into multiple consecutive edges at the height-change points. Those split vertices may be perfectly collinear and are intentional.
  * If ALL walls have the same height (simple box), you may omit this field — buildingHeightMm alone is sufficient.
  * CRITICAL for 3D BIM renders: If you can see that parts of the building are taller than others (stepped roofline, cascading floors, different wing heights), you MUST output wallHeightsMm with the correct per-wall height for each edge. This is the #1 most important new field for scaffold estimation accuracy on complex buildings.
- massingTiers: optional array for buildings whose upper floors step inward or have smaller footprints than the base.
  * Use this when the building is a terrace / wedding-cake / podium+tower shape and a single base polygon plus wallHeightsMm is not enough to show the real 3D mass.
  * Each tier: { vertices, topHeightMm, baseHeightMm? }.
  * vertices = footprint of that tier in the same coordinate system as the main vertices.
  * topHeightMm = cumulative top elevation of that tier above ground.
  * baseHeightMm = optional bottom elevation; omit for the first tier and it defaults to ground / previous tier top.
  * Include one tier per major setback, ordered from lowest to highest.
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

THE #1 RULE: You are seeing the building from an ANGLE, not from above. You MUST mentally "look down" and reconstruct the TOP-DOWN plan footprint. The visible outline in the image is a perspective projection — it is NOT the footprint.

STEP 1 — DETERMINE IF THE BUILDING IS A SIMPLE RECTANGLE:
Most buildings are rectangular boxes. A rectangular building seen in 3D perspective appears as a trapezoid/hexagon — but the real plan footprint is a RECTANGLE with exactly 4 vertices and 4 walls.
- Ask: "Does every wall face of this building align with the same rectangular box?"
- Ask: "Are all walls flush — no wing sticking out, no setback, no courtyard?"
- If YES to both → output EXACTLY 4 vertices forming a rectangle. NEVER output 5 or 6 vertices for a rectangular building.
- The rectangle has only 2 unique dimensions: width (W) and depth (D). Output: [{x:0,y:0}, {x:W,y:0}, {x:W,y:D}, {x:0,y:D}].
- Estimate W and D from the 3D proportions (e.g. the front face looks ~2x wider than the side face → W ≈ 2×D).
- IGNORE terraces, entrance ramps, canopies, balconies, AC units, and ground slabs — they are NOT part of the building footprint. Only trace the main structural walls.

PERSPECTIVE ILLUSION WARNING:
A rectangular box seen from a 3/4 angle shows 3 visible faces. The visible outline has 6 edges forming a hexagon. THIS IS AN OPTICAL ILLUSION — the real footprint is still a 4-vertex rectangle. NEVER trace this hexagonal silhouette as the footprint. If you output 6 walls with alternating lengths (e.g. 12000, 5500, 12000, 5500, 12000, 5500), you traced the silhouette — WRONG. The correct output is 4 walls: 12000, 5500, 12000, 5500.

STEP 2 — IF NOT RECTANGULAR, determine the actual shape:
- L-shaped: TWO WINGS meeting at a corner → 6 vertices from above.
- U-shaped: central courtyard or recess → 8 vertices from above.
- T-shaped: protruding central section → 8 vertices from above.
- Indicators: one part of the building extends further than another, or there is a visible step/setback in the facade.

OTHER 3D VIEW RULES:
- Count visible floors to estimate height: typical floor height is 3000–4000mm per story.
- Set wallLengthsFromDimText: false and confidence: 0.5–0.7 (lower than for dimensioned plans).
- When shape is unclear but definitely not rectangular, output your best L/U/T approximation.

═══ STEPPED / TIERED / CASCADING BUILDINGS (CRITICAL FOR HEIGHT) ═══
Many buildings have DIFFERENT heights on different sides — stepped rooflines, cascading floors, or wings of varying height.
Examples: a building that steps down from 15 stories to 10 to 5 (like a staircase/pyramid), or a low podium with a tall tower.
When you detect this:
1. Set buildingHeightMm to the MAXIMUM height (tallest point).
2. MUST output wallHeightsMm: an array with one height per polygon edge, matching the height of each facade section.
   - Count floors visible above each wall section. Each floor ≈ 3000–4000mm.
   - Walls facing the tall part get the tall height; walls facing the short part get the short height.
   - Transition walls (connecting tall to short) get the TALLER adjacent height.
3. For the footprint polygon: trace the FULL base outline as seen from above (the ground-level footprint).
   The stepped nature is primarily captured in wallHeightsMm.
   If a straight facade changes height partway along its run, add split vertices at those change points so each edge can carry its own wall height. These split vertices may be collinear and must be preserved.
   If sections have different plan outlines at ground level (e.g. tower on a podium where the tower is narrower), DO add the setback vertices in the polygon.
4. DETECTION CUES in 3D views:
   - Visible horizontal rooflines at different levels = stepped building.
   - One side has more floors visible than another = different heights.
   - "Wedding cake" or "pyramid" profile = cascading tiers.
   - If the building looks like stairs from the side, it IS stepped — output wallHeightsMm.

Polygon rules — follow these exactly:
1. CLOSED polygon: the last edge must connect back to vertex[0]. Do NOT add a duplicate of vertex[0] at the end.
   The scaffold wraps the entire building without gaps — explicitly close the loop.

2. CONCAVE HULL (no bounding box): Trace the real perimeter. L-shaped buildings need 6 vertices (not 4).
   Interior corners (indents, notches) must each be a vertex. Never simplify to a rectangle if the plan shows an L, U, or stepped outline.

3. ARCHITECTURAL FLOOR PLANS (detailed room layouts) — CRITICAL:
   If the image shows interior rooms, furniture, bathrooms, staircases, corridors, or partitions, it is a detailed architectural floor plan (平面図/間取り図). Apply these rules:
   - IGNORE everything inside the building: room walls, partition walls, bathroom fixtures, staircases, furniture, columns, doors between rooms, windows in interior walls.
   - FIND THE OUTERMOST BOUNDARY: Look for the thickest walls at the very edge of the drawing — these form the exterior shell. The outer perimeter is the silhouette of the whole building seen from above.
   - EXTERIOR WALLS are typically drawn thicker/bolder than interior partition walls.
   - The exterior perimeter is a single closed polygon. All interior elements are INSIDE this polygon and must be ignored.
   - For an L-shaped floor plan: the outer boundary has 6 vertices. The "missing" corner (the interior notch) creates the 2 inward-turning vertices.
   - For a rectangular floor plan with a protruding section: the outer boundary has 6–8 vertices.
   - IGNORE any small protrusions for entrance steps, bay windows, or utility boxes smaller than 500mm — round them into the nearest straight wall.
   - The final polygon should look like the silhouette you would see if you held the floor plan at arm's length and traced the outer edge with a marker.
   STEP-BY-STEP for floor plans:
   a) Find the leftmost exterior edge, rightmost exterior edge, topmost exterior edge, and bottommost exterior edge.
   b) Walk the outer boundary clockwise, placing a vertex only at TRUE OUTSIDE CORNERS (corners where the exterior wall changes direction).
   c) Never place a vertex where an interior wall meets the exterior wall — that is NOT an exterior corner.
   d) The result should be 4–10 vertices for most buildings.

3b. JAPANESE SCAFFOLD PLANS (仮設計画図) — blue lines:
   Japanese scaffold drawings use color coding that you must understand:
   - BLUE FILLED/HATCHED ZONE: this is the scaffold overhang area (the zone between the building wall and the outer scaffold edge). DO NOT trace its outer boundary.
   - BLUE PERIMETER LINE (the inner boundary of the blue zone, adjacent to the building): this IS the building wall face. TRACE THIS LINE as your polygon.
   - Confirm: the dimension strings on the plan (e.g. "10@1829=18290") should match the edges you are tracing. If a long dimension string aligns with your traced edge, you have the right line.
   - DIAGONAL / ANGLED WALLS: If the building has a wall that is neither horizontal nor vertical (e.g. a slanted or cut corner), trace it as a SINGLE straight edge between its two endpoints. DO NOT break it into horizontal+vertical steps.
   - BUILDING SHAPE DETECTION for scaffold plans: The colored scaffold strip (blue/yellow/green rectangle) wraps around the building. The building itself is the uncolored area INSIDE the scaffold strip. Identify the building outline (the inner edge of the scaffold strip, not the outer edge), and trace it accurately including any diagonal corners.
   For non-scaffold plans (architectural cross-sections, photos): trace the visible outer wall boundary.

4. SHAPE REALITY CHECK — Most buildings are elongated rectangles or simple polygons. Common real shapes:
   - RECTANGLE: 4 vertices, 4 edges (most common)
   - TRAPEZOID (台形): 4 vertices — rectangle with ONE diagonal/slanted side instead of a straight right or left wall. This is VERY COMMON in Japanese urban buildings that face a diagonal street. Example: top-left, top-right, bottom-right-shifted, bottom-left. USE ONLY 4 VERTICES.
   - L-SHAPE: 6 vertices (rectangular notch cut from one corner)
   - RECTANGLE WITH CUT CORNER (面取り): 5 vertices (one diagonal chamfer at a corner — this creates ONE extra vertex, NOT multiple)
   If your polygon looks like a NARROW DIAMOND, ARROW, or has many equal-length sides, you almost certainly traced the scaffold strip outline or grid lines instead of the building wall. Re-examine and extract the correct plan shape.
   ANTI-PATTERN — the most common error: drawing a diagonal wall as multiple short steps following grid lines. A diagonal wall going from point A to point B is ALWAYS one straight edge with exactly 2 endpoints, even if 10 structural grid lines cross it.

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
- DIAGONAL WALL CHECK: if you have 4+ consecutive edges all going in roughly the same diagonal direction, collapse them into ONE straight edge. A diagonal wall is one edge, period.
- SHAPE SANITY: a typical urban building is a rectangle or trapezoid (4-6 vertices). If you output 7+ vertices, double-check that each vertex represents a REAL corner of the building wall (not a grid intersection or scaffold strip corner).
- 3D VIEW SILHOUETTE CHECK (critical): If the image is a 3D view and you have 6 walls with alternating lengths (A, B, A, B, A, B), you traced the perspective silhouette — WRONG. A rectangular building is 4 walls (A, B, A, B). Go back and output 4 vertices.
- 3D VIEW RECTANGLE CHECK: If the image is a 3D view and the building is a simple box (all walls flush), output EXACTLY 4 vertices. More than 4 means you are tracing the perspective outline.
- 3D VIEW COMPLEX CHECK: If the image is a 3D view and the building has visible setbacks, wings, or L/U/T shape: output 6+ vertices (NOT 4). Outputting a rectangle for a non-rectangular building is wrong.
- JAPANESE PLAN FINAL CHECK: Did you trace the building wall (the GRAY/UNCOLORED outer wall of the building, which is the INNER boundary of the blue scaffold zone)? If your traced polygon is outside the blue zone, you traced the wrong line.
- FLOOR PLAN FINAL CHECK: If the image shows rooms/furniture/interior layout — is your polygon the OUTERMOST SILHOUETTE of the building, with no interior walls or partitions included as vertices? If any vertex of your polygon is at a point where an interior partition meets an exterior wall (rather than a true exterior corner), remove that vertex. The polygon should be the building's footprint as seen from directly above, as if you erased all interior elements.

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
      throw new Error(
        'PDFファイルは直接解析できません。画像（JPEG/PNG）に変換するか、CADデータの場合はDXF形式でエクスポートしてアップロードしてください。 / ' +
        'PDF files cannot be analyzed directly. Please convert to an image (JPEG/PNG) for photo analysis, or export as DXF from your CAD software.',
      );
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
   *
   * Strategy (in order):
   * 1. Collect all closed LWPOLYLINEs/POLYLINEs, score each as a building candidate.
   *    Reject shapes that look like circles (equal edge lengths, high vertex count),
   *    title blocks (extreme aspect ratio), or annotation borders.
   *    Prefer orthogonal (rectilinear) shapes on building layers.
   * 2. If no good polyline found, try LINE-based polygon detection.
   * 3. Last resort: bounding box of all LINE entities.
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
      let buildingHeightMm = 3000;
      const dimensions: Array<{ value: number; vertical: boolean }> = [];

      // Building-related layer name keywords (Japanese + English)
      const BUILDING_LAYER_KEYWORDS = [
        '壁', 'wall', 'building', 'arch', '建物', '外壁', 'outline', 'outer',
        'perimeter', '輪郭', '外形', 'structure', 'gaibu', 'exterior',
      ];
      const isBuildingLayer = (layer: string | undefined): boolean => {
        if (!layer) return false;
        const l = layer.toLowerCase();
        return BUILDING_LAYER_KEYWORDS.some((k) => l.includes(k));
      };

      /**
       * Score a candidate polyline as building footprint.
       * Higher = better candidate. Returns -Infinity to reject outright.
       */
      const scorePolyline = (pts: Array<{ x: number; y: number }>, layer?: string): number => {
        const n = pts.length;
        if (n < 3) return -Infinity;

        // Reject obvious title blocks / frames: extremely large aspect ratio (>20:1)
        const xs = pts.map((p) => p.x);
        const ys = pts.map((p) => p.y);
        const w = Math.max(...xs) - Math.min(...xs);
        const h = Math.max(...ys) - Math.min(...ys);
        if (w < 1 || h < 1) return -Infinity;
        const aspectRatio = Math.max(w, h) / Math.min(w, h);
        if (aspectRatio > 25) return -Infinity;

        // Compute edge lengths
        const edgeLens: number[] = [];
        for (let i = 0; i < n; i++) {
          const a = pts[i];
          const b = pts[(i + 1) % n];
          edgeLens.push(Math.hypot(b.x - a.x, b.y - a.y));
        }
        const maxEdge = Math.max(...edgeLens);
        const minEdge = Math.min(...edgeLens);
        const avgEdge = edgeLens.reduce((s, v) => s + v, 0) / n;

        // Reject circles / regular polygons: all edges nearly equal AND many vertices
        // A circle approximated with N segments has maxEdge/minEdge ≈ 1.
        const edgeVariance = maxEdge / (minEdge + 1e-9);
        const looksLikeCircle = edgeVariance < 1.3 && n >= 8;
        if (looksLikeCircle) return -Infinity;

        // Reject very small shapes (annotation symbols, door swings, etc.)
        // Minimum meaningful building perimeter: 4m (floor plan scale)
        const perimeterMm = edgeLens.reduce((s, v) => s + v, 0);
        if (perimeterMm < 4000) return -Infinity;

        // Count orthogonal corners (turns close to 90°)
        let orthoCorners = 0;
        for (let i = 0; i < n; i++) {
          const a = pts[(i - 1 + n) % n];
          const b = pts[i];
          const c = pts[(i + 1) % n];
          const abx = b.x - a.x; const aby = b.y - a.y;
          const bcx = c.x - b.x; const bcy = c.y - b.y;
          const dot = abx * bcx + aby * bcy;
          const cross = abx * bcy - aby * bcx;
          const angle = Math.abs(Math.atan2(Math.abs(cross), dot) * 180 / Math.PI);
          if (angle > 70 && angle < 110) orthoCorners++;
        }
        const orthoRatio = orthoCorners / n;

        const area = Math.abs(this.polygonArea(pts));

        // Score: prefer large area, high ortho ratio, building layers, reasonable vertex count
        let score = Math.log(area + 1);
        score += orthoRatio * 5;          // strongly prefer rectangular buildings
        score -= Math.max(0, n - 30) * 0.5; // penalise very high vertex counts
        if (isBuildingLayer(layer)) score += 10;
        if (looksLikeCircle) score = -Infinity;

        return score;
      };

      // Collect all candidate closed polylines with scores
      const candidates: Array<{ pts: Array<{ x: number; y: number }>; score: number; area: number }> = [];

      for (const entity of dxf.entities) {
        if (entity.type === 'LWPOLYLINE' || entity.type === 'POLYLINE') {
          const pts = (entity.vertices || entity.points || []).map((v: any) => ({
            x: (v.x ?? v[0] ?? 0) * scaleToMm,
            y: (v.y ?? v[1] ?? 0) * scaleToMm,
          }));
          const closed = entity.shape === true || (entity as any).closed === true || (entity as any).closed === 1;
          if (pts.length >= 3 && closed) {
            const layer: string | undefined = (entity as any).layer;
            const score = scorePolyline(pts, layer);
            if (score > -Infinity) {
              candidates.push({ pts, score, area: Math.abs(this.polygonArea(pts)) });
            } else {
              this.logger.debug?.(`DXF: rejected polyline layer=${layer} n=${pts.length} (circle/title/small)`);
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

      // Pick the best LWPOLYLINE candidate
      candidates.sort((a, b) => b.score - a.score || b.area - a.area);
      const bestPolyline = candidates.length > 0 ? candidates[0] : null;
      this.logger.log(
        bestPolyline
          ? `DXF: best LWPOLYLINE n=${bestPolyline.pts.length}, score=${bestPolyline.score.toFixed(2)}, area=${bestPolyline.area.toFixed(0)}`
          : `DXF: no valid LWPOLYLINE found`,
      );

      // ALWAYS also try LINE-based polygon detection — many architectural DXFs
      // draw walls as individual LINE entities, not as closed LWPOLYLINEs.
      const linePoly = this.detectPolygonFromLines(dxf.entities, scaleToMm);
      this.logger.log(linePoly.length >= 3
        ? `DXF: LINE-based polygon: ${linePoly.length} verts, area=${Math.abs(this.polygonArea(linePoly)).toFixed(0)}`
        : `DXF: LINE-based polygon: none found`,
      );

      // Choose the better result: LINE-based wins when:
      //  a) no valid LWPOLYLINE exists, OR
      //  b) LINE polygon has more area (captures more of the real building), OR
      //  c) LINE polygon has more orthogonal corners (more building-like)
      let vertices: Array<{ x: number; y: number }> = [];

      if (linePoly.length >= 3 && bestPolyline) {
        const lineArea = Math.abs(this.polygonArea(linePoly));
        const polyArea = bestPolyline.area;
        // LINE polygon wins if it's larger AND has a high ortho ratio
        const lineScore = scorePolyline(linePoly);
        vertices = lineScore >= bestPolyline.score ? linePoly : bestPolyline.pts;
        this.logger.log(`DXF: chose ${lineScore >= bestPolyline.score ? 'LINE' : 'LWPOLYLINE'} (lineScore=${lineScore.toFixed(2)} vs polyScore=${bestPolyline.score.toFixed(2)}, lineArea=${lineArea.toFixed(0)} vs polyArea=${polyArea.toFixed(0)})`);
      } else if (linePoly.length >= 3) {
        vertices = linePoly;
        this.logger.log('DXF: using LINE-based polygon (no valid LWPOLYLINE)');
      } else if (bestPolyline) {
        vertices = bestPolyline.pts;
        this.logger.log('DXF: using LWPOLYLINE (no LINE polygon)');
      }

      // Last resort: bounding box of all LINE + LWPOLYLINE endpoints
      if (vertices.length < 3) {
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const e of dxf.entities) {
          if (e.type === 'LINE' && e.start && e.end) {
            const s = e.start as { x: number; y: number };
            const en = e.end as { x: number; y: number };
            minX = Math.min(minX, s.x * scaleToMm, en.x * scaleToMm);
            maxX = Math.max(maxX, s.x * scaleToMm, en.x * scaleToMm);
            minY = Math.min(minY, s.y * scaleToMm, en.y * scaleToMm);
            maxY = Math.max(maxY, s.y * scaleToMm, en.y * scaleToMm);
          }
        }
        if (minX !== Infinity && maxX - minX > 100 && maxY - minY > 100) {
          vertices = [
            { x: minX, y: minY }, { x: maxX, y: minY },
            { x: maxX, y: maxY }, { x: minX, y: maxY },
          ];
          this.logger.log(`DXF: using bounding box fallback ${(maxX - minX).toFixed(0)}×${(maxY - minY).toFixed(0)}mm`);
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
   * Build closed polygon from LINE entities.
   *
   * Strategy:
   * 1. Snap all endpoints to a grid to merge near-coincident points.
   * 2. Build an adjacency graph of connected endpoints.
   * 3. Walk loops using a "rightmost turn" heuristic (follows outer boundary).
   *    This naturally traces the outer perimeter of concave shapes (L, U, T).
   * 4. Score loops by area; reject circles; return the best building candidate.
   */
  private detectPolygonFromLines(
    entities: any[],
    scaleToMm: number,
  ): Array<{ x: number; y: number }> {
    // Outer wall layer keywords — try these first, fall back to all layers
    const OUTER_LAYER_KW = [
      '外壁', 'wall', 'outer', 'exterior', 'building', '建物', 'outline',
      'perimeter', '輪郭', '外形', 'arch', 'structure', 'gaibu',
      // common CAD layer names for outer walls
      'a-wall', 'a_wall', 's-wall', 's_wall', '0',
    ];
    const isOuterLayer = (layer: string | undefined): boolean => {
      if (!layer) return true; // include if no layer info
      const l = layer.toLowerCase();
      return OUTER_LAYER_KW.some((k) => l.includes(k));
    };

    const buildSegments = (layerFilter: boolean): Array<{ x1: number; y1: number; x2: number; y2: number }> => {
      const segs: Array<{ x1: number; y1: number; x2: number; y2: number }> = [];
      for (const e of entities) {
        if (e.type === 'LINE' && e.start && e.end) {
          if (layerFilter && !isOuterLayer((e as any).layer)) continue;
          const s = e.start as { x: number; y: number };
          const en = e.end as { x: number; y: number };
          const x1 = s.x * scaleToMm; const y1 = s.y * scaleToMm;
          const x2 = en.x * scaleToMm; const y2 = en.y * scaleToMm;
          if (Math.hypot(x2 - x1, y2 - y1) > 1) segs.push({ x1, y1, x2, y2 });
        }
      }
      return segs;
    };

    // Try outer-layer lines first; if insufficient, fall back to all lines
    let segments = buildSegments(true);
    if (segments.length < 6) segments = buildSegments(false);
    if (segments.length < 3) return [];

    // Adaptive snap tolerance: ~0.5% of bounding extent, min 1mm, max 100mm
    const allX = segments.flatMap((s) => [s.x1, s.x2]);
    const allY = segments.flatMap((s) => [s.y1, s.y2]);
    const extentX = Math.max(...allX) - Math.min(...allX);
    const extentY = Math.max(...allY) - Math.min(...allY);
    const snap = Math.max(1, Math.min(100, Math.max(extentX, extentY) * 0.005));

    const snapCoord = (v: number) => Math.round(v / snap) * snap;
    const key = (x: number, y: number) => `${snapCoord(x)},${snapCoord(y)}`;
    const keyToXY = (k: string): { x: number; y: number } => {
      const [x, y] = k.split(',').map(Number);
      return { x, y };
    };

    // Build directed edge list: for each (from→to) store the direction angle
    type DirEdge = { to: string; angle: number };
    const adj = new Map<string, DirEdge[]>();
    const addEdge = (fromKey: string, toKey: string, angle: number) => {
      if (fromKey === toKey) return;
      if (!adj.has(fromKey)) adj.set(fromKey, []);
      adj.get(fromKey)!.push({ to: toKey, angle });
    };

    for (const seg of segments) {
      const k1 = key(seg.x1, seg.y1);
      const k2 = key(seg.x2, seg.y2);
      const angle12 = Math.atan2(seg.y2 - seg.y1, seg.x2 - seg.x1);
      const angle21 = Math.atan2(seg.y1 - seg.y2, seg.x1 - seg.x2);
      addEdge(k1, k2, angle12);
      addEdge(k2, k1, angle21);
    }

    if (adj.size < 3) return [];

    // Walk outer boundary using "most clockwise turn" heuristic.
    // At each node, choose the neighbor that makes the rightmost (most CW) turn
    // relative to the incoming direction. This traces the outer perimeter.
    const walkOuterLoop = (startKey: string, startAngle: number): string[] | null => {
      const path: string[] = [startKey];
      const visited = new Set<string>([`${startKey}@${startAngle.toFixed(4)}`]);
      let curKey = startKey;
      let incomingAngle = startAngle;
      const maxSteps = adj.size * 2 + 10;

      for (let step = 0; step < maxSteps; step++) {
        const neighbors = adj.get(curKey) ?? [];
        if (neighbors.length === 0) return null;

        // Find the neighbor that makes the most clockwise turn from the reverse incoming direction
        // (reverse = we came FROM that direction, so reverse = incomingAngle + π)
        const reverseAngle = incomingAngle + Math.PI;
        let bestAngleDiff = Infinity;
        let bestNeighbor: DirEdge | null = null;

        for (const nb of neighbors) {
          if (path.length > 1 && nb.to === path[path.length - 2]) continue; // don't go back
          // Angular difference: how much we turn right from reverseAngle
          let diff = nb.angle - reverseAngle;
          while (diff <= 0) diff += 2 * Math.PI;
          while (diff > 2 * Math.PI) diff -= 2 * Math.PI;
          if (diff < bestAngleDiff) {
            bestAngleDiff = diff;
            bestNeighbor = nb;
          }
        }

        if (!bestNeighbor) return null;

        if (bestNeighbor.to === startKey && path.length >= 3) {
          return path; // closed loop found
        }

        const visitKey = `${bestNeighbor.to}@${bestNeighbor.angle.toFixed(4)}`;
        if (visited.has(visitKey)) return null; // loop detected (not closed)
        visited.add(visitKey);
        path.push(bestNeighbor.to);
        incomingAngle = bestNeighbor.angle;
        curKey = bestNeighbor.to;
      }
      return null;
    };

    const candidates: Array<{ points: Array<{ x: number; y: number }>; area: number; score: number }> = [];

    for (const [startKey, edges] of adj) {
      for (const startEdge of edges) {
        const loop = walkOuterLoop(startKey, startEdge.angle);
        if (!loop || loop.length < 3) continue;
        const pts = loop.map(keyToXY);
        const area = Math.abs(this.polygonArea(pts));
        if (area < 100) continue; // too small

        // Score: same as polyline scoring — reject circles, prefer ortho
        const n = pts.length;
        const edgeLens: number[] = pts.map((p, i) => Math.hypot(pts[(i+1)%n].x - p.x, pts[(i+1)%n].y - p.y));
        const maxEdge = Math.max(...edgeLens);
        const minEdge = Math.min(...edgeLens);
        const edgeVariance = maxEdge / (minEdge + 1e-9);
        if (edgeVariance < 1.3 && n >= 8) continue; // circle

        let orthoCorners = 0;
        for (let i = 0; i < n; i++) {
          const a = pts[(i-1+n)%n]; const b = pts[i]; const c = pts[(i+1)%n];
          const abx = b.x-a.x; const aby = b.y-a.y;
          const bcx = c.x-b.x; const bcy = c.y-b.y;
          const cross = Math.abs(abx*bcy - aby*bcx);
          const dot = abx*bcx + aby*bcy;
          const angle = Math.abs(Math.atan2(cross, dot) * 180 / Math.PI);
          if (angle > 70 && angle < 110) orthoCorners++;
        }
        const score = Math.log(area + 1) + (orthoCorners / n) * 5;
        candidates.push({ points: pts, area, score });
      }
    }

    if (candidates.length === 0) return [];
    candidates.sort((a, b) => b.score - a.score || b.area - a.area);
    const best = candidates[0];
    this.logger.log(`DXF LINE-based: best loop n=${best.points.length} area=${best.area.toFixed(0)} score=${best.score.toFixed(2)}`);
    return best.points;
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
      const cacheKey = `vision-bim:v5:${modelForKey}:${hash}`;
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
                text: `Extract the exterior building footprint as a CLOSED polygon (top-down plan view).

CRITICAL — IS THIS A 3D VIEW?
If this image shows a building in perspective, isometric, or 3D (you can see walls, a roof, and depth):
- You MUST reconstruct the TOP-DOWN plan footprint — NOT trace the visible outline/silhouette.
- A rectangular building in 3D perspective looks like a hexagon or pentagon — but the real footprint is a RECTANGLE with EXACTLY 4 vertices and 4 walls.
- Ask yourself: "Is this building a simple box?" If yes → output exactly 4 vertices: [{x:0,y:0}, {x:W,y:0}, {x:W,y:D}, {x:0,y:D}].
- Estimate W (width) and D (depth) from proportions. A 2-story house ~12m long and ~6m deep = vertices in mm.
- IGNORE terraces, ramps, canopies — they are NOT the building footprint.
- NEVER output 5 or 6 vertices for a rectangular building. That means you traced the perspective outline.

COORDINATE SYSTEM: x increases RIGHT, y increases DOWNWARD (image pixel coords). Top-left = {x:0,y:0}.

JAPANESE SCAFFOLD PLANS (仮設計画図): The blue hatched/filled zone is the SCAFFOLD AREA, NOT the building. Trace the INNER edge (building wall face).

VERTEX COUNT GUIDE: rectangle=4, trapezoid=4, L-shape=6. If you output 5+ vertices for a simple box building, you are WRONG — go back and output 4.

Read dimension strings for wall lengths. Return raw JSON only. Include vertices, buildingHeightMm, wallLengthsMm (same count as vertices), wallLengthsFromDimText, scaleDenominator, scaffoldTypeHint, spanSizeMm, floorCount, confidence.`,
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
        // Skip quoted strings (handles both depth=0 preamble and depth>0 values)
        if (c === '"') {
          i++;
          while (i < cleaned.length) {
            if (cleaned[i] === '\\') i += 2;
            else if (cleaned[i] === '"') { i++; break; }
            else i++;
          }
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
      let jsonStr = cleaned.slice(start, end + 1);

      // Repair common AI JSON errors before parsing:
      // 1. Trailing commas before } or ]
      jsonStr = jsonStr.replace(/,(\s*[}\]])/g, '$1');
      // 2. Single-quoted strings → double-quoted
      jsonStr = jsonStr.replace(/'([^'\\]*(\\.[^'\\]*)*)'/g, '"$1"');
      // 3. Unquoted keys (word chars followed by colon not inside string)
      jsonStr = jsonStr.replace(/([{,]\s*)([a-zA-Z_][a-zA-Z0-9_]*)(\s*:)/g, '$1"$2"$3');

      let parsed: VisionFootprintResult;
      try {
        parsed = JSON.parse(jsonStr) as VisionFootprintResult;
      } catch (parseErr) {
        // Log the raw response for debugging and re-throw with context
        this.logger.error(
          `JSON parse failed. Raw AI response (first 500 chars): ${text.slice(0, 500)}`,
        );
        throw new Error(`Vision model returned invalid JSON: ${(parseErr as Error).message}`);
      }

      this.logger.log(
        `Vision BIM raw response: ${parsed.vertices?.length ?? 0} vertices, ` +
        `height=${parsed.buildingHeightMm}mm, wallLengths=${JSON.stringify(parsed.wallLengthsMm ?? 'none')}, ` +
        `wallHeights=${JSON.stringify((parsed as any).wallHeightsMm ?? 'none')}`,
      );

      if (!parsed.vertices || !Array.isArray(parsed.vertices) || parsed.vertices.length < 3) {
        throw new Error('Vision returned invalid footprint vertices');
      }

      // Post-processing: detect "perspective silhouette hexagon" pattern from 3D views.
      // When AI traces a 3D perspective view of a rectangular building, it often returns
      // 6 vertices with alternating edge lengths (A,B,A,B,A,B) — the visible hexagonal outline.
      // Fix: collapse to the 4-vertex rectangle (A,B,A,B).
      parsed.vertices = this.fixPerspectiveHexagon(parsed);

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
      // Validate and normalize wallHeightsMm (per-edge heights for stepped buildings)
      if (Array.isArray((parsed as any).wallHeightsMm)) {
        let wallHeights = (parsed as any).wallHeightsMm as number[];
        if (wallHeights.length === n && wallHeights.every((h: any) => typeof h === 'number' && h > 0)) {
          const maxH = Math.max(...wallHeights);
          if (maxH < 100) {
            wallHeights = wallHeights.map((h) => Math.round(h * 1000));
            this.logger.warn(`wallHeightsMm auto-converted from m→mm (max was ${maxH})`);
          }
          if (wallHeights.every((h) => h >= 1000)) {
            parsed.wallHeightsMm = wallHeights;
            this.logger.log(`wallHeightsMm: ${wallHeights.map((h) => `${h}mm`).join(', ')}`);
          } else {
            parsed.wallHeightsMm = undefined;
          }
        } else {
          parsed.wallHeightsMm = undefined;
        }
        // If all per-wall heights are the same, drop the array (buildingHeightMm alone suffices)
        if (parsed.wallHeightsMm) {
          const unique = new Set(parsed.wallHeightsMm);
          if (unique.size === 1) {
            parsed.wallHeightsMm = undefined;
          }
        }
      } else {
        parsed.wallHeightsMm = undefined;
      }
      if (parsed.scaffoldTypeHint !== 'kusabi' && parsed.scaffoldTypeHint !== 'wakugumi') {
        parsed.scaffoldTypeHint = undefined;
      }
      if (typeof parsed.frameSizeMm !== 'number' || ![1700, 1800, 1900].includes(parsed.frameSizeMm)) {
        parsed.frameSizeMm = undefined;
      }
      if (Array.isArray((parsed as any).massingTiers) && (parsed as any).massingTiers.length > 0) {
        const maxBuildingH = parsed.buildingHeightMm;
        parsed.massingTiers = ((parsed as any).massingTiers as any[])
          .filter(
            (tier) =>
              tier &&
              Array.isArray(tier.vertices) &&
              tier.vertices.length >= 3 &&
              typeof tier.topHeightMm === 'number' &&
              tier.topHeightMm >= 1000,
          )
          .map((tier) => ({
            vertices: tier.vertices as Array<{ x: number; y: number } | { xFrac: number; yFrac: number }>,
            topHeightMm: Math.min(maxBuildingH, Math.max(1000, Math.round(tier.topHeightMm))),
            baseHeightMm:
              typeof tier.baseHeightMm === 'number'
                ? Math.max(0, Math.round(tier.baseHeightMm))
                : undefined,
          }))
          .filter((tier) => (tier.baseHeightMm ?? 0) < tier.topHeightMm)
          .sort((a, b) => (a.baseHeightMm ?? 0) - (b.baseHeightMm ?? 0) || a.topHeightMm - b.topHeightMm);
        if (parsed.massingTiers.length === 0) parsed.massingTiers = undefined;
      } else {
        parsed.massingTiers = undefined;
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
    const originalWallHeights =
      Array.isArray(parsed.wallHeightsMm) && parsed.wallHeightsMm.length === verts.length
        ? [...parsed.wallHeightsMm]
        : undefined;

    // Conservative: preserve intentional shape vertices.
    // L/U/T shapes have 6-8 vertices; multi-wing buildings may have 10-16.
    // Grid-tracing artifacts produce runs of 3+ equal-length edges on a straight wall.
    // Only simplify when there are clearly too many vertices.
    // Preserve at least 75% of original vertices to avoid over-simplification.
    const minVertices = Math.max(4, Math.ceil(verts.length * 0.75));

    const isMm = 'x' in verts[0];

    // Normalise to {x, y} in whatever unit the AI used (mm or 0-1 fraction).
    // Track original indices so wallHeightsMm can be remapped after cleanup.
    let indexed: Array<{ x: number; y: number; origIdx: number }> = verts.map((v, idx) =>
      isMm
        ? { x: (v as { x: number; y: number }).x, y: (v as { x: number; y: number }).y, origIdx: idx }
        : { x: (v as { xFrac: number; yFrac: number }).xFrac, y: (v as { xFrac: number; yFrac: number }).yFrac, origIdx: idx },
    );

    // ── Pass 1: remove duplicate / degenerate consecutive vertices ──────────
    const polyExtent = (arr: Array<{ x: number; y: number }>) => {
      const xs = arr.map((p) => p.x);
      const ys = arr.map((p) => p.y);
      return Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
    };
    const minDist = polyExtent(indexed) * 0.0005; // 0.05 % of extent
    indexed = indexed.filter((p, i, a) => {
      const next = a[(i + 1) % a.length];
      return Math.hypot(p.x - next.x, p.y - next.y) > minDist;
    });
    if (indexed.length < 4) return;

    // ── Pass 2: iteratively remove near-collinear vertices ───────────────────
    // Threshold: sin(angle at B) < 0.06 ≈ deviation ≤ 3.5°.
    // Very conservative to avoid removing valid corners of non-orthogonal
    // buildings with diagonal or angled walls.
    const SIN_THR = 0.06;
    let changed = true;
    while (changed && indexed.length > minVertices) {
      changed = false;
      for (let i = 0; i < indexed.length; i++) {
        const a = indexed[(i - 1 + indexed.length) % indexed.length];
        const b = indexed[i];
        const c = indexed[(i + 1) % indexed.length];
        const abx = b.x - a.x, aby = b.y - a.y;
        const bcx = c.x - b.x, bcy = c.y - b.y;
        const abLen = Math.hypot(abx, aby);
        const bcLen = Math.hypot(bcx, bcy);
        if (abLen < 1e-12 || bcLen < 1e-12) {
          indexed.splice(i, 1);
          changed = true;
          break;
        }
        const sinAngle = Math.abs(abx * bcy - aby * bcx) / (abLen * bcLen);
        if (sinAngle < SIN_THR) {
          if (originalWallHeights) {
            const prevEdgeHeight = originalWallHeights[a.origIdx];
            const nextEdgeHeight = originalWallHeights[b.origIdx];
            if (
              typeof prevEdgeHeight === 'number' &&
              typeof nextEdgeHeight === 'number' &&
              Math.abs(prevEdgeHeight - nextEdgeHeight) > 1
            ) {
              // Intentional collinear split: same facade line, different height zone.
              continue;
            }
          }
          indexed.splice(i, 1);
          changed = true;
          break;
        }
      }
    }

    const pts = indexed.map((p) => ({ x: p.x, y: p.y }));
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

    // Remap wallHeightsMm to match the surviving vertices.
    // For each kept vertex i, the outgoing edge inherits the max height
    // of all original edges that were merged into this new edge.
    if (Array.isArray(parsed.wallHeightsMm) && parsed.wallHeightsMm.length === verts.length) {
      const origHeights = parsed.wallHeightsMm;
      const keptOrigIndices = indexed.map((p) => p.origIdx);
      const newHeights: number[] = [];
      for (let i = 0; i < keptOrigIndices.length; i++) {
        const nextKept = keptOrigIndices[(i + 1) % keptOrigIndices.length];
        let maxH = 0;
        let idx = keptOrigIndices[i];
        while (true) {
          maxH = Math.max(maxH, origHeights[idx] ?? 0);
          if (idx === nextKept) break;
          idx = (idx + 1) % verts.length;
          if (idx === keptOrigIndices[i]) break;
        }
        newHeights.push(maxH || origHeights[keptOrigIndices[i]] || parsed.buildingHeightMm);
      }
      parsed.wallHeightsMm = newHeights;
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
      const xyzPoints: Array<{ x: number; y: number; z: number }> = [];

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
            xyzPoints.push({ x: tx, y: ty, z: tz });
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
      const pointsMm = xyzPoints.map((p) => ({ x: p.x * toMm, y: p.y * toMm, z: p.z * toMm }));
      const minZMm = minZ * toMm;
      const maxZMm = maxZ * toMm;

      // Try grid-based footprint extraction (captures L/U/T and complex shapes)
      const footprint = this.extractFootprintFromXY(
        xyzPoints.map((p) => ({ x: p.x, y: p.y })), minX, minY, maxX, maxY, toMm,
      );
      if (footprint && footprint.length >= 3) {
        const n = footprint.length;
        const wallLengthsMm = footprint.map((v, i) => {
          const next = footprint[(i + 1) % n];
          return Math.round(Math.hypot(next.x - v.x, next.y - v.y));
        });
        const wallHeightsMm = this.estimateWallHeightsFromIfcPoints(
          footprint,
          pointsMm,
          minZMm,
          maxZMm,
          buildingHeightMm,
        );
        this.logger.log(
          `IFC footprint: ${n} vertices (grid-based), height=${buildingHeightMm}mm, ` +
          `walls=${wallLengthsMm.join('/')}mm` +
          `${wallHeightsMm ? `, wallHeights=${wallHeightsMm.join('/')}mm` : ''}`,
        );
        return {
          vertices: footprint,
          buildingHeightMm,
          wallLengthsMm,
          ...(wallHeightsMm && { wallHeightsMm }),
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
        wallHeightsMm: [buildingHeightMm, buildingHeightMm, buildingHeightMm, buildingHeightMm],
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

    // Keep small gaps closed without over-inflating the footprint into a rectangle.
    this.dilateGrid(grid, gw, gh, Math.max(1, Math.ceil(600 / cellMm)));
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
   * Trace occupied-cell contour by extracting exposed cell edges and stitching
   * them into closed loops. This preserves concave and multi-wing perimeters
   * better than row/column envelope tracing.
   */
  private extractBoundaryFromGrid(
    grid: Uint8Array, w: number, h: number,
    originXMm: number, originYMm: number, cellMm: number,
  ): Array<{ x: number; y: number }> {
    const isOcc = (gx: number, gy: number) =>
      gx >= 0 && gx < w && gy >= 0 && gy < h && grid[gy * w + gx] === 1;

    type Edge = { sx: number; sy: number; ex: number; ey: number };
    const edges: Edge[] = [];
    const pushEdge = (sx: number, sy: number, ex: number, ey: number) => {
      edges.push({ sx, sy, ex, ey });
    };

    // Build directed boundary edges (clockwise around occupied region).
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (!isOcc(x, y)) continue;
        if (!isOcc(x, y - 1)) pushEdge(x, y, x + 1, y); // top
        if (!isOcc(x + 1, y)) pushEdge(x + 1, y, x + 1, y + 1); // right
        if (!isOcc(x, y + 1)) pushEdge(x + 1, y + 1, x, y + 1); // bottom
        if (!isOcc(x - 1, y)) pushEdge(x, y + 1, x, y); // left
      }
    }
    if (edges.length === 0) return [];

    const key = (x: number, y: number) => `${x},${y}`;
    const outgoing = new Map<string, number[]>();
    for (let i = 0; i < edges.length; i++) {
      const k = key(edges[i].sx, edges[i].sy);
      if (!outgoing.has(k)) outgoing.set(k, []);
      outgoing.get(k)!.push(i);
    }

    const used = new Uint8Array(edges.length);
    const loops: Array<Array<{ x: number; y: number }>> = [];

    for (let i = 0; i < edges.length; i++) {
      if (used[i]) continue;
      const e0 = edges[i];
      const startX = e0.sx;
      const startY = e0.sy;
      let curX = e0.ex;
      let curY = e0.ey;
      used[i] = 1;

      const loop: Array<{ x: number; y: number }> = [{ x: startX, y: startY }];
      const maxSteps = edges.length + 8;
      let steps = 0;
      while (steps++ < maxSteps) {
        loop.push({ x: curX, y: curY });
        if (curX === startX && curY === startY) break;
        const cand = outgoing.get(key(curX, curY)) ?? [];
        let nextIdx = -1;
        for (const ci of cand) {
          if (!used[ci]) {
            nextIdx = ci;
            break;
          }
        }
        if (nextIdx < 0) break;
        used[nextIdx] = 1;
        const en = edges[nextIdx];
        curX = en.ex;
        curY = en.ey;
      }

      if (loop.length >= 4 && loop[0].x === loop[loop.length - 1].x && loop[0].y === loop[loop.length - 1].y) {
        loops.push(loop);
      }
    }
    if (loops.length === 0) return [];

    const areaAbs = (poly: Array<{ x: number; y: number }>) => {
      let a = 0;
      for (let i = 0; i < poly.length - 1; i++) {
        const p = poly[i];
        const q = poly[i + 1];
        a += p.x * q.y - q.x * p.y;
      }
      return Math.abs(a / 2);
    };
    loops.sort((a, b) => areaAbs(b) - areaAbs(a));
    const best = loops[0];

    const mmX = (gx: number) => Math.round(originXMm + gx * cellMm);
    const mmY = (gy: number) => Math.round(originYMm + gy * cellMm);
    const pts = best.slice(0, -1).map((p) => ({ x: mmX(p.x), y: mmY(p.y) }));
    return pts;
  }

  /**
   * Estimate per-edge wall heights from IFC geometry by sampling point clouds
   * near each footprint edge. Used for stepped/tiered buildings where wall
   * heights differ by facade section.
   */
  private estimateWallHeightsFromIfcPoints(
    footprint: Array<{ x: number; y: number }>,
    pointsMm: Array<{ x: number; y: number; z: number }>,
    minZMm: number,
    maxZMm: number,
    buildingHeightMm: number,
  ): number[] | undefined {
    const n = footprint.length;
    if (n < 3 || pointsMm.length < 100) return undefined;

    const perimeter = footprint.reduce((sum, p, i) => {
      const q = footprint[(i + 1) % n];
      return sum + Math.hypot(q.x - p.x, q.y - p.y);
    }, 0);
    const bandMm = Math.max(300, Math.min(1200, perimeter / Math.max(1, n * 8)));
    const bandSq = bandMm * bandMm;

    // Keep runtime bounded on large IFCs.
    const sampleStride = Math.max(1, Math.ceil(pointsMm.length / 180000));
    const zSample: number[] = [];
    for (let i = 0; i < pointsMm.length; i += Math.max(1, sampleStride * 4)) {
      zSample.push(pointsMm[i].z);
    }
    zSample.sort((a, b) => a - b);
    const zAt = (q: number, fallback: number) =>
      zSample.length > 0
        ? zSample[Math.max(0, Math.min(zSample.length - 1, Math.floor((zSample.length - 1) * q)))]
        : fallback;
    const baseZ = zAt(0.02, minZMm);
    const topZ = zAt(0.98, maxZMm);
    const usableTop = Math.max(baseZ + 1000, topZ);

    const edges = footprint.map((p, i) => {
      const q = footprint[(i + 1) % n];
      return {
        x1: p.x,
        y1: p.y,
        x2: q.x,
        y2: q.y,
        minX: Math.min(p.x, q.x) - bandMm,
        maxX: Math.max(p.x, q.x) + bandMm,
        minY: Math.min(p.y, q.y) - bandMm,
        maxY: Math.max(p.y, q.y) + bandMm,
      };
    });
    const edgeZs: number[][] = Array.from({ length: n }, () => []);

    for (let pi = 0; pi < pointsMm.length; pi += sampleStride) {
      const p = pointsMm[pi];
      if (p.z < baseZ - 200 || p.z > usableTop + 300) continue;
      for (let ei = 0; ei < edges.length; ei++) {
        const e = edges[ei];
        if (p.x < e.minX || p.x > e.maxX || p.y < e.minY || p.y > e.maxY) continue;
        const d = this.pointToSegmentDist(p.x, p.y, e.x1, e.y1, e.x2, e.y2);
        if (d * d <= bandSq) edgeZs[ei].push(p.z);
      }
    }

    const heights = edgeZs.map((zs) => {
      if (zs.length < 8) return buildingHeightMm;
      zs.sort((a, b) => a - b);
      const p95 = zs[Math.floor((zs.length - 1) * 0.95)];
      const h = Math.round(Math.max(1000, Math.min(buildingHeightMm, p95 - baseZ)));
      return Math.round(h / 100) * 100;
    });

    const minH = Math.min(...heights);
    const maxH = Math.max(...heights);
    // Ignore near-uniform results; then global buildingHeightMm is sufficient.
    if (maxH - minH < 600) return undefined;
    return heights;
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

  /**
   * Detect and fix perspective silhouette artifacts from 3D BIM views.
   *
   * When an AI traces a 3D perspective/isometric view of a rectangular building,
   * it often returns 5–6 vertices instead of 4 — tracing the visible outline.
   * Patterns detected:
   * 1. 6-vertex hexagon with alternating edge lengths (A,B,A,B,A,B)
   * 2. 5-vertex pentagon with one abnormally long "diagonal" edge
   * 3. Any polygon where the bounding box suggests a rectangle but vertices > 4
   *
   * Fix: collapse to the 4-vertex bounding rectangle.
   */
  private fixPerspectiveHexagon(
    parsed: VisionFootprintResult,
  ): VisionFootprintResult['vertices'] {
    const verts = parsed.vertices;
    if (verts.length < 5 || verts.length > 8) return verts;

    const getCoord = (v: any): { x: number; y: number } => ({
      x: 'xFrac' in v ? v.xFrac : v.x,
      y: 'yFrac' in v ? v.yFrac : v.y,
    });

    const pts = verts.map(getCoord);
    const n = pts.length;

    const edges: number[] = [];
    for (let i = 0; i < n; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % n];
      edges.push(Math.hypot(b.x - a.x, b.y - a.y));
    }

    // --- Pattern 1: 6-vertex alternating hexagon ---
    if (n === 6) {
      const tol = 0.15;
      const groupA = [edges[0], edges[2], edges[4]];
      const groupB = [edges[1], edges[3], edges[5]];
      const avgA = groupA.reduce((s, v) => s + v, 0) / 3;
      const avgB = groupB.reduce((s, v) => s + v, 0) / 3;
      const aMatches = avgA > 0 && groupA.every((e) => Math.abs(e - avgA) / avgA < tol);
      const bMatches = avgB > 0 && groupB.every((e) => Math.abs(e - avgB) / avgB < tol);
      const ratio = Math.max(avgA, avgB) / Math.min(avgA, avgB);
      if (aMatches && bMatches && ratio >= 1.3) {
        this.logger.warn(`Detected perspective hexagon (A,B,A,B,A,B). Collapsing to rectangle.`);
        return this.buildRectFromDimensions(parsed, verts, edges);
      }
    }

    // --- Pattern 2: One edge is abnormally long (>2.5x median) ---
    const sorted = [...edges].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    const maxEdge = sorted[sorted.length - 1];
    if (maxEdge > median * 2.5 && n >= 5) {
      this.logger.warn(
        `Detected perspective silhouette: longest edge ${Math.round(maxEdge)} is >${Math.round(median * 2.5)} (2.5× median ${Math.round(median)}). Collapsing to rectangle.`,
      );
      return this.buildRectFromDimensions(parsed, verts, edges);
    }

    // --- Pattern 3: Bounding box is nearly rectangular but too many vertices ---
    const xs = pts.map((p) => p.x);
    const ys = pts.map((p) => p.y);
    const bboxW = Math.max(...xs) - Math.min(...xs);
    const bboxH = Math.max(...ys) - Math.min(...ys);
    const bboxArea = bboxW * bboxH;
    if (bboxArea > 0 && n >= 5) {
      // Compute polygon area using shoelace formula
      let polyArea = 0;
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        polyArea += pts[i].x * pts[j].y - pts[j].x * pts[i].y;
      }
      polyArea = Math.abs(polyArea) / 2;
      const fillRatio = polyArea / bboxArea;
      // If polygon fills >90% of its bounding box with 5+ vertices, it's a perspective distortion of a rectangle
      // (Real L-shapes fill ~75%, cut-corners fill ~95% but we only collapse 5+ vertex polygons)
      if (fillRatio > 0.90 && n >= 5) {
        this.logger.warn(
          `Detected near-rectangular polygon (${n} vertices, fill ratio ${(fillRatio * 100).toFixed(1)}%). Collapsing to rectangle.`,
        );
        return this.buildRectFromDimensions(parsed, verts, edges);
      }
    }

    return verts;
  }

  private buildRectFromDimensions(
    parsed: VisionFootprintResult,
    verts: VisionFootprintResult['vertices'],
    edges: number[],
  ): VisionFootprintResult['vertices'] {
    const isXfrac = 'xFrac' in verts[0];
    const getCoord = (v: any): { x: number; y: number } => ({
      x: isXfrac ? v.xFrac : v.x,
      y: isXfrac ? v.yFrac : v.y,
    });
    const pts = verts.map(getCoord);

    // Use bounding box of the polygon as the rectangle
    const xs = pts.map((p) => p.x);
    const ys = pts.map((p) => p.y);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const bboxW = maxX - minX;
    const bboxH = maxY - minY;

    // Use wallLengthsMm if available — cluster into two groups for W and D
    const wl = parsed.wallLengthsMm;
    if (wl && wl.length >= 4) {
      const sorted = [...wl].sort((a, b) => a - b);
      const medianLen = sorted[Math.floor(sorted.length / 2)];
      // Remove outlier edges (>2x median) that are perspective diagonals
      const reasonable = wl.filter((l) => l <= medianLen * 2.2);
      if (reasonable.length >= 2) {
        // Cluster remaining into "short" and "long" groups
        const rSorted = [...reasonable].sort((a, b) => a - b);
        const mid = (rSorted[0] + rSorted[rSorted.length - 1]) / 2;
        const shorts = rSorted.filter((l) => l <= mid);
        const longs = rSorted.filter((l) => l > mid);
        const avgShort = shorts.length > 0
          ? Math.round(shorts.reduce((s, v) => s + v, 0) / shorts.length) : Math.round(rSorted[0]);
        const avgLong = longs.length > 0
          ? Math.round(longs.reduce((s, v) => s + v, 0) / longs.length) : Math.round(rSorted[rSorted.length - 1]);
        const width = Math.max(avgShort, avgLong);
        const depth = Math.min(avgShort, avgLong);
        parsed.wallLengthsMm = [width, depth, width, depth];
        this.logger.log(`Rectangle from wallLengthsMm: ${width}×${depth}mm`);
        if (isXfrac) {
          return [
            { xFrac: 0, yFrac: 0 }, { xFrac: width, yFrac: 0 },
            { xFrac: width, yFrac: depth }, { xFrac: 0, yFrac: depth },
          ] as any;
        }
        return [
          { x: 0, y: 0 }, { x: width, y: 0 },
          { x: width, y: depth }, { x: 0, y: depth },
        ] as any;
      }
    }

    // Fallback: use bounding box dimensions
    const width = Math.round(Math.max(bboxW, bboxH));
    const depth = Math.round(Math.min(bboxW, bboxH));
    if (isXfrac) {
      return [
        { xFrac: 0, yFrac: 0 }, { xFrac: width, yFrac: 0 },
        { xFrac: width, yFrac: depth }, { xFrac: 0, yFrac: depth },
      ] as any;
    }
    return [
      { x: 0, y: 0 }, { x: width, y: 0 },
      { x: width, y: depth }, { x: 0, y: depth },
    ] as any;
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
