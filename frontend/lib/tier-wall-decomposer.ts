/**
 * Tier-Wall Decomposer for Stepped/Setback Buildings
 *
 * Decomposes a building with massingTiers into independent tier-walls,
 * where each tier has its own perimeter and scaffold runs. Upper tiers
 * with smaller footprints produce shorter walls with fewer spans.
 *
 * Example: A building that steps back on the east side
 *   Tier 1 (0-9m): east wall = 20m
 *   Tier 2 (9-18m): east wall = 16m (building is narrower here)
 *   Tier 3 (18-27m): east wall = 12m
 *
 * Each tier-wall is an independent wall with its own wallLengthMm,
 * wallHeightMm, and baseHeightMm. The calculator runs span fitting
 * independently on each, producing fewer spans for shorter walls.
 */

import type { WallInput, BuildingMassingTier } from './api/scaffold-configs';

interface TierPerimeter {
  tierIndex: number;
  baseHeightMm: number;
  topHeightMm: number;
  sourceIndex?: number;
  edges: Array<{
    lengthMm: number;
    direction: number; // angle in radians
    startX: number;
    startY: number;
  }>;
  vertices: Array<{ x: number; y: number }>;
}

export interface DecomposedTierWallsResult {
  walls: WallInput[];
  massingTiers?: BuildingMassingTier[];
}

/**
 * Decompose walls + massingTiers into tier-walls.
 *
 * @param walls - Original wall array (ground-level perimeter)
 * @param massingTiers - Stacked building volumes with different footprints
 * @param buildingHeightMm - Total building height
 * @returns Expanded wall array with tier-walls (each has baseHeightMm, tierGroup, tierIndex)
 */
export function decomposeTierWalls(
  walls: WallInput[],
  massingTiers: BuildingMassingTier[],
  buildingHeightMm: number,
): DecomposedTierWallsResult {
  if (!massingTiers || massingTiers.length === 0) return { walls, massingTiers };

  const sorted = [...massingTiers]
    .filter((t) => Array.isArray(t.vertices) && t.vertices.length >= 3)
    .sort((a, b) => (a.baseHeightMm ?? 0) - (b.baseHeightMm ?? 0));

  if (sorted.length === 0) return { walls, massingTiers };

  const tiers = normalizeTiers(sorted, walls, buildingHeightMm);
  if (tiers.length === 0) return { walls, massingTiers: sorted };

  const result: WallInput[] = [];
  const rotatedMassingTiers = sorted.map((tier) => ({
    ...tier,
    vertices: Array.isArray(tier.vertices) ? [...tier.vertices] : tier.vertices,
  }));
  let tierWallSeq = 0;

  for (let ti = 0; ti < tiers.length; ti++) {
    const tier = tiers[ti];
    const tierHeight = tier.topHeightMm - tier.baseHeightMm;
    if (tierHeight <= 0) continue;

    const previousTier = ti > 0 ? tiers[ti - 1] : undefined;
    const exteriorRun = previousTier ? findExteriorEdgeRun(tier, previousTier) : null;
    const edgeOrder = exteriorRun
      ? Array.from({ length: exteriorRun.edgeCount }, (_, idx) => (exteriorRun.startEdgeIndex + idx) % tier.edges.length)
      : Array.from({ length: tier.edges.length }, (_, idx) => idx);

    if (
      exteriorRun &&
      tier.sourceIndex != null &&
      tier.sourceIndex >= 0 &&
      tier.sourceIndex < rotatedMassingTiers.length
    ) {
      const sourceTier = rotatedMassingTiers[tier.sourceIndex]!;
      sourceTier.vertices = rotateArray(sourceTier.vertices, exteriorRun.startEdgeIndex);
    }

    for (const ei of edgeOrder) {
      const edge = tier.edges[ei];
      if (edge.lengthMm < 300) continue;

      const matchedWall = matchEdgeToWall(edge, walls);
      const baseSide = matchedWall?.side ?? `edge-${ei}`;
      const tierLabel = tiers.length > 1 ? `-T${ti + 1}` : '';

      result.push({
        // Unique ids: several tier edges can match the same ground wall (same baseSide);
        // duplicate `side` values break plan labels (辺4 twice) and config keys.
        side: `edge-${tierWallSeq++}`,
        wallLengthMm: Math.round(edge.lengthMm),
        wallHeightMm: tierHeight,
        stairAccessCount: ti === 0 ? (matchedWall?.stairAccessCount ?? 0) : 0,
        kaidanCount: ti === 0 ? matchedWall?.kaidanCount : undefined,
        kaidanOffsets: ti === 0 ? matchedWall?.kaidanOffsets : undefined,
        scaffoldWidthMm: matchedWall?.scaffoldWidthMm,
        baseHeightMm: tier.baseHeightMm,
        tierGroup: `${baseSide}${tierLabel}`,
        tierIndex: ti,
      });
    }
  }

  return {
    walls: result.length > 0 ? result : walls,
    massingTiers: rotatedMassingTiers,
  };
}

