import type { VisionFootprintResult } from '@/lib/api/vision-bim';
import { parseIfcToMeshes } from '@/lib/ifc-loader';

type Pt = { x: number; y: number };

function cross(o: Pt, a: Pt, b: Pt): number {
  return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
}

function convexHull(points: Pt[]): Pt[] {
  if (points.length <= 1) return points.slice();
  const pts = points
    .slice()
    .sort((p, q) => (p.x === q.x ? p.y - q.y : p.x - q.x));

  const lower: Pt[] = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) {
      lower.pop();
    }
    lower.push(p);
  }

  const upper: Pt[] = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) {
      upper.pop();
    }
    upper.push(p);
  }

  upper.pop();
  lower.pop();
  return lower.concat(upper);
}

function bbox(points: Array<{ x: number; y: number; z: number }>) {
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.z < minZ) minZ = p.z;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
    if (p.z > maxZ) maxZ = p.z;
  }
  return { minX, minY, minZ, maxX, maxY, maxZ };
}

function guessUnitScaleToMm(extent: number): number {
  // Heuristic: if the model's max XY extent is "small", it's probably in meters.
  // Typical houses are 6–30m; in mm they'd be 6000–30000.
  if (!isFinite(extent) || extent <= 0) return 1000;
  return extent < 500 ? 1000 : 1;
}

export async function extractFootprintFromIfcFile(file: File): Promise<VisionFootprintResult> {
  const buf = await file.arrayBuffer();
  const meshes = await parseIfcToMeshes(buf);

  // Focus on structural-ish element types for footprint.
  const keep = new Set(['wall', 'slab', 'roof', 'column', 'footing', 'member', 'beam']);
  const pts3: Array<{ x: number; y: number; z: number }> = [];

  for (const m of meshes) {
    if (!keep.has(m.elementType)) continue;
    const v = m.vertices;
    const stride = 6;
    const count = Math.floor(v.length / stride);
    // Downsample aggressively to keep hull work fast.
    const step = Math.max(1, Math.floor(count / 4000));
    for (let i = 0; i < count; i += step) {
      const base = i * stride;
      pts3.push({ x: v[base], y: v[base + 1], z: v[base + 2] });
    }
  }

  if (pts3.length < 10) {
    throw new Error('IFCの形状を読み取れませんでした。DXFまたは図面画像/PDFをお試しください。');
  }

  const b = bbox(pts3);
  const extent = Math.max(b.maxX - b.minX, b.maxY - b.minY);
  const scaleToMm = guessUnitScaleToMm(extent);

  // Project to XY and compute convex hull as an initial exterior outline.
  const pts2: Pt[] = pts3.map((p) => ({ x: (p.x - b.minX) * scaleToMm, y: (p.y - b.minY) * scaleToMm }));

  // Reduce duplicates (grid-hash).
  const seen = new Set<string>();
  const uniq: Pt[] = [];
  for (const p of pts2) {
    const k = `${Math.round(p.x)}:${Math.round(p.y)}`;
    if (seen.has(k)) continue;
    seen.add(k);
    uniq.push({ x: Math.round(p.x), y: Math.round(p.y) });
  }

  const hull = convexHull(uniq);
  if (hull.length < 3) {
    throw new Error('IFCの外形抽出に失敗しました。DXFまたは図面画像/PDFをお試しください。');
  }

  const heightMmRaw = (b.maxZ - b.minZ) * scaleToMm;
  const buildingHeightMm = heightMmRaw >= 1000 ? Math.round(heightMmRaw) : 3000;

  return {
    vertices: hull.map((p) => ({ x: p.x, y: p.y })),
    buildingHeightMm,
    drawingType: '3d',
    heightConfidence: 'medium',
  };
}

