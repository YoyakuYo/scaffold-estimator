/**
 * Phase 5 — gap #5 (and gap #10 base).
 *
 * Client-side DXF → procedural BIM extrusion.
 *
 * The DXF coming out of `dxf-parser` is just a flat list of entities with a
 * layer name on each one. We:
 *   1. Group polylines by layer name.
 *   2. Match layer names against wall/slab/window patterns (Japanese +
 *      English).
 *   3. Extrude wall polylines as 3 m tall walls.
 *   4. Use the outermost closed polygon as a ground slab.
 *   5. (Future / gap #10) lay windows on a grid along walls, generate roof.
 *
 * Outputs Three.js BufferGeometry-ready vertex/index arrays plus an
 * IFC-compatible elementType so the existing
 * `frontend/lib/ifc-bim-materials.ts` palette renders them with the right
 * material (brick walls, concrete slab, slate roof).
 *
 * Pure function — no Three.js import — so it stays test-friendly.
 */

// eslint-disable-next-line @typescript-eslint/no-var-requires
const DxfParser = require('dxf-parser');
import type { IfcElementType, IfcMeshData } from '@/lib/ifc-loader';

/** Default vertical wall height in mm (3 m) when DXF has no Z extents. */
const DEFAULT_WALL_HEIGHT_MM = 3000;
const DEFAULT_SLAB_THICKNESS_MM = 200;

/** Procedural windows on every wall longer than 4 m, every 3.5 m along the wall. */
const PROCEDURAL_WINDOW_SPACING_MM = 3500;
const PROCEDURAL_WINDOW_WIDTH_MM = 1800;
const PROCEDURAL_WINDOW_HEIGHT_MM = 1500;
const PROCEDURAL_WINDOW_SILL_MM = 900;

const WALL_LAYER_PATTERNS: RegExp[] = [
  /(壁|wall|kabe)/i,
];
const COLUMN_LAYER_PATTERNS: RegExp[] = [/(柱|column|hashira)/i];
const SLAB_LAYER_PATTERNS: RegExp[] = [/(slab|床|スラブ)/i];
const ROOF_LAYER_PATTERNS: RegExp[] = [/(roof|屋根|yane)/i];
const OPENING_LAYER_PATTERNS: RegExp[] = [/(window|窓|door|扉|opening)/i];

interface RawVertex {
  x: number;
  y: number;
}

interface DxfPolyline {
  vertices: RawVertex[];
  closed: boolean;
  layer: string;
}

export interface DxfBimBuildResult {
  meshes: IfcMeshData[];
  /** All distinct layer names that contained polylines. Diagnostic only. */
  layers: string[];
  /** Per-element-type mesh count, for the UI stats panel. */
  byType: Record<IfcElementType, number>;
  warnings: string[];
}

/**
 * Parse a DXF buffer (text or ArrayBuffer) and produce mesh data ready for
 * Three.js (interleaved x,y,z,nx,ny,nz vertices + indices).
 */
