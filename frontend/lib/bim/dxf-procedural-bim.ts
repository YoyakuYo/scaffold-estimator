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
  //    OR (fallback) all closed polylines that aren't the slab.
  const wallPolys = polylines.filter(
    (p) => p.closed && p.vertices.length >= 3 && matchesAny(p.layer, WALL_LAYER_PATTERNS),
  );
  const wallSource = wallPolys.length > 0 ? wallPolys : polylines.filter((p) => p.closed && p !== slabPoly);

  for (const poly of wallSource) {
    const m = extrudePolygonToMesh(
      poly.vertices,
      DEFAULT_SLAB_THICKNESS_MM,
      DEFAULT_WALL_HEIGHT_MM,
      'wall',
      scale,
    );
    if (m) {
      meshes.push(m);
      byType.wall += 1;
    }
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

  // 4) Roof — same approach as slab but on roof layer.
  const roofPoly = pickOutermostClosed(polylines, ROOF_LAYER_PATTERNS);
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

  if (meshes.length === 0) {
    warnings.push(
      'DXF contained no closed polylines we could extrude. Expected at least one wall/floor outline.',
    );
  }

  return { meshes, layers, byType, warnings };
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
function extrudePolygonToMesh(
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
