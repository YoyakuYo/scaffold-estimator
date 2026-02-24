/**
 * ═══════════════════════════════════════════════════════════════
 * 仮設材積算エンジン — Central Scaffold Calculation Engine
 * ═══════════════════════════════════════════════════════════════
 *
 * Deterministic calculation engine for scaffold material quantities.
 * Supports both kusabi and wakugumi scaffold types.
 *
 * Primary: per-side calculation
 * Totals: derived by summing all sides
 */

// ─── Input Types ─────────────────────────────────────────────

export interface SideInput {
  label: string;
  lengthMm: number;
  heightMm: number;
  stairAccessCount: number;
}

export interface ScaffoldProjectConfig {
  sides: SideInput[];
  buildingHeightMm: number;
  levelHeightMm: number;
  scaffoldType: 'kusabi' | 'wakugumi';
  scaffoldWidthMm: number;
  structureType: '改修工事' | 'S造' | 'RC造';
  preferredMainTatejiMm?: number;
  topGuardHeightMm?: number;
  frameSizeMm?: number;
  habakiCountPerSpan?: number;
  endStopperType?: 'nuno' | 'frame';
}

// ─── Output Types ────────────────────────────────────────────

export interface SideMaterials {
  label: string;
  lengthMm: number;
  spans: number;
  levels: number;
  tateji: number;
  brace: number;
  tesuri: number;
  anchi: number;
  habaki: number;
  jackBase: number;
  negarami: number;
  nunobar: number;
  kaidan: number;
  // Wakugumi-specific
  frame?: number;
  shitasan?: number;
  endStopper?: number;
}

export interface ScaffoldProjectResult {
  sides: Record<string, SideMaterials>;
  totals: SideMaterials;
  levels: number;
  buildingHeightMm: number;
  scaffoldType: 'kusabi' | 'wakugumi';
}

// ─── Span Constants ──────────────────────────────────────────

const KUSABI_SPAN_OPTIONS = [600, 900, 1200, 1500, 1800];
const WAKUGUMI_SPAN_OPTIONS = [610, 914, 1219, 1524, 1829];

function getStandardSpan(scaffoldType: 'kusabi' | 'wakugumi'): number {
  return scaffoldType === 'kusabi' ? 1800 : 1829;
}

function getSpanOptions(scaffoldType: 'kusabi' | 'wakugumi'): number[] {
  return scaffoldType === 'kusabi' ? KUSABI_SPAN_OPTIONS : WAKUGUMI_SPAN_OPTIONS;
}

// ─── Anchi Layout by Width ───────────────────────────────────

function getAnchiPerSpan(scaffoldWidthMm: number): { full: number; half: number } {
  switch (scaffoldWidthMm) {
    case 600: return { full: 1, half: 0 };
    case 900: return { full: 1, half: 1 };
    case 1200: return { full: 2, half: 0 };
    default: return { full: 1, half: 0 };
  }
}

// ─── Main Calculator ─────────────────────────────────────────

export function calculateScaffoldProject(
  config: ScaffoldProjectConfig,
): ScaffoldProjectResult {
  const { sides, scaffoldType, scaffoldWidthMm } = config;
  const standardSpan = getStandardSpan(scaffoldType);
  const levelHeight = scaffoldType === 'kusabi'
    ? 1800
    : (config.frameSizeMm || 1700);

  const sideResults: Record<string, SideMaterials> = {};

  for (const side of sides) {
    const effectiveHeight = side.heightMm || config.buildingHeightMm;
    const levels = Math.ceil(effectiveHeight / levelHeight);
    const spans = Math.ceil(side.lengthMm / standardSpan);
    const postPositions = spans + 1;

    let materials: SideMaterials;

    if (scaffoldType === 'kusabi') {
      materials = calculateKusabiSide(side, spans, postPositions, levels, scaffoldWidthMm);
    } else {
      materials = calculateWakugumiSide(
        side, spans, postPositions, levels, scaffoldWidthMm,
        config.habakiCountPerSpan || 2,
        config.endStopperType || 'nuno',
      );
    }

    sideResults[side.label] = materials;
  }

  const totals = sumSideMaterials(Object.values(sideResults));
  const globalLevels = Math.ceil(config.buildingHeightMm / levelHeight);

  return {
    sides: sideResults,
    totals,
    levels: globalLevels,
    buildingHeightMm: config.buildingHeightMm,
    scaffoldType,
  };
}

// ─── Kusabi Side Calculation ─────────────────────────────────

