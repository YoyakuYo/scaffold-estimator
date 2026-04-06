import {
  IFCBUILDING,
  IFCBUILDINGSTOREY,
  IFCGRID,
  IFCPROJECT,
  IFCWALL,
  IFCWALLSTANDARDCASE,
} from 'web-ifc';

/** Elevations and storey names from IFC spatial model (Premium enrichment). */
export interface IfcStoreyInfo {
  expressId: number;
  name: string | null;
  elevationMm: number | null;
}

export interface IfcGridAxisInfo {
  axisTag: string | null;
}

export interface IfcGridSummary {
  expressId: number;
  name: string | null;
  uAxes: IfcGridAxisInfo[];
  vAxes: IfcGridAxisInfo[];
  wAxes: IfcGridAxisInfo[];
}

export interface IfcSpatialSummary {
  projectName: string | null;
  buildingNames: string[];
}

/**
 * Rich IFC metadata for Premium users (storeys, grids, project, property-set sample).
 * Geometry footprint is still derived separately via mesh streaming.
 */
export interface IfcPremiumMetadata {
  ifcSchema: string | null;
  projectName: string | null;
  spatialSummary?: IfcSpatialSummary;
  storeys: IfcStoreyInfo[];
  grids: IfcGridSummary[];
  /** Unique IfcPropertySet / Qto names seen on a few sampled walls (diagnostic). */
  propertySetNameSample: string[];
}

function vecToIds(vec: { size(): number; get(i: number): number }): number[] {
  const out: number[] = [];
  const n = vec.size();
  for (let i = 0; i < n; i++) out.push(vec.get(i));
  return out;
}

function strVal(v: unknown): string | null {
  if (v == null) return null;
  if (typeof v === 'string') return v;
  if (typeof v === 'object' && v !== null && 'value' in (v as object)) {
    const x = (v as { value: unknown }).value;
    return typeof x === 'string' ? x : x != null ? String(x) : null;
  }
  return String(v);
}

/** Normalize IFC length to millimetres (heuristic when unit context is unknown). */
function elevationToMm(raw: unknown): number | null {
  if (raw == null) return null;
  let n: number;
  if (typeof raw === 'number') n = raw;
  else if (typeof raw === 'object' && raw !== null && 'value' in (raw as object)) {
    const v = (raw as { value: unknown }).value;
    n = typeof v === 'number' ? v : parseFloat(String(v));
  } else n = parseFloat(String(raw));
  if (!Number.isFinite(n)) return null;
  if (Math.abs(n) < 600 && Math.abs(n) > 0) return Math.round(n * 1000);
  return Math.round(n);
}

function refExpressList(refs: unknown): unknown[] {
  if (Array.isArray(refs)) return refs;
  if (refs && typeof refs === 'object' && typeof (refs as { size?: () => number }).size === 'function') {
    const v = refs as { size(): number; get(i: number): unknown };
    const out: unknown[] = [];
    const n = v.size();
    for (let i = 0; i < n; i++) out.push(v.get(i));
    return out;
  }
  return [];
}

function readGridAxes(ifcApi: any, modelID: number, refs: unknown): IfcGridAxisInfo[] {
  const list = refExpressList(refs);
  const out: IfcGridAxisInfo[] = [];
  for (const r of list) {
    let id = typeof r === 'number' ? r : (r as { value?: number })?.value;
    if (typeof id === 'object' && id !== null && 'value' in (id as object)) {
      id = (id as { value: number }).value;
    }
    if (typeof id !== 'number' || id <= 0) continue;
    try {
      const line = ifcApi.GetLine(modelID, id, false, false, null);
      const tag = strVal(line?.AxisTag ?? line?.axisTag);
      out.push({ axisTag: tag });
    } catch {
      out.push({ axisTag: null });
    }
    if (out.length >= 64) break;
  }
  return out;
}