/**
 * Convert massingTiers into normalized tier perimeters with edges.
 * Handles both absolute coordinates and fractional coordinates.
 */
function normalizeTiers(
  sorted: BuildingMassingTier[],
  walls: WallInput[],
  buildingHeightMm: number,
): TierPerimeter[] {
  const tiers: TierPerimeter[] = [];

  // Compute ground-level bounding box from walls for fractional coordinate resolution
  const totalPerimeter = walls.reduce((sum, w) => sum + w.wallLengthMm, 0);
  const avgSide = totalPerimeter / Math.max(walls.length, 1);

  for (let i = 0; i < sorted.length; i++) {
    const tier = sorted[i];
    const baseH = tier.baseHeightMm ?? 0;
    const topH = tier.topHeightMm;
    if (topH <= baseH) continue;

    const verts = resolveTierVertices(tier.vertices, walls, avgSide);
    if (verts.length < 3) continue;

    const edges: TierPerimeter['edges'] = [];
    for (let vi = 0; vi < verts.length; vi++) {
      const v1 = verts[vi];
      const v2 = verts[(vi + 1) % verts.length];
      const dx = v2.x - v1.x;
      const dy = v2.y - v1.y;
      const len = Math.hypot(dx, dy);
      edges.push({
        lengthMm: len,
        direction: Math.atan2(dy, dx),
        startX: v1.x,
        startY: v1.y,
      });
    }

    tiers.push({
      tierIndex: i,
      baseHeightMm: baseH,
      topHeightMm: topH,
      sourceIndex: i,
      edges,
      vertices: verts,
    });
  }

  // If tiers don't cover ground to top, add a ground tier from the original walls
  if (tiers.length > 0 && (tiers[0].baseHeightMm > 0 || !tiersCoverGround(tiers, walls))) {
    const groundTier = createGroundTier(walls, tiers[0].baseHeightMm || buildingHeightMm, buildingHeightMm);
    if (groundTier) tiers.unshift(groundTier);
  }

  return tiers;
}

/**
 * Resolve tier vertices from fractional, pixel, or absolute mm coordinates to mm.
 */
function resolveTierVertices(
  vertices: BuildingMassingTier['vertices'],
  walls: WallInput[],
  avgSide: number,
): Array<{ x: number; y: number }> {
  const raw = vertices.map((v) => {
    if ('xFrac' in v && 'yFrac' in v) {
      return { x: (v as any).xFrac as number, y: (v as any).yFrac as number, isFrac: true };
    }
    const av = v as { x: number; y: number };
    return { x: av.x, y: av.y, isFrac: false };
  });

  if (raw.length === 0) return [];

  const xs = raw.map((p) => p.x);
  const ys = raw.map((p) => p.y);
  const maxCoord = Math.max(Math.max(...xs.map(Math.abs)), Math.max(...ys.map(Math.abs)));
  const spreadX = Math.max(...xs) - Math.min(...xs);
  const spreadY = Math.max(...ys) - Math.min(...ys);
  const maxSpread = Math.max(spreadX, spreadY);

  const scaleFactor = walls.length > 0 ? Math.max(walls.length / 4, 1) : 1;

  if (maxCoord <= 1.1 && maxSpread <= 1.1) {
    // 0-1 fractional coords
    return raw.map((p) => ({
      x: p.x * avgSide * scaleFactor,
      y: p.y * avgSide * scaleFactor,
    }));
  }

  if (maxSpread > 1.1 && maxSpread < 3000) {
    // Pixel-scale coordinates: scale to mm using the same approach as wall vertices
    const target = Math.max(6000, avgSide * scaleFactor * 4);
    const scale = target / Math.max(maxSpread, 1);
    return raw.map((p) => ({ x: p.x * scale, y: p.y * scale }));
  }

  // Already in mm (maxSpread >= 3000)
  return raw.map((p) => ({ x: p.x, y: p.y }));
}