export function buildBimFromDxf(input: ArrayBuffer | string): DxfBimBuildResult {
  const text = typeof input === 'string' ? input : new TextDecoder('utf-8').decode(input);
  const parser = new DxfParser();
  const warnings: string[] = [];
  let dxf: any;
  try {
    dxf = parser.parse(text);
  } catch (err) {
    return {
      meshes: [],
      layers: [],
      byType: emptyByType(),
      warnings: [(err as Error)?.message || 'DXF parse failed'],
    };
  }
  if (!dxf?.entities || !Array.isArray(dxf.entities)) {
    return {
      meshes: [],
      layers: [],
      byType: emptyByType(),
      warnings: ['DXF has no entities'],
    };
  }

  const polylines: DxfPolyline[] = [];
  for (const ent of dxf.entities) {
    const layer = (ent?.layer as string | undefined) || '0';
    if (ent.type === 'LWPOLYLINE' || ent.type === 'POLYLINE') {
      const verts = (ent.vertices || ent.points || []) as Array<{
        x?: number;
        y?: number;
        0?: number;
        1?: number;
      }>;
      const cleaned: RawVertex[] = [];
      for (const v of verts) {
        const x = (v as any).x ?? (v as any)[0];
        const y = (v as any).y ?? (v as any)[1];
        if (typeof x === 'number' && typeof y === 'number') {
          cleaned.push({ x, y });
        }
      }
      if (cleaned.length < 2) continue;
      polylines.push({
        vertices: cleaned,
        closed: !!ent.shape || !!ent.closed,
        layer,
      });
    } else if (ent.type === 'LINE') {
      const a = ent.start;
      const b = ent.end;
      if (a && b && typeof a.x === 'number' && typeof b.x === 'number') {
        polylines.push({
          vertices: [
            { x: a.x, y: a.y },
            { x: b.x, y: b.y },
          ],
          closed: false,
          layer,
        });
      }
    }
  }

  const layers = Array.from(new Set(polylines.map((p) => p.layer))).sort();

  const meshes: IfcMeshData[] = [];
  const byType: Record<IfcElementType, number> = emptyByType();

  // Heuristic scaling: DXFs may be in mm or m. Use bounding box to detect.
  const scale = inferUnitScale(polylines);

  // 1) Slab from outermost closed polygon (largest area on slab/floor layer
  //    or any layer if no slab layer matched).
  const slabPoly = pickOutermostClosed(polylines, SLAB_LAYER_PATTERNS);
  if (slabPoly) {
    const m = extrudePolygonToMesh(
      slabPoly.vertices,
      0,
      DEFAULT_SLAB_THICKNESS_MM,
      'slab',
      scale,
    );
    if (m) {
      meshes.push(m);
      byType.slab += 1;
    }
  }

  // 2) Walls — closed polylines whose layer matches a wall pattern,
  //    OR (fallback) all closed polylines that aren't the slab. Walls now
  //    use a ribbon-with-real-holes extrusion so windows are actual cut-outs
  //    (gap #10b) — see extrudeWallRibbonWithWindows() below.
  const wallPolys = polylines.filter(
    (p) => p.closed && p.vertices.length >= 3 && matchesAny(p.layer, WALL_LAYER_PATTERNS),
  );
  const wallSource = wallPolys.length > 0 ? wallPolys : polylines.filter((p) => p.closed && p !== slabPoly);

  for (const poly of wallSource) {
    extrudeWallRibbonWithWindows(
      poly.vertices,
      DEFAULT_SLAB_THICKNESS_MM,
      DEFAULT_WALL_HEIGHT_MM,
      scale,
      meshes,
      byType,
    );
  }

  // 3) Columns — short stubs at column points; closed polylines on column layers.
  const columnPolys = polylines.filter(
    (p) => p.closed && matchesAny(p.layer, COLUMN_LAYER_PATTERNS),
  );
  for (const poly of columnPolys) {
    const m = extrudePolygonToMesh(
      poly.vertices,
      DEFAULT_SLAB_THICKNESS_MM,
      DEFAULT_WALL_HEIGHT_MM,
      'column',
      scale,
    );
    if (m) {
      meshes.push(m);
      byType.column += 1;
    }
  }

  // 4) Roof — same approach as slab but on roof layer. Falls back to the
  //    outermost slab polygon if no roof layer was tagged so the building
  //    always has a "top" plane.
  const roofPoly = pickOutermostClosed(polylines, ROOF_LAYER_PATTERNS) ?? slabPoly;
  if (roofPoly) {
    const m = extrudePolygonToMesh(
      roofPoly.vertices,
      DEFAULT_WALL_HEIGHT_MM + DEFAULT_SLAB_THICKNESS_MM,
      DEFAULT_SLAB_THICKNESS_MM,
      'roof',
      scale,
    );
    if (m) {
      meshes.push(m);
      byType.roof += 1;
    }
  }

  // 5) (Procedural windows are now baked into the wall ribbon above as real
  //    cut-outs; the old applique-on-outside-face helper is gone.)
  // 6) Explicit openings on a "window" / "door" layer, when the DXF carries
  //    them as small rectangles. Treat each closed polyline as a window pane
  //    of its own bounding box.
  const explicitOpenings = polylines.filter(
    (p) => p.closed && p.vertices.length >= 3 && matchesAny(p.layer, OPENING_LAYER_PATTERNS),
  );
  for (const op of explicitOpenings) {
    const m = extrudePolygonToMesh(
      op.vertices,
      PROCEDURAL_WINDOW_SILL_MM,
      PROCEDURAL_WINDOW_HEIGHT_MM,
      'window',
      scale,
    );
    if (m) {
      meshes.push(m);
      byType.window += 1;
    }
  }

  if (meshes.length === 0) {
    warnings.push(
      'DXF contained no closed polylines we could extrude. Expected at least one wall/floor outline.',
    );
  }

  return { meshes, layers, byType, warnings };
}