async function samplePropertySetNames(ifcApi: any, modelID: number): Promise<string[]> {
  const names = new Set<string>();
  const tryType = (typeCode: number) => {
    try {
      return vecToIds(ifcApi.GetLineIDsWithType(modelID, typeCode, false));
    } catch {
      return [];
    }
  };
  const wallIds = [...tryType(IFCWALLSTANDARDCASE), ...tryType(IFCWALL)].slice(0, 8);
  for (const id of wallIds) {
    try {
      const psets = await ifcApi.properties.getPropertySets(modelID, id, false, true);
      if (!Array.isArray(psets)) continue;
      for (const p of psets) {
        const n = strVal(p?.Name ?? p?.name);
        if (n) names.add(n);
      }
    } catch {
      /* ignore */
    }
    if (names.size >= 40) break;
  }
  return [...names].slice(0, 40);
}

/**
 * Extract semantic IFC fields while the model is open. Best-effort; never throws.
 */
export async function extractIfcSemanticMetadata(
  ifcApi: any,
  modelID: number,
): Promise<IfcPremiumMetadata | undefined> {
  try {
    const ifcSchema = (() => {
      try {
        return ifcApi.GetModelSchema(modelID) || null;
      } catch {
        return null;
      }
    })();

    let projectName: string | null = null;
    try {
      const pids = vecToIds(ifcApi.GetLineIDsWithType(modelID, IFCPROJECT, false));
      if (pids.length > 0) {
        const proj = ifcApi.GetLine(modelID, pids[0], true, false, null);
        projectName =
          strVal(proj?.Name ?? proj?.name) ?? strVal(proj?.LongName ?? proj?.longName);
      }
    } catch {
      /* ignore */
    }

    const buildingNames: string[] = [];
    try {
      const bids = vecToIds(ifcApi.GetLineIDsWithType(modelID, IFCBUILDING, false));
      for (const bid of bids.slice(0, 12)) {
        const b = ifcApi.GetLine(modelID, bid, false, false, null);
        const nm = strVal(b?.Name ?? b?.name);
        if (nm) buildingNames.push(nm);
      }
    } catch {
      /* ignore */
    }

    const storeys: IfcStoreyInfo[] = [];
    try {
      const sids = vecToIds(ifcApi.GetLineIDsWithType(modelID, IFCBUILDINGSTOREY, false));
      for (const sid of sids.slice(0, 250)) {
        const s = ifcApi.GetLine(modelID, sid, true, false, null);
        const name = strVal(s?.Name ?? s?.name);
        const el = s?.Elevation ?? s?.elevation;
        storeys.push({
          expressId: sid,
          name,
          elevationMm: elevationToMm(el),
        });
      }
    } catch {
      /* ignore */
    }

    storeys.sort((a, b) => {
      const ea = a.elevationMm ?? 0;
      const eb = b.elevationMm ?? 0;
      return ea - eb;
    });

    const grids: IfcGridSummary[] = [];
    try {
      const gids = vecToIds(ifcApi.GetLineIDsWithType(modelID, IFCGRID, false));
      for (const gid of gids.slice(0, 24)) {
        const g = ifcApi.GetLine(modelID, gid, true, false, null);
        grids.push({
          expressId: gid,
          name: strVal(g?.Name ?? g?.name),
          uAxes: readGridAxes(ifcApi, modelID, g?.UAxes ?? g?.uAxes),
          vAxes: readGridAxes(ifcApi, modelID, g?.VAxes ?? g?.vAxes),
          wAxes: readGridAxes(ifcApi, modelID, g?.WAxes ?? g?.wAxes),
        });
      }
    } catch {
      /* ignore */
    }

    const spatialSummary: IfcSpatialSummary = {
      projectName,
      buildingNames,
    };

    const propertySetNameSample = await samplePropertySetNames(ifcApi, modelID);

    return {
      ifcSchema,
      projectName,
      spatialSummary,
      storeys,
      grids,
      propertySetNameSample,
    };
  } catch {
    return undefined;
  }
}
