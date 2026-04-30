/**
 * Turn `VisionFootprintResult` (AI extraction) into procedural viewer meshes —
 * extruded building shells for the BIM Viewer, aligned with scaffold preview coords.
 */

import type { VisionFootprintResult } from '@/lib/api/vision-bim';
import type { IfcMeshData } from '@/lib/ifc-loader';
import { computeBimPreviewPlanToM, type BimPreviewVertex } from '@/lib/bim-preview-plan-coords';
import { extrudePolygonToMesh } from '@/lib/bim/dxf-procedural-bim';

function toPlanMm(
  toPlanM: (verts: BimPreviewVertex[]) => Array<{ x: number; z: number }>,
  verts: BimPreviewVertex[],
): Array<{ x: number; y: number }> {
  return toPlanM(verts).map((p) => ({ x: p.x * 1000, y: p.z * 1000 }));
}

/**
 * Build one or more extruded meshes from an AI footprint (uniform height or massing tiers).
 */
export function buildMeshesFromVisionFootprint(result: VisionFootprintResult): {
  meshes: IfcMeshData[];
  warnings: string[];
} {
  const warnings: string[] = [];
  const vtx = result.vertices ?? [];
  if (vtx.length < 3) {
    return {
      meshes: [],
      warnings: ['Extraction did not return a closed footprint (need at least 3 vertices).'],
    };
  }

  const { toPlanM } = computeBimPreviewPlanToM({
    outline: vtx,
    massingTiers: result.massingTiers,
    wallLengthsMm: result.wallLengthsMm,
  });

  const meshes: IfcMeshData[] = [];

  const tiers = [...(result.massingTiers ?? [])]
    .filter((t) => Array.isArray(t.vertices) && t.vertices.length >= 3)
    .sort((a, b) => (a.baseHeightMm ?? 0) - (b.baseHeightMm ?? 0));

  if (tiers.length > 0) {
    for (const tier of tiers) {
      const raw = toPlanMm(toPlanM, tier.vertices as BimPreviewVertex[]);
      const base = Math.max(0, tier.baseHeightMm ?? 0);
      const top = tier.topHeightMm ?? base;
      const h = Math.max(0, top - base);
      if (h < 100) continue;
      const m = extrudePolygonToMesh(raw, base, h, 'wall', 1);
      if (m) meshes.push(m);
    }
    if (meshes.length === 0) {
      warnings.push('Massing tiers were present but none could be extruded (check heights).');
    }
  } else {
    const h = Math.max(1000, result.buildingHeightMm || 9000);
    const raw = toPlanMm(toPlanM, vtx as BimPreviewVertex[]);
    const m = extrudePolygonToMesh(raw, 0, h, 'wall', 1);
    if (m) meshes.push(m);
    else warnings.push('Extrusion failed for the footprint polygon.');
  }

  if (result.heightConfidence === 'low' && !result.massingTiers?.length) {
    warnings.push(
      'Height was estimated (typical storey rule). Confirm building height on the scaffold flow or use a drawing with elevations.',
    );
  }

  return { meshes, warnings };
}