/**
 * Gap #10 follow-up — real window holes.
 *
 * Walls are emitted as zero-thickness ribbons running along each polygon
 * edge. For every window position along an edge we split the ribbon into
 * three solid rectangles (left wall, sill below, lintel above) and emit a
 * separate glass pane for the aperture. The result is real cut-outs that
 * read correctly from inside or outside, with no CSG dependency and no
 * applique-on-outside-face artefacts.
 *
 * Layout per edge (mm coordinates along the edge, height coordinates in
 * scene metres):
 *
 *   |solid|sill|gl| sill | gl |sill|solid|
 *   |solid|----|gl|------| gl |----|solid|
 *   |solid|----|gl|------| gl |----|solid|
 *
 * — except sill/lintel only appear at window positions, with full-height
 * solid wall everywhere else.
 *
 * Windows are skipped on edges shorter than 4 m, and pulled 200 mm in from
 * each corner so frames don't overlap mullions.
 */
function extrudeWallRibbonWithWindows(
  verts: RawVertex[],
  baseMm: number,
  heightMm: number,
  scale: number,
  meshes: IfcMeshData[],
  byType: Record<IfcElementType, number>,
): void {
  const M = (mm: number) => (mm * scale) / 1000;
  const baseY = M(baseMm);
  const topY = M(baseMm + heightMm);
  const sillY = M(baseMm + PROCEDURAL_WINDOW_SILL_MM);
  const headY = M(baseMm + PROCEDURAL_WINDOW_SILL_MM + PROCEDURAL_WINDOW_HEIGHT_MM);

  for (let i = 0; i < verts.length; i++) {
    const a = verts[i];
    const b = verts[(i + 1) % verts.length];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const lenDxf = Math.hypot(dx, dy);
    if (lenDxf <= 0) continue;
    const ux = dx / lenDxf;
    const uy = dy / lenDxf;
    const lenMm = lenDxf * scale;
    // Outward normal (right-hand of the edge direction in plan).
    const nxOut = uy;
    const nzOut = -ux;

    // Compute window apertures along this edge in mm-from-edge-start.
    const windows: Array<{ startMm: number; endMm: number }> = [];
    if (lenMm >= 4000) {
      const count = Math.max(1, Math.floor(lenMm / PROCEDURAL_WINDOW_SPACING_MM));
      const cornerMargin = 200; // mm
      const half = PROCEDURAL_WINDOW_WIDTH_MM / 2;
      for (let w = 0; w < count; w++) {
        const center = ((w + 0.5) / count) * lenMm;
        const start = Math.max(cornerMargin, center - half);
        const end = Math.min(lenMm - cornerMargin, center + half);
        if (end > start) windows.push({ startMm: start, endMm: end });
      }
    }

    let cursor = 0;
    for (const win of windows) {
      // Solid wall section before the window (full height).
      pushWallQuad(
        a, ux, uy, nxOut, nzOut, scale,
        cursor, win.startMm, baseY, topY,
        meshes, byType, 'wall',
      );
      // Sill (below the aperture).
      pushWallQuad(
        a, ux, uy, nxOut, nzOut, scale,
        win.startMm, win.endMm, baseY, sillY,
        meshes, byType, 'wall',
      );
      // Lintel (above the aperture).
      pushWallQuad(
        a, ux, uy, nxOut, nzOut, scale,
        win.startMm, win.endMm, headY, topY,
        meshes, byType, 'wall',
      );
      // Glass pane in the aperture — same plane as the wall, glass material.
      pushWallQuad(
        a, ux, uy, nxOut, nzOut, scale,
        win.startMm, win.endMm, sillY, headY,
        meshes, byType, 'window',
      );
      cursor = win.endMm;
    }
    // Trailing solid wall section to the edge end (full height).
    pushWallQuad(
      a, ux, uy, nxOut, nzOut, scale,
      cursor, lenMm, baseY, topY,
      meshes, byType, 'wall',
    );
  }
}

/**
 * Emit a single zero-thickness rectangle (one quad, two triangles) along
 * the given edge, bounded by [startMm, endMm] horizontally and [yLow, yHigh]
 * vertically (already in scene metres for Y). The face uses the supplied
 * outward normal, but the wall material set is DoubleSide so it renders
 * correctly when viewed from inside too.
 */
