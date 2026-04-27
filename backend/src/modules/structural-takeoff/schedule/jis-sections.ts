/**
 * Phase 4 — JIS / SS400 / SN490 standard rolled section unit weights (kg/m).
 *
 * The catalog is intentionally compact: it covers the H/I/CT/角形 families
 * most commonly seen on Japanese steel-frame jobs. When a parsed section
 * does not match the catalog exactly we fall back to a typical kg/m value
 * for that family, so weight totals are always finite.
 *
 * Sources are well-known JIS handbooks; values are the published unit weight
 * for SS400-class hot-rolled members. Rounded to 1 decimal kg/m.
 */

export interface SectionWeightEntry {
  /** Canonical key, e.g. "H-600x200x11x17". */
  key: string;
  /** Family short code (H, I, CT, BH, RHS, CHS, L). */
  family: string;
  /** kg per metre. */
  kgPerM: number;
}

/** Hot-rolled / built-up wide flange (H-shape). */
const H_SECTIONS: SectionWeightEntry[] = [
  { key: 'H-100x100x6x8', family: 'H', kgPerM: 17.2 },
  { key: 'H-150x100x6x9', family: 'H', kgPerM: 21.1 },
  { key: 'H-150x150x7x10', family: 'H', kgPerM: 31.5 },
  { key: 'H-200x100x5.5x8', family: 'H', kgPerM: 21.3 },
  { key: 'H-200x200x8x12', family: 'H', kgPerM: 49.9 },
  { key: 'H-250x125x6x9', family: 'H', kgPerM: 29.6 },
  { key: 'H-250x250x9x14', family: 'H', kgPerM: 72.4 },
  { key: 'H-300x150x6.5x9', family: 'H', kgPerM: 36.7 },
  { key: 'H-300x300x10x15', family: 'H', kgPerM: 94.0 },
  { key: 'H-350x175x7x11', family: 'H', kgPerM: 49.4 },
  { key: 'H-350x350x12x19', family: 'H', kgPerM: 137.0 },
  { key: 'H-400x200x8x13', family: 'H', kgPerM: 66.0 },
  { key: 'H-400x400x13x21', family: 'H', kgPerM: 172.0 },
  { key: 'H-450x200x9x14', family: 'H', kgPerM: 76.0 },
  { key: 'H-500x200x10x16', family: 'H', kgPerM: 89.6 },
  { key: 'H-588x300x12x20', family: 'H', kgPerM: 147.0 },
  { key: 'H-600x200x11x17', family: 'H', kgPerM: 106.0 },
  { key: 'H-700x300x13x24', family: 'H', kgPerM: 185.0 },
  { key: 'H-800x300x14x26', family: 'H', kgPerM: 210.0 },
  { key: 'H-900x300x16x28', family: 'H', kgPerM: 243.0 },
];

/** Square / rectangular hollow sections (角形 / RHS — STKR). */
const RHS_SECTIONS: SectionWeightEntry[] = [
  { key: 'RHS-100x100x6', family: 'RHS', kgPerM: 17.0 },
  { key: 'RHS-125x125x6', family: 'RHS', kgPerM: 21.7 },
  { key: 'RHS-150x150x6', family: 'RHS', kgPerM: 26.4 },
  { key: 'RHS-150x150x9', family: 'RHS', kgPerM: 38.4 },
  { key: 'RHS-200x200x9', family: 'RHS', kgPerM: 52.0 },
  { key: 'RHS-200x200x12', family: 'RHS', kgPerM: 67.9 },
  { key: 'RHS-250x250x9', family: 'RHS', kgPerM: 65.7 },
  { key: 'RHS-300x300x9', family: 'RHS', kgPerM: 80.0 },
  { key: 'RHS-300x300x12', family: 'RHS', kgPerM: 105.0 },
  { key: 'RHS-350x350x12', family: 'RHS', kgPerM: 124.0 },
  { key: 'RHS-400x400x12', family: 'RHS', kgPerM: 142.0 },
  { key: 'RHS-500x500x16', family: 'RHS', kgPerM: 235.0 },
  { key: 'RHS-600x600x19', family: 'RHS', kgPerM: 335.0 },
];