/**
 * Check if the existing tiers already include a ground-level tier.
 */
function tiersCoverGround(tiers: TierPerimeter[], walls: WallInput[]): boolean {
  return tiers.some((t) => t.baseHeightMm <= 0 && t.edges.length >= walls.length);
}

/**
 * Create a ground-level tier from the original walls.
 */
function createGroundTier(
  walls: WallInput[],
  topHeightMm: number,
  _buildingHeightMm: number,
): TierPerimeter | null {
  if (walls.length < 2) return null;

  // Build a polygon from wall lengths (simple orthogonal walk)
  const verts: Array<{ x: number; y: number }> = [];
  let x = 0, y = 0;
  const n = walls.length;
  const angleStep = (2 * Math.PI) / n;

  for (let i = 0; i < n; i++) {
    verts.push({ x, y });
    const angle = -Math.PI / 2 + i * angleStep;
    x += walls[i].wallLengthMm * Math.cos(angle);
    y += walls[i].wallLengthMm * Math.sin(angle);
  }

  const edges: TierPerimeter['edges'] = [];
  for (let i = 0; i < verts.length; i++) {
    const v1 = verts[i];
    const v2 = verts[(i + 1) % verts.length];
    const dx = v2.x - v1.x;
    const dy = v2.y - v1.y;
    edges.push({
      lengthMm: Math.hypot(dx, dy),
      direction: Math.atan2(dy, dx),
      startX: v1.x,
      startY: v1.y,
    });
  }

  return {
    tierIndex: 0,
    baseHeightMm: 0,
    topHeightMm,
    edges,
    vertices: verts,
  };
}

/**
 * Match a tier edge to the closest original wall by direction similarity.
 */
function matchEdgeToWall(
  edge: TierPerimeter['edges'][0],
  walls: WallInput[],
): WallInput | null {
  if (walls.length === 0) return null;

  let bestWall: WallInput | null = null;
  let bestScore = -Infinity;

  // Build reference directions from wall ordering
  const n = walls.length;
  const angleStep = (2 * Math.PI) / n;

  for (let i = 0; i < walls.length; i++) {
    const wallDir = -Math.PI / 2 + i * angleStep;
    const angleDiff = Math.abs(normalizeAngle(edge.direction - wallDir));
    const dirScore = Math.cos(angleDiff); // 1.0 = same direction, -1 = opposite

    // Also consider length similarity
    const lenRatio = Math.min(edge.lengthMm, walls[i].wallLengthMm) /
                     Math.max(edge.lengthMm, walls[i].wallLengthMm, 1);

    const score = dirScore * 0.7 + lenRatio * 0.3;
    if (score > bestScore) {
      bestScore = score;
      bestWall = walls[i];
    }
  }

  return bestScore > 0.3 ? bestWall : null;
}

function normalizeAngle(a: number): number {
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a < -Math.PI) a += 2 * Math.PI;
  return a;
}

function rotateArray<T>(items: T[], startIndex: number): T[] {
  if (items.length === 0) return items;
  const start = ((startIndex % items.length) + items.length) % items.length;
  if (start === 0) return [...items];
  return [...items.slice(start), ...items.slice(0, start)];
}

function distancePointToLine(
  p: { x: number; y: number },
  a: { x: number; y: number },
  b: { x: number; y: number },
): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (len < 1e-6) return Math.hypot(p.x - a.x, p.y - a.y);
  return Math.abs(dx * (a.y - p.y) - (a.x - p.x) * dy) / len;
}