function pushWallQuad(
  edgeStart: RawVertex,
  ux: number,
  uy: number,
  nxOut: number,
  nzOut: number,
  scale: number,
  startMm: number,
  endMm: number,
  yLow: number,
  yHigh: number,
  meshes: IfcMeshData[],
  byType: Record<IfcElementType, number>,
  elementType: IfcElementType,
): void {
  if (endMm - startMm <= 1e-6) return;
  if (yHigh - yLow <= 1e-6) return;

  // Walk along the edge in DXF units. 1 mm = 1/scale DXF units.
  const dxfPerMm = 1 / scale;
  const sx = edgeStart.x + ux * startMm * dxfPerMm;
  const sy = edgeStart.y + uy * startMm * dxfPerMm;
  const ex = edgeStart.x + ux * endMm * dxfPerMm;
  const ey = edgeStart.y + uy * endMm * dxfPerMm;

  // Convert DXF coordinate to scene metres. scene_m = DXF * scale / 1000.
  const dxfToM = (v: number) => (v * scale) / 1000;

  const positions = [
    dxfToM(sx), yLow, dxfToM(sy),
    dxfToM(ex), yLow, dxfToM(ey),
    dxfToM(ex), yHigh, dxfToM(ey),
    dxfToM(sx), yHigh, dxfToM(sy),
  ];
  const normals = [
    nxOut, 0, nzOut,
    nxOut, 0, nzOut,
    nxOut, 0, nzOut,
    nxOut, 0, nzOut,
  ];
  const indices = [0, 1, 2, 0, 2, 3];

  const count = positions.length / 3;
  const interleaved = new Float32Array(count * 6);
  for (let i = 0; i < count; i++) {
    interleaved[i * 6] = positions[i * 3];
    interleaved[i * 6 + 1] = positions[i * 3 + 1];
    interleaved[i * 6 + 2] = positions[i * 3 + 2];
    interleaved[i * 6 + 3] = normals[i * 3];
    interleaved[i * 6 + 4] = normals[i * 3 + 1];
    interleaved[i * 6 + 5] = normals[i * 3 + 2];
  }

  meshes.push({
    vertices: interleaved,
    indices: new Uint32Array(indices),
    color: { r: 1, g: 1, b: 1, a: 1 },
    elementType,
    expressID: hashElementIdentity(elementType, [
      { x: sx, y: sy },
      { x: ex, y: ey },
    ]),
  });
  byType[elementType] += 1;
}

function emptyByType(): Record<IfcElementType, number> {
  return {
    wall: 0,
    slab: 0,
    roof: 0,
    window: 0,
    door: 0,
    beam: 0,
    column: 0,
    railing: 0,
    stair: 0,
    curtainWall: 0,
    covering: 0,
    footing: 0,
    plate: 0,
    member: 0,
    furniture: 0,
    opening: 0,
    unknown: 0,
  };
}

function matchesAny(text: string, patterns: RegExp[]): boolean {
  return patterns.some((re) => re.test(text));
}

function pickOutermostClosed(polys: DxfPolyline[], layerPatterns: RegExp[]): DxfPolyline | null {
  const candidates = polys.filter(
    (p) => p.closed && p.vertices.length >= 3 && matchesAny(p.layer, layerPatterns),
  );
  const list = candidates.length > 0 ? candidates : polys.filter((p) => p.closed && p.vertices.length >= 3);
  if (list.length === 0) return null;
  let best = list[0];
  let bestArea = Math.abs(polygonArea(best.vertices));
  for (let i = 1; i < list.length; i++) {
    const a = Math.abs(polygonArea(list[i].vertices));
    if (a > bestArea) {
      bestArea = a;
      best = list[i];
    }
  }
  return best;
}

function polygonArea(verts: RawVertex[]): number {
  let area = 0;
  for (let i = 0; i < verts.length; i++) {
    const j = (i + 1) % verts.length;
    area += verts[i].x * verts[j].y - verts[j].x * verts[i].y;
  }
  return area / 2;
}

/**
 * Walls and slabs come out 1000× too large or 1× depending on whether the DXF
 * is in mm or m. Detect by overall bounding-box span: > 200 likely mm; <= 200
 * likely m. Convert everything internally to mm so the existing scene scale
 * works.
 */
function inferUnitScale(polys: DxfPolyline[]): number {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of polys) {
    for (const v of p.vertices) {
      if (v.x < minX) minX = v.x;
      if (v.x > maxX) maxX = v.x;
      if (v.y < minY) minY = v.y;
      if (v.y > maxY) maxY = v.y;
    }
  }
  const span = Math.max(maxX - minX, maxY - minY);
  if (!Number.isFinite(span) || span <= 0) return 1;
  if (span < 200) return 1000; // metres → mm
  return 1; // already mm
}

/**
 * Extrude a 2D polygon between baseHeight..baseHeight+height (mm).
 * Triangulates with a fan from the polygon centroid (works for convex
 * polygons + most simple non-convex ones; pathological cases just look
 * slightly ugly — acceptable for a viewer).
 *
 * Returned mesh uses the same interleaved x,y,z,nx,ny,nz layout as the IFC
 * loader so it can ride through the existing material pipeline.
 */