function calculateKusabiSide(
  side: SideInput,
  spans: number,
  postPositions: number,
  levels: number,
  scaffoldWidthMm: number,
): SideMaterials {
  // Tateji: (spans+1) positions × 2 rows × levels
  const tateji = postPositions * 2 * levels;

  // Brace: OUTER face only, 1 per span per level
  const brace = spans * levels;

  // Tesuri/Nunobaru: INNER face, 2 per span per level
  const tesuri = spans * 2 * levels;

  // Anchi (plank): 1 per span per level, adjusted for stair access
  const anchiLayout = getAnchiPerSpan(scaffoldWidthMm);
  const anchiTotal = anchiLayout.full + anchiLayout.half;
  const stairAnchiReduction = scaffoldWidthMm >= 900 ? side.stairAccessCount * levels : 0;
  const anchi = Math.max(0, (spans * anchiTotal * levels) - stairAnchiReduction);

  // Habaki: front + back, 2 per span per level
  const habaki = spans * 2 * levels;

  // Jack base: postPositions × 2 rows
  const jackBase = postPositions * 2;

  // Negarami (base yokoji): span direction = N×2, width direction = (N+1)
  const negarami = (spans * 2) + postPositions;

  // Nunobar (width direction horizontal bars where plank sits): postPositions per level
  const nunobar = postPositions * levels;

  // Kaidan: stair access × levels
  const kaidan = side.stairAccessCount * levels;

  return {
    label: side.label,
    lengthMm: side.lengthMm,
    spans,
    levels,
    tateji,
    brace,
    tesuri,
    anchi,
    habaki,
    jackBase,
    negarami,
    nunobar,
    kaidan,
  };
}

// ─── Wakugumi Side Calculation ───────────────────────────────

function calculateWakugumiSide(
  side: SideInput,
  spans: number,
  postPositions: number,
  levels: number,
  scaffoldWidthMm: number,
  habakiCountPerSpan: number,
  endStopperType: 'nuno' | 'frame',
): SideMaterials {
  // Frame: (N+1) × 2 rows × levels (shared at boundaries)
  const frame = postPositions * 2 * levels;

  // Brace: BOTH faces, 2 per span per level
  const brace = spans * 2 * levels;

  // Shitasan (bottom bar): BOTH faces, 2 per span per level
  const shitasan = spans * 2 * levels;

  // Anchi
  const anchiLayout = getAnchiPerSpan(scaffoldWidthMm);
  const anchiTotal = anchiLayout.full + anchiLayout.half;
  const stairAnchiReduction = scaffoldWidthMm >= 900 ? side.stairAccessCount * levels : 0;
  const anchi = Math.max(0, (spans * anchiTotal * levels) - stairAnchiReduction);

  // Habaki: user-selectable 1 or 2 per span per level
  const habaki = spans * habakiCountPerSpan * levels;

  // Jack base
  const jackBase = postPositions * 2;

  // Negarami
  const negarami = (spans * 2) + postPositions;

  // Nunobar (width direction)
  const nunobar = postPositions * levels;

  // End stoppers: at wall ends
  const endStopper = endStopperType === 'nuno'
    ? 4 * levels
    : 2 * levels;

  // Kaidan
  const kaidan = side.stairAccessCount * levels;

  return {
    label: side.label,
    lengthMm: side.lengthMm,
    spans,
    levels,
    tateji: 0,
    brace,
    tesuri: 0,
    anchi,
    habaki,
    jackBase,
    negarami,
    nunobar,
    kaidan,
    frame,
    shitasan,
    endStopper,
  };
}

// ─── Sum Side Materials ──────────────────────────────────────

function sumSideMaterials(sides: SideMaterials[]): SideMaterials {
  const sum = (key: keyof SideMaterials): number =>
    sides.reduce((acc, s) => acc + (typeof s[key] === 'number' ? (s[key] as number) : 0), 0);

  return {
    label: '合計',
    lengthMm: sum('lengthMm'),
    spans: sum('spans'),
    levels: Math.max(...sides.map((s) => s.levels), 0),
    tateji: sum('tateji'),
    brace: sum('brace'),
    tesuri: sum('tesuri'),
    anchi: sum('anchi'),
    habaki: sum('habaki'),
    jackBase: sum('jackBase'),
    negarami: sum('negarami'),
    nunobar: sum('nunobar'),
    kaidan: sum('kaidan'),
    frame: sum('frame') || undefined,
    shitasan: sum('shitasan') || undefined,
    endStopper: sum('endStopper') || undefined,
  };
}