function segmentsCollinearlyOverlap(
  a1: { x: number; y: number },
  a2: { x: number; y: number },
  b1: { x: number; y: number },
  b2: { x: number; y: number },
): boolean {
  const adx = a2.x - a1.x;
  const ady = a2.y - a1.y;
  const bdx = b2.x - b1.x;
  const bdy = b2.y - b1.y;
  const aLen = Math.hypot(adx, ady);
  const bLen = Math.hypot(bdx, bdy);
  if (aLen < 1 || bLen < 1) return false;

  const dirCross = Math.abs((adx / aLen) * (bdy / bLen) - (ady / aLen) * (bdx / bLen));
  if (dirCross > 0.08) return false;

  const lineTol = Math.max(150, Math.min(aLen, bLen) * 0.03);
  if (distancePointToLine(b1, a1, a2) > lineTol || distancePointToLine(b2, a1, a2) > lineTol) {
    return false;
  }

  const ux = adx / aLen;
  const uy = ady / aLen;
  const projA1 = 0;
  const projA2 = aLen;
  const projB1 = (b1.x - a1.x) * ux + (b1.y - a1.y) * uy;
  const projB2 = (b2.x - a1.x) * ux + (b2.y - a1.y) * uy;
  const minA = Math.min(projA1, projA2);
  const maxA = Math.max(projA1, projA2);
  const minB = Math.min(projB1, projB2);
  const maxB = Math.max(projB1, projB2);
  const overlap = Math.min(maxA, maxB) - Math.max(minA, minB);
  return overlap > Math.max(300, Math.min(aLen, bLen) * 0.2);
}

function findExteriorEdgeRun(
  tier: TierPerimeter,
  lowerTier: TierPerimeter,
): { startEdgeIndex: number; edgeCount: number } | null {
  const currentEdgeCount = tier.vertices.length;
  const lowerEdgeCount = lowerTier.vertices.length;
  if (currentEdgeCount < 4 || lowerEdgeCount < 3) return null;

  const keep = Array.from({ length: currentEdgeCount }, (_, currentIdx) => {
    const c1 = tier.vertices[currentIdx]!;
    const c2 = tier.vertices[(currentIdx + 1) % currentEdgeCount]!;
    for (let lowerIdx = 0; lowerIdx < lowerEdgeCount; lowerIdx++) {
      const l1 = lowerTier.vertices[lowerIdx]!;
      const l2 = lowerTier.vertices[(lowerIdx + 1) % lowerEdgeCount]!;
      if (segmentsCollinearlyOverlap(c1, c2, l1, l2)) {
        return true;
      }
    }
    return false;
  });

  const keepCount = keep.filter(Boolean).length;
  if (keepCount === 0 || keepCount === currentEdgeCount) return null;

  let runStart = -1;
  let runCount = 0;
  let runTransitions = 0;
  for (let i = 0; i < currentEdgeCount; i++) {
    const curr = keep[i]!;
    const prev = keep[(i - 1 + currentEdgeCount) % currentEdgeCount]!;
    if (curr && !prev) {
      runTransitions++;
      if (runStart < 0) runStart = i;
    }
  }
  if (runTransitions !== 1 || runStart < 0) return null;

  while (runCount < currentEdgeCount && keep[(runStart + runCount) % currentEdgeCount]) {
    runCount++;
  }
  return runCount >= 2 ? { startEdgeIndex: runStart, edgeCount: runCount } : null;
}

/**
 * Check if a wall array contains tier-walls (has any baseHeightMm > 0).
 */
export function hasTierWalls(walls: WallInput[]): boolean {
  return walls.some((w) => (w.baseHeightMm ?? 0) > 0 || w.tierGroup != null);
}

/**
 * Get unique tier groups from a wall array.
 * Returns map of tierGroup → array of walls in that group, sorted by tierIndex.
 */
export function groupWallsByTier(
  walls: Array<{ side: string; tierGroup?: string; tierIndex?: number; [k: string]: any }>,
): Map<string, typeof walls> {
  const groups = new Map<string, typeof walls>();

  for (const wall of walls) {
    const group = wall.tierGroup ?? wall.side;
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group)!.push(wall);
  }

  // Sort each group by tierIndex
  for (const [, groupWalls] of groups) {
    groupWalls.sort((a, b) => (a.tierIndex ?? 0) - (b.tierIndex ?? 0));
  }

  return groups;
}
