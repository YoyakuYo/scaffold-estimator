/**
 * Infer rectangular stepped-draft fields from existing massing tiers (AI preview),
 * and rebuild preview state after the user edits tier lengths/heights.
 */

import type { BuildingMassingTier, CreateScaffoldConfigDto, WallInput } from '@/lib/api/scaffold-configs';
import type { VisionMassingTier } from '@/lib/api/vision-bim';
import { computeBimPreviewPlanToM, type BimPreviewVertex } from '@/lib/bim-preview-plan-coords';
import { ScaffoldManager } from '@/lib/scaffold-manager';
import {
  buildRectangularSetbackMassingTiers,
  remapRectangularTiersToOutline,
  type TaperAxis,
} from '@/lib/stepped-rectangular-massing';

export type SteppedMassingEditableDraft = {
  depthMm: number;
  taperAxis: TaperAxis;
  tierLengthsMm: number[];
  tierHeightsMm: number[];
};

function spanOfTierInPlanM(
  toPlanM: (verts: BimPreviewVertex[]) => Array<{ x: number; z: number }>,
  verts: BimPreviewVertex[],
): { sx: number; sz: number } {
  const pts = toPlanM(verts);
  if (pts.length < 2) return { sx: 0, sz: 0 };
  const xs = pts.map((p) => p.x);
  const zs = pts.map((p) => p.z);
  return {
    sx: Math.max(...xs) - Math.min(...xs),
    sz: Math.max(...zs) - Math.min(...zs),
  };
}

/**
 * Best-effort inference of taper axis and per-tier lengths/heights from stacked tiers.
 * Works for rectangular setback tiers aligned with the BIM preview scale.
 */
export function inferRectangularSteppedDraftFromMassingTiers(params: {
  outline: Array<{ xFrac?: number; yFrac?: number; x?: number; y?: number }>;
  massingTiers: VisionMassingTier[];
  wallLengthsMm: number[];
}): SteppedMassingEditableDraft | null {
  const { outline, massingTiers, wallLengthsMm } = params;
  if (!massingTiers?.length || outline.length < 3) return null;

  const sorted = [...massingTiers]
    .filter((t) => Array.isArray(t.vertices) && t.vertices.length >= 3)
    .sort((a, b) => (a.baseHeightMm ?? 0) - (b.baseHeightMm ?? 0));
  if (sorted.length === 0) return null;

  const { toPlanM } = computeBimPreviewPlanToM({
    outline,
    massingTiers: sorted,
    wallLengthsMm,
  });

  const first = spanOfTierInPlanM(toPlanM, sorted[0]!.vertices as BimPreviewVertex[]);
  const last = spanOfTierInPlanM(
    toPlanM,
    sorted[sorted.length - 1]!.vertices as BimPreviewVertex[],
  );
  const taperAlongX = Math.abs(first.sx - last.sx) >= Math.abs(first.sz - last.sz);
  const taperAxis: TaperAxis = taperAlongX ? 'x' : 'y';

  const tierLengthsMm = sorted.map((t) => {
    const { sx, sz } = spanOfTierInPlanM(toPlanM, t.vertices as BimPreviewVertex[]);
    const m = taperAxis === 'x' ? sx : sz;
    return Math.round(Math.max(600, m * 1000));
  });

  const tierHeightsMm = sorted.map((t) =>
    Math.round(Math.max(1000, (t.topHeightMm ?? 0) - (t.baseHeightMm ?? 0))),
  );

  const depthMm = Math.round(
    Math.max(600, (taperAxis === 'x' ? first.sz : first.sx) * 1000),
  );

  return { depthMm, taperAxis, tierLengthsMm, tierHeightsMm };
}

type AiPreviewForStepped = {
  buildingOutline: Array<{ xFrac: number; yFrac: number }>;
  walls: WallInput[];
  dto: CreateScaffoldConfigDto;
  buildingHeightMm: number;
  massingTiers?: VisionMassingTier[];
  massingWasSynthesized?: boolean;
};

export function applySteppedDraftToAiBimPreview(
  preview: AiPreviewForStepped,
  draft: SteppedMassingEditableDraft,
  manager: ScaffoldManager,
): AiPreviewForStepped & { massingTiers: VisionMassingTier[] } {
  const built = buildRectangularSetbackMassingTiers({
    depthMm: draft.depthMm,
    tierLengthsMm: draft.tierLengthsMm,
    tierHeightsMm: draft.tierHeightsMm,
    taperAxis: draft.taperAxis,
  });
  const remapped = remapRectangularTiersToOutline(preview.buildingOutline, built);
  const buildingHeightMm = draft.tierHeightsMm.reduce((s, h) => s + Math.max(0, h), 0);

  const { toPlanM } = computeBimPreviewPlanToM({
    outline: preview.buildingOutline,
    massingTiers: remapped,
    wallLengthsMm: preview.walls.map((w) => w.wallLengthMm),
  });
  const tier0Verts = remapped[0]?.vertices as BimPreviewVertex[] | undefined;
  if (!tier0Verts?.length) {
    return {
      ...preview,
      massingTiers: remapped,
      buildingHeightMm,
      dto: {
        ...preview.dto,
        massingTiers: remapped as BuildingMassingTier[],
      },
      massingWasSynthesized: false,
    };
  }

  const pts = toPlanM(tier0Verts);
  const groundVerticesMm = pts.map((p) => ({ x: p.x * 1000, y: p.z * 1000 }));

  let maxEdge = 0;
  for (let i = 0; i < groundVerticesMm.length; i++) {
    const j = (i + 1) % groundVerticesMm.length;
    maxEdge = Math.max(
      maxEdge,
      Math.hypot(groundVerticesMm[j]!.x - groundVerticesMm[i]!.x, groundVerticesMm[j]!.y - groundVerticesMm[i]!.y),
    );
  }

  const { walls: injWalls } = manager.injectFootprintAndGetWalls(
    groundVerticesMm,
    buildingHeightMm,
    maxEdge > 0 ? maxEdge : undefined,
  );

  const prev = preview.walls;
  const mergedWalls = injWalls.map((w, i) => {
    const p = prev[i];
    if (!p) return w;
    return {
      ...w,
      stairAccessCount: p.stairAccessCount,
      scaffoldWidthMm: p.scaffoldWidthMm,
      kaidanCount: p.kaidanCount,
      kaidanOffsets: p.kaidanOffsets,
    };
  });

  return {
    ...preview,
    massingTiers: remapped,
    buildingHeightMm,
    massingWasSynthesized: false,
    walls: mergedWalls,
    dto: {
      ...preview.dto,
      walls: mergedWalls,
      massingTiers: remapped as BuildingMassingTier[],
    },
  };
}
