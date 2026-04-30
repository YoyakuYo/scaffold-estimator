/**
 * Deterministic structural takeoff from IFC using web-ifc.
 * Maps IFC entities → canonical element types; floors default from first
 * building storey until full containment is implemented — rows are flagged
 * needs_review for estimator verification.
 */
import {
  IFCBEAM,
  IFCCOLUMN,
  IFCFASTENER,
  IFCMEMBER,
  IFCSTAIR,
  IFCSTAIRFLIGHT,
} from 'web-ifc';
import { STRUCTURAL_ELEMENT_TYPES, type StructuralElementType } from '../element-types';
import type { ElementLineKind } from '../element-types';
import { extractIfcSemanticMetadata } from '../../vision-bim/ifc-semantic-extract';

export interface IfcStructuralImportRow {
  level: string;
  block: string | null;
  elementType: StructuralElementType;
  label: string | null;
  section: string | null;
  qty: number;
  pieceLengthMm: number | null;
  phase: string | null;
  shop: string | null;
  lineKind: ElementLineKind;
  extractionConfidence: number | null;
  needsReview: boolean;
  grid: string | null;
  notes: string | null;
}

const MAX_ELEMENTS = 6000;

function strVal(v: unknown): string | null {
  if (v == null) return null;
  if (typeof v === 'string') return v;
  if (typeof v === 'object' && v !== null && 'value' in (v as object)) {
    const x = (v as { value: unknown }).value;
    return typeof x === 'string' ? x : x != null ? String(x) : null;
  }
  return String(v);
}

function vecToIds(vec: unknown): number[] {
  if (!vec) return [];
  if (Array.isArray(vec)) return vec.map((x) => Number(x)).filter((n) => Number.isFinite(n) && n > 0);
  if (typeof vec === 'object' && vec !== null && typeof (vec as { size?: () => number }).size === 'function') {
    const v = vec as { size(): number; get(i: number): number };
    const out: number[] = [];
    const n = v.size();
    for (let i = 0; i < n; i++) out.push(v.get(i));
    return out.filter((id) => Number.isFinite(id) && id > 0);
  }
  return [];
}

function normalizeLabel(name: string | null, expressId: number): string | null {
  const t = (name ?? '').trim();
  if (t) return t.slice(0, 120);
  return `E${expressId}`;
}

export async function extractStructuralElementsFromIfc(buffer: Buffer): Promise<{
  rows: IfcStructuralImportRow[];
  warnings: string[];
}> {
  const warnings: string[] = [];
  const WebIFC = await import('web-ifc');
  const typeSpecs: Array<{
    typeCode: number;
    elementType: StructuralElementType;
    lineKind: ElementLineKind;
    sectionPrefix: string;
  }> = [
    { typeCode: IFCCOLUMN, elementType: 'hashira', lineKind: 'member', sectionPrefix: 'IFC-柱' },
    { typeCode: IFCBEAM, elementType: 'oobari', lineKind: 'member', sectionPrefix: 'IFC-梁' },
    { typeCode: IFCMEMBER, elementType: 'brace', lineKind: 'member', sectionPrefix: 'IFC-Member' },
    { typeCode: IFCSTAIR, elementType: 'kaidan', lineKind: 'member', sectionPrefix: 'IFC-階段' },
    { typeCode: IFCSTAIRFLIGHT, elementType: 'kaidan', lineKind: 'member', sectionPrefix: 'IFC-階段' },
    { typeCode: IFCFASTENER, elementType: 'brace', lineKind: 'bolt', sectionPrefix: 'IFC-Bolt' },
  ];

  const ifcApi = new WebIFC.IfcAPI();
  await ifcApi.Init();
  const modelID = ifcApi.OpenModel(new Uint8Array(buffer));
  if (modelID < 0) {
    return { rows: [], warnings: ['Failed to open IFC model'] };
  }

  try {
    const meta = await extractIfcSemanticMetadata(ifcApi, modelID);
    const storeys = meta?.storeys?.filter((s) => s.name) ?? [];
    /** Lowest elevation storey after semantic extract sort — usually ground / 1F. */
    const defaultLevel = storeys.length > 0 ? (storeys[0].name ?? '1F') : '1F';

    type AggKey = string;
    const agg = new Map<
      AggKey,
      {
        level: string;
        elementType: StructuralElementType;
        lineKind: ElementLineKind;
        label: string | null;
        section: string | null;
        qty: number;
      }
    >();

    let totalSeen = 0;
    for (const spec of typeSpecs) {
      let ids: number[] = [];
      try {
        ids = vecToIds(ifcApi.GetLineIDsWithType(modelID, spec.typeCode, false));
      } catch {
        continue;
      }
      for (const id of ids) {
        if (totalSeen >= MAX_ELEMENTS) {
          warnings.push(`Stopped after ${MAX_ELEMENTS} IFC entities (cap).`);
          break;
        }
        totalSeen++;
        let line: any;
        try {
          line = ifcApi.GetLine(modelID, id, false, false, null);
        } catch {
          continue;
        }
        const nm = strVal(line?.Name ?? line?.name) ?? strVal(line?.Tag ?? line?.tag);
        const label = normalizeLabel(nm, id);
        const section = `${spec.sectionPrefix}`;
        const key = `${defaultLevel}|${spec.elementType}|${spec.lineKind}|${label}|${section}`;
        const prev = agg.get(key);
        if (prev) prev.qty += 1;
        else {
          agg.set(key, {
            level: defaultLevel.slice(0, 20),
            elementType: spec.elementType,
            lineKind: spec.lineKind,
            label,
            section,
            qty: 1,
          });
        }
      }
      if (totalSeen >= MAX_ELEMENTS) break;
    }

    const rows: IfcStructuralImportRow[] = [];
    for (const v of agg.values()) {
      if (!STRUCTURAL_ELEMENT_TYPES.includes(v.elementType)) continue;
      rows.push({
        level: v.level,
        block: null,
        elementType: v.elementType,
        label: v.label,
        section: v.section,
        qty: v.qty,
        pieceLengthMm: null,
        phase: null,
        shop: null,
        lineKind: v.lineKind,
        extractionConfidence: null,
        needsReview: true,
        grid: null,
        notes:
          'IFC import — verify floor (階), block (工区), phase, shop, and section against the model. Default level from IFC storeys may need adjustment.',
      });
    }

    if (rows.length === 0) {
      warnings.push('No supported structural IFC entities (column/beam/member/stair/slab/fastener) were found.');
    }
    return { rows, warnings };
  } finally {
    try {
      ifcApi.CloseModel(modelID);
    } catch {
      /* ignore */
    }
  }
}
