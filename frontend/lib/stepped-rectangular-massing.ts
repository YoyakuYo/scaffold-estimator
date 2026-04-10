/**
 * Build stacked rectangular massing tiers (setback / wedding-cake) from editable
 * per-tier lengths along one axis. Fixed corner at origin; footprint grows in +X and +Y.
 */

import type { VisionMassingTier } from '@/lib/api/vision-bim';

export type TaperAxis = 'x' | 'y';

export type SteppedRectangularMassingParams = {
  /** Depth (mm) along Y when taperAxis is 'x' (constant across tiers). */
  depthMm: number;
  /** Length (mm) along X for each tier band, ground → roof (typically decreasing). */
  tierLengthsMm: number[];
  /** Vertical height (mm) of each tier band; must match tierLengthsMm.length. */
  tierHeightsMm: number[];
  /** Which horizontal axis shrinks: 'x' = length along X steps, Y depth constant. */
  taperAxis: TaperAxis;
};

function polygonAreaMm(verts: Array<{ x: number; y: number }>): number {
  if (verts.length < 3) return 0;
  let a = 0;
  for (let i = 0; i < verts.length; i++) {
    const j = (i + 1) % verts.length;
    a += verts[i]!.x * verts[j]!.y - verts[j]!.x * verts[i]!.y;
  }
  return Math.abs(a / 2);
}

/**
 * Vertices CCW: (0,0) → (L,0) → (L,W) → (0,W) when taperAxis is 'x' (L = tier length).
 */
export function buildRectangularSetbackMassingTiers(
  params: SteppedRectangularMassingParams,
): VisionMassingTier[] {
  const { depthMm, tierLengthsMm, tierHeightsMm, taperAxis } = params;
  const n = tierLengthsMm.length;
  if (n === 0 || tierHeightsMm.length !== n) return [];

  const W = Math.max(600, Math.round(depthMm));
  const out: VisionMassingTier[] = [];
  let base = 0;

  for (let i = 0; i < n; i++) {
    const L = Math.max(600, Math.round(tierLengthsMm[i]!));
    const h = Math.max(1000, Math.round(tierHeightsMm[i]!));
    const top = base + h;

    const vertices: Array<{ x: number; y: number }> =
      taperAxis === 'x'
        ? [
            { x: 0, y: 0 },
            { x: L, y: 0 },
            { x: L, y: W },
            { x: 0, y: W },
          ]
        : [
            { x: 0, y: 0 },
            { x: W, y: 0 },
            { x: W, y: L },
            { x: 0, y: L },
          ];

    out.push({
      vertices,
      baseHeightMm: base,
      topHeightMm: top,
    });
    base = top;
  }

  return out;
}

/**
 * Heuristic: 3D render, no tiers from AI — synthesize stepped rectangles from
 * ground outline bbox and estimated floor count.
 */
export function synthesizeSteppedTiersFrom3dHeuristic(params: {
  buildingHeightMm: number;
  floorCount: number;
  /** Longer horizontal span of ground footprint (mm). */
  baseLongMm: number;
  /** Shorter span (mm). */
  baseShortMm: number;
  /** Taper along the longer building side (typical for tower setbacks). */
  taperAlongLongEdge: boolean;
  /** 0..1 fraction: top tier length = base * (1 - totalSetback). */
  totalSetbackFraction: number;
}): VisionMassingTier[] | undefined {
  const {
    buildingHeightMm,
    floorCount,
    baseLongMm,
    baseShortMm,
    taperAlongLongEdge,
    totalSetbackFraction,
  } = params;
  const floors = Math.max(2, Math.min(40, Math.round(floorCount)));
  const H = Math.max(3000, buildingHeightMm);
  const bandH = H / floors;
  const longE = Math.max(600, baseLongMm);
  const shortE = Math.max(600, baseShortMm);
  const frac = Math.min(0.85, Math.max(0.05, totalSetbackFraction));

  /** Edge that shrinks each tier */
  const baseLen = taperAlongLongEdge ? longE : shortE;
  /** Constant depth (orthogonal to taper axis) */
  const depthMm = taperAlongLongEdge ? shortE : longE;

  const tierLengths: number[] = [];
  for (let i = 0; i < floors; i++) {
    const t = i / Math.max(1, floors - 1);
    const L = baseLen * (1 - t * frac);
    tierLengths.push(Math.round(Math.max(600, L)));
  }

  const tierHeights = Array.from({ length: floors }, () => Math.round(bandH));

  return buildRectangularSetbackMassingTiers({
    depthMm,
    tierLengthsMm: tierLengths,
    tierHeightsMm: tierHeights,
    taperAxis: taperAlongLongEdge ? 'x' : 'y',
  });
}