/** Round HSS (CHS / 鋼管). */
const CHS_SECTIONS: SectionWeightEntry[] = [
  { key: 'CHS-101.6x4.2', family: 'CHS', kgPerM: 10.1 },
  { key: 'CHS-139.8x4.5', family: 'CHS', kgPerM: 15.0 },
  { key: 'CHS-216.3x6', family: 'CHS', kgPerM: 31.1 },
  { key: 'CHS-318.5x9', family: 'CHS', kgPerM: 68.7 },
];

/** Angle (L) — bracing common sizes. */
const L_SECTIONS: SectionWeightEntry[] = [
  { key: 'L-65x65x6', family: 'L', kgPerM: 5.91 },
  { key: 'L-75x75x6', family: 'L', kgPerM: 6.85 },
  { key: 'L-90x90x7', family: 'L', kgPerM: 9.96 },
  { key: 'L-100x100x10', family: 'L', kgPerM: 14.9 },
];

const ALL_SECTIONS: SectionWeightEntry[] = [
  ...H_SECTIONS,
  ...RHS_SECTIONS,
  ...CHS_SECTIONS,
  ...L_SECTIONS,
];

const KEY_INDEX = new Map<string, SectionWeightEntry>(ALL_SECTIONS.map((e) => [e.key.toLowerCase(), e]));

/** Family typical fallback (used when section is unknown or partial). */
const FAMILY_FALLBACK: Record<string, number> = {
  H: 100,
  RHS: 70,
  CHS: 30,
  L: 10,
};

/**
 * Resolve unit weight (kg/m) for an arbitrary user-entered section string.
 * Returns 0 when no plausible match is available; callers may treat 0 as
 * "weight unknown — exclude from tonnage rollups".
 */
export function resolveKgPerM(section: string | null | undefined): number {
  if (!section) return 0;
  const norm = section.toLowerCase().replace(/\s+/g, '').replace(/×/g, 'x');
  const direct = KEY_INDEX.get(norm);
  if (direct) return direct.kgPerM;

  // Try matching just the dimensions for an H-shape: H-600x200x...
  const m = norm.match(/^([a-z]{1,3})-?([\d.]+)x([\d.]+)/);
  if (m) {
    const family = m[1].toUpperCase();
    const a = Number(m[2]);
    const b = Number(m[3]);
    // Best in-family match by closest depth (a) + flange (b).
    let best: SectionWeightEntry | null = null;
    let bestDist = Number.POSITIVE_INFINITY;
    for (const entry of ALL_SECTIONS) {
      if (entry.family !== family) continue;
      const em = entry.key.toLowerCase().match(/^[a-z]{1,3}-([\d.]+)x([\d.]+)/);
      if (!em) continue;
      const dist = Math.abs(Number(em[1]) - a) + Math.abs(Number(em[2]) - b);
      if (dist < bestDist) {
        bestDist = dist;
        best = entry;
      }
    }
    if (best) return best.kgPerM;
    return FAMILY_FALLBACK[family] ?? 0;
  }
  return 0;
}

/**
 * Default piece length per element type (mm), used when section text omits it.
 * 柱 typically equals storey height (≈ 4 m), 大梁/小梁 spans (~ 6 m / 4 m), etc.
 */
export const DEFAULT_PIECE_LENGTH_MM: Record<string, number> = {
  hashira: 4000,
  oobari: 6000,
  kobari: 4000,
  taifubari: 5000,
  brace: 4000,
  kaidan: 5000,
  elevator: 3000,
  deck: 3000,
};

/** Compute weight of one piece (kg). */
export function pieceWeightKg(
  section: string | null | undefined,
  elementType: string,
  pieceLengthMm?: number,
): number {
  const kgPerM = resolveKgPerM(section);
  if (kgPerM <= 0) return 0;
  const lenMm = pieceLengthMm && pieceLengthMm > 0
    ? pieceLengthMm
    : DEFAULT_PIECE_LENGTH_MM[elementType] ?? 4000;
  return Math.round((kgPerM * (lenMm / 1000)) * 10) / 10;
}

export const ALL_SECTION_KEYS: string[] = ALL_SECTIONS.map((e) => e.key);