/**
 * Extrude a closed 2D polygon (plan: x,y in mm after unit scaling) into
 * `IfcMeshData` for the BIM viewer. Exported for AI footprint → shell mesh.
 */
export function extrudePolygonToMesh(
  verts: RawVertex[],
  baseMm: number,
  heightMm: number,
  elementType: IfcElementType,
  scale: number,
): IfcMeshData | null {
  if (verts.length < 3) return null;
  // Convert to metres for Three.js scene (matches existing IFC scene scale).
  const M = (v: number) => (v * scale) / 1000;
  const baseY = M(baseMm);
  const topY = M(baseMm + heightMm);

  // Centroid in plan.
  let cx = 0;
  let cz = 0;
  for (const v of verts) {
    cx += v.x;
    cz += v.y;
  }
  cx /= verts.length;
  cz /= verts.length;

  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];

  // Bottom + top caps (fan from centroid).
  const bottomCenterIdx = positions.length / 3;
  positions.push(M(cx), baseY, M(cz));
  normals.push(0, -1, 0);
  const bottomVertStart = positions.length / 3;
  for (const v of verts) {
    positions.push(M(v.x), baseY, M(v.y));
    normals.push(0, -1, 0);
  }
  for (let i = 0; i < verts.length; i++) {
    const a = bottomVertStart + i;
    const b = bottomVertStart + ((i + 1) % verts.length);
    indices.push(bottomCenterIdx, b, a); // CW for downward face
  }

  const topCenterIdx = positions.length / 3;
  positions.push(M(cx), topY, M(cz));
  normals.push(0, 1, 0);
  const topVertStart = positions.length / 3;
  for (const v of verts) {
    positions.push(M(v.x), topY, M(v.y));
    normals.push(0, 1, 0);
  }
  for (let i = 0; i < verts.length; i++) {
    const a = topVertStart + i;
    const b = topVertStart + ((i + 1) % verts.length);
    indices.push(topCenterIdx, a, b); // CCW for upward face
  }

  // Side quads (per polygon edge).
  for (let i = 0; i < verts.length; i++) {
    const v0 = verts[i];
    const v1 = verts[(i + 1) % verts.length];
    const ex = M(v1.x) - M(v0.x);
    const ez = M(v1.y) - M(v0.y);
    // Outward horizontal normal (perpendicular, rotated -90° from edge).
    let nxv = ez;
    let nzv = -ex;
    const nlen = Math.hypot(nxv, nzv) || 1;
    nxv /= nlen;
    nzv /= nlen;

    const baseIdx = positions.length / 3;
    positions.push(M(v0.x), baseY, M(v0.y));
    normals.push(nxv, 0, nzv);
    positions.push(M(v1.x), baseY, M(v1.y));
    normals.push(nxv, 0, nzv);
    positions.push(M(v1.x), topY, M(v1.y));
    normals.push(nxv, 0, nzv);
    positions.push(M(v0.x), topY, M(v0.y));
    normals.push(nxv, 0, nzv);

    indices.push(baseIdx, baseIdx + 1, baseIdx + 2);
    indices.push(baseIdx, baseIdx + 2, baseIdx + 3);
  }

  // Pack into the same interleaved layout that the IFC loader uses
  // (x,y,z,nx,ny,nz per vertex).
  const count = positions.length / 3;
  const interleaved = new Float32Array(count * 6);
  for (let i = 0; i < count; i++) {
    interleaved[i * 6] = positions[i * 3];
    interleaved[i * 6 + 1] = positions[i * 3 + 1];
    interleaved[i * 6 + 2] = positions[i * 3 + 2];
    interleaved[i * 6 + 3] = normals[i * 3];
    interleaved[i * 6 + 4] = normals[i * 3 + 1];
    interleaved[i * 6 + 5] = normals[i * 3 + 2];
  }
  const idx = new Uint32Array(indices);
  return {
    vertices: interleaved,
    indices: idx,
    color: { r: 1, g: 1, b: 1, a: 1 },
    elementType,
    expressID: hashElementIdentity(elementType, verts),
  };
}

function hashElementIdentity(type: string, verts: RawVertex[]): number {
  // Stable per-extrusion id so getMaterialForElement can vary wallAlt picks.
  let h = 2166136261;
  for (const c of type) h = (h ^ c.charCodeAt(0)) * 16777619;
  for (const v of verts) {
    h = (h ^ Math.round(v.x)) * 16777619;
    h = (h ^ Math.round(v.y)) * 16777619;
  }
  return Math.abs(h) % 1_000_000;
}