export function massingTiersFootprintAreaMm(tiers: VisionMassingTier[]): number[] {
  return tiers.map((t) => {
    const v = t.vertices as Array<{ x?: number; y?: number; xFrac?: number; yFrac?: number }>;
    const pts = v.map((p) => ({
      x: typeof p.xFrac === 'number' ? p.xFrac : (p.x ?? 0),
      y: typeof p.yFrac === 'number' ? p.yFrac : (p.y ?? 0),
    }));
    return polygonAreaMm(pts);
  });
}

export function massingTiersHaveDifferentFootprints(tiers: VisionMassingTier[]): boolean {
  if (!tiers || tiers.length < 2) return false;
  const counts = tiers.map((t) => (Array.isArray(t.vertices) ? t.vertices.length : 0));
  if (new Set(counts.filter((c) => c >= 3)).size > 1) return true;
  const areas = massingTiersFootprintAreaMm(tiers);
  const rounded = areas.map((a) => Math.round(a / 1_000_000)); // 1 m² buckets
  return new Set(rounded).size > 1;
}

function outlineBBox(
  outline: Array<{ xFrac?: number; yFrac?: number; x?: number; y?: number }>,
): { minX: number; minY: number; maxX: number; maxY: number; w: number; h: number } {
  const xs = outline.map((p) => (typeof p.xFrac === 'number' ? p.xFrac : (p.x ?? 0)));
  const ys = outline.map((p) => (typeof p.yFrac === 'number' ? p.yFrac : (p.y ?? 0)));
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const w = Math.max(maxX - minX, 1e-9);
  const h = Math.max(maxY - minY, 1e-9);
  return { minX, minY, maxX, maxY, w, h };
}

function tierLocalBBox(tier: VisionMassingTier): { minX: number; minY: number; w: number; h: number } {
  const verts = tier.vertices as Array<{ x?: number; y?: number; xFrac?: number; yFrac?: number }>;
  const xs = verts.map((v) => (typeof v.xFrac === 'number' ? v.xFrac : (v.x ?? 0)));
  const ys = verts.map((v) => (typeof v.yFrac === 'number' ? v.yFrac : (v.y ?? 0)));
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  return { minX, minY, w: Math.max(maxX - minX, 1e-9), h: Math.max(maxY - minY, 1e-9) };
}

/**
 * Map locally-built rectangular tiers (origin-based mm) into the same coordinate
 * system as `buildingOutline` (fraction or mm), preserving nested footprint look.
 */
export function remapRectangularTiersToOutline(
  outline: Array<{ xFrac?: number; yFrac?: number; x?: number; y?: number }>,
  tiers: VisionMassingTier[],
): VisionMassingTier[] {
  if (!outline || outline.length < 3 || !tiers.length) return tiers;
  const ob = outlineBBox(outline);
  const t0 = tiers[0];
  if (!t0?.vertices?.length) return tiers;
  const lb = tierLocalBBox(t0);

  const useFrac =
    outline.every((p) => typeof p.xFrac === 'number' && typeof p.yFrac === 'number') ||
    (ob.maxX <= 1.1 && ob.maxY <= 1.1);

  return tiers.map((tier) => ({
    ...tier,
    vertices: (tier.vertices as Array<{ x?: number; y?: number; xFrac?: number; yFrac?: number }>).map((v) => {
      const lx = typeof v.xFrac === 'number' ? v.xFrac : (v.x ?? 0);
      const ly = typeof v.yFrac === 'number' ? v.yFrac : (v.y ?? 0);
      const nx = ob.minX + ((lx - lb.minX) / lb.w) * ob.w;
      const ny = ob.minY + ((ly - lb.minY) / lb.h) * ob.h;
      if (useFrac) {
        return { xFrac: nx, yFrac: ny };
      }
      return { x: Math.round(nx), y: Math.round(ny) };
    }),
  }));
}
