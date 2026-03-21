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
  edges: Array<{
    lengthMm: number;
    direction: number; // angle in radians
    startX: number;
    startY: number;
  }>;
  vertices: Array<{ x: number; y: number }>;
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
): WallInput[] {
  if (!massingTiers || massingTiers.length === 0) return walls;

  const sorted = [...massingTiers]
    .filter((t) => Array.isArray(t.vertices) && t.vertices.length >= 3)
    .sort((a, b) => (a.baseHeightMm ?? 0) - (b.baseHeightMm ?? 0));

  if (sorted.length === 0) return walls;

  const tiers = normalizeTiers(sorted, walls, buildingHeightMm);
  if (tiers.length === 0) return walls;

  const result: WallInput[] = [];
  let tierWallSeq = 0;

  for (let ti = 0; ti < tiers.length; ti++) {
    const tier = tiers[ti];
    const tierHeight = tier.topHeightMm - tier.baseHeightMm;
    if (tierHeight <= 0) continue;

    for (let ei = 0; ei < tier.edges.length; ei++) {
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

  return result.length > 0 ? result : walls;
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
 * Resolve tier vertices from fractional or absolute coordinates to mm.
 */
function resolveTierVertices(
  vertices: BuildingMassingTier['vertices'],
  walls: WallInput[],
  avgSide: number,
): Array<{ x: number; y: number }> {
  return vertices.map((v) => {
    if ('xFrac' in v && 'yFrac' in v) {
      return {
        x: (v as any).xFrac * avgSide * (walls.length / 4),
        y: (v as any).yFrac * avgSide * (walls.length / 4),
      };
    }
    const av = v as { x: number; y: number };
    // If values look like mm already (>100), use as-is; if fractional (<2), scale
    if (Math.abs(av.x) < 2 && Math.abs(av.y) < 2) {
      return {
        x: av.x * avgSide * (walls.length / 4),
        y: av.y * avgSide * (walls.length / 4),
      };
    }
    return { x: av.x, y: av.y };
  });
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
