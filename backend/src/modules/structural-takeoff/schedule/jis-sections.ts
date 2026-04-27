/**
 * Phase 4 — JIS / SS400 / SN490 standard rolled section unit weights (kg/m).
 *
 * Comprehensive catalog spanning the section families seen on Japanese
 * steel-frame jobs: H-shape, I-shape, square/rectangular hollow sections
 * (RHS / 角形 STKR), round hollow sections (CHS / 鋼管 STK), equal angles
 * (L), channels (C / [), and T-shapes cut from H sections (CT).
 *
 * Values follow JIS handbooks (G3192 hot-rolled wide flange, G3466 STKR,
 * G3444 STK, G3192 angles + channels). Rounded to 1 decimal kg/m where
 * the published value carries that precision.
 *
 * `resolveKgPerM(section)` is the public entry point. It performs:
 *   1. Exact catalog match (case-insensitive, × normalised to x).
 *   2. Best in-family match by depth + flange when an exact size is missing.
 *   3. Family-typical fallback when only a family code is parseable.
 *   4. 0 when the input is unparseable — caller can treat as "weight unknown".
 */

export interface SectionWeightEntry {
  /** Canonical key, e.g. "H-600x200x11x17". */
  key: string;
  /** Family short code (H, I, CT, RHS, CHS, L, C). */
  family: string;
  /** kg per metre. */
  kgPerM: number;
}

// ─── Wide flange / H-shape (JIS G3192) ─────────────────────────────
// The "narrow flange" series + "wide flange" series + "outside dimension"
// series consolidated. Extended from the original 20 entries to ~50 covering
// the depth range 100–900 mm at typical Japanese mid- and high-rise sizes.
const H_SECTIONS: SectionWeightEntry[] = [
  // 100 mm depth
  { key: 'H-100x50x5x7', family: 'H', kgPerM: 9.3 },
  { key: 'H-100x100x6x8', family: 'H', kgPerM: 17.2 },
  // 125 mm
  { key: 'H-125x60x6x8', family: 'H', kgPerM: 13.1 },
  { key: 'H-125x125x6.5x9', family: 'H', kgPerM: 23.8 },
  // 150 mm
  { key: 'H-150x75x5x7', family: 'H', kgPerM: 14.0 },
  { key: 'H-150x100x6x9', family: 'H', kgPerM: 21.1 },
  { key: 'H-150x150x7x10', family: 'H', kgPerM: 31.5 },
  // 175 mm
  { key: 'H-175x90x5x8', family: 'H', kgPerM: 18.0 },
  { key: 'H-175x175x7.5x11', family: 'H', kgPerM: 40.2 },
  // 200 mm
  { key: 'H-200x100x5.5x8', family: 'H', kgPerM: 21.3 },
  { key: 'H-200x150x6x9', family: 'H', kgPerM: 30.6 },
  { key: 'H-200x200x8x12', family: 'H', kgPerM: 49.9 },
  // 250 mm
  { key: 'H-250x125x6x9', family: 'H', kgPerM: 29.6 },
  { key: 'H-250x175x7x11', family: 'H', kgPerM: 44.1 },
  { key: 'H-250x250x9x14', family: 'H', kgPerM: 72.4 },
  // 300 mm
  { key: 'H-300x150x6.5x9', family: 'H', kgPerM: 36.7 },
  { key: 'H-300x200x8x12', family: 'H', kgPerM: 56.8 },
  { key: 'H-300x300x10x15', family: 'H', kgPerM: 94.0 },
  // 350 mm
  { key: 'H-350x175x7x11', family: 'H', kgPerM: 49.4 },
  { key: 'H-350x250x9x14', family: 'H', kgPerM: 79.7 },
  { key: 'H-350x350x12x19', family: 'H', kgPerM: 137.0 },
  // 400 mm
  { key: 'H-400x150x8x13', family: 'H', kgPerM: 56.6 },
  { key: 'H-400x200x8x13', family: 'H', kgPerM: 66.0 },
  { key: 'H-400x300x10x16', family: 'H', kgPerM: 107.0 },
  { key: 'H-400x400x13x21', family: 'H', kgPerM: 172.0 },
  // 450 mm
  { key: 'H-450x150x9x14', family: 'H', kgPerM: 65.5 },
  { key: 'H-450x200x9x14', family: 'H', kgPerM: 76.0 },
  { key: 'H-450x300x11x18', family: 'H', kgPerM: 124.0 },
  // 500 mm
  { key: 'H-500x200x10x16', family: 'H', kgPerM: 89.6 },
  { key: 'H-500x300x11x18', family: 'H', kgPerM: 130.0 },
  // 588 mm (deep wide-flange)
  { key: 'H-588x300x12x20', family: 'H', kgPerM: 147.0 },
  { key: 'H-594x302x14x23', family: 'H', kgPerM: 174.0 },
  // 600 mm
  { key: 'H-600x200x11x17', family: 'H', kgPerM: 106.0 },
  { key: 'H-600x300x12x17', family: 'H', kgPerM: 137.0 },
  { key: 'H-606x201x12x20', family: 'H', kgPerM: 120.0 },
  // 700 mm
  { key: 'H-700x300x13x24', family: 'H', kgPerM: 185.0 },
  { key: 'H-792x300x14x22', family: 'H', kgPerM: 191.0 },
  // 800 mm
  { key: 'H-800x300x14x26', family: 'H', kgPerM: 210.0 },
  // 900 mm
  { key: 'H-900x300x16x28', family: 'H', kgPerM: 243.0 },
  { key: 'H-912x302x18x34', family: 'H', kgPerM: 286.0 },
];

// ─── I-beam / 形鋼I (legacy, less common in Japan but present in older work) ─
const I_SECTIONS: SectionWeightEntry[] = [
  { key: 'I-100x75x5x8', family: 'I', kgPerM: 11.7 },
  { key: 'I-150x75x5.5x9.5', family: 'I', kgPerM: 14.0 },
  { key: 'I-200x100x7x10', family: 'I', kgPerM: 21.3 },
  { key: 'I-250x125x7.5x12.5', family: 'I', kgPerM: 29.6 },
  { key: 'I-300x150x8x13', family: 'I', kgPerM: 36.7 },
];

// ─── Square / rectangular hollow sections (JIS G3466 STKR) ──────────
const RHS_SECTIONS: SectionWeightEntry[] = [
  // Square
  { key: 'RHS-50x50x2.3', family: 'RHS', kgPerM: 3.34 },
  { key: 'RHS-50x50x3.2', family: 'RHS', kgPerM: 4.50 },
  { key: 'RHS-60x60x3.2', family: 'RHS', kgPerM: 5.50 },
  { key: 'RHS-75x75x3.2', family: 'RHS', kgPerM: 6.99 },
  { key: 'RHS-75x75x4.5', family: 'RHS', kgPerM: 9.55 },
  { key: 'RHS-90x90x3.2', family: 'RHS', kgPerM: 8.50 },
  { key: 'RHS-100x100x3.2', family: 'RHS', kgPerM: 9.52 },
  { key: 'RHS-100x100x4.5', family: 'RHS', kgPerM: 13.1 },
  { key: 'RHS-100x100x6', family: 'RHS', kgPerM: 17.0 },
  { key: 'RHS-125x125x4.5', family: 'RHS', kgPerM: 16.6 },
  { key: 'RHS-125x125x6', family: 'RHS', kgPerM: 21.7 },
  { key: 'RHS-150x150x4.5', family: 'RHS', kgPerM: 20.1 },
  { key: 'RHS-150x150x6', family: 'RHS', kgPerM: 26.4 },
  { key: 'RHS-150x150x9', family: 'RHS', kgPerM: 38.4 },
  { key: 'RHS-175x175x6', family: 'RHS', kgPerM: 31.1 },
  { key: 'RHS-175x175x9', family: 'RHS', kgPerM: 45.3 },
  { key: 'RHS-200x200x6', family: 'RHS', kgPerM: 35.8 },
  { key: 'RHS-200x200x9', family: 'RHS', kgPerM: 52.0 },
  { key: 'RHS-200x200x12', family: 'RHS', kgPerM: 67.9 },
  { key: 'RHS-250x250x9', family: 'RHS', kgPerM: 65.7 },
  { key: 'RHS-250x250x12', family: 'RHS', kgPerM: 86.8 },
  { key: 'RHS-300x300x9', family: 'RHS', kgPerM: 80.0 },
  { key: 'RHS-300x300x12', family: 'RHS', kgPerM: 105.0 },
  { key: 'RHS-300x300x16', family: 'RHS', kgPerM: 138.0 },
  { key: 'RHS-350x350x12', family: 'RHS', kgPerM: 124.0 },
  { key: 'RHS-350x350x16', family: 'RHS', kgPerM: 162.0 },
  { key: 'RHS-400x400x12', family: 'RHS', kgPerM: 142.0 },
  { key: 'RHS-400x400x16', family: 'RHS', kgPerM: 187.0 },
  { key: 'RHS-450x450x16', family: 'RHS', kgPerM: 211.0 },
  { key: 'RHS-500x500x16', family: 'RHS', kgPerM: 235.0 },
  { key: 'RHS-500x500x19', family: 'RHS', kgPerM: 277.0 },
  { key: 'RHS-550x550x19', family: 'RHS', kgPerM: 306.0 },
  { key: 'RHS-600x600x19', family: 'RHS', kgPerM: 335.0 },
  { key: 'RHS-600x600x22', family: 'RHS', kgPerM: 386.0 },
  // Rectangular (depth × width × t)
  { key: 'RHS-100x50x3.2', family: 'RHS', kgPerM: 7.01 },
  { key: 'RHS-150x100x4.5', family: 'RHS', kgPerM: 16.6 },
  { key: 'RHS-150x100x6', family: 'RHS', kgPerM: 21.7 },
  { key: 'RHS-200x100x4.5', family: 'RHS', kgPerM: 20.1 },
  { key: 'RHS-200x100x6', family: 'RHS', kgPerM: 26.4 },
  { key: 'RHS-200x150x6', family: 'RHS', kgPerM: 31.1 },
  { key: 'RHS-250x150x6', family: 'RHS', kgPerM: 35.8 },
  { key: 'RHS-300x200x9', family: 'RHS', kgPerM: 65.7 },
  { key: 'RHS-400x200x9', family: 'RHS', kgPerM: 80.0 },
  { key: 'RHS-400x200x12', family: 'RHS', kgPerM: 105.0 },
  { key: 'RHS-500x300x12', family: 'RHS', kgPerM: 142.0 },
];

// ─── Round HSS (CHS / 鋼管, JIS G3444 STK) ─────────────────────────
// Diameter × wall thickness. Most common construction sizes.
const CHS_SECTIONS: SectionWeightEntry[] = [
  { key: 'CHS-48.6x2.4', family: 'CHS', kgPerM: 2.74 },
  { key: 'CHS-60.5x3.2', family: 'CHS', kgPerM: 4.52 },
  { key: 'CHS-76.3x3.2', family: 'CHS', kgPerM: 5.77 },
  { key: 'CHS-89.1x3.2', family: 'CHS', kgPerM: 6.78 },
  { key: 'CHS-101.6x3.2', family: 'CHS', kgPerM: 7.76 },
  { key: 'CHS-101.6x4.2', family: 'CHS', kgPerM: 10.1 },
  { key: 'CHS-114.3x3.5', family: 'CHS', kgPerM: 9.55 },
  { key: 'CHS-114.3x4.5', family: 'CHS', kgPerM: 12.2 },
  { key: 'CHS-139.8x4.5', family: 'CHS', kgPerM: 15.0 },
  { key: 'CHS-139.8x6', family: 'CHS', kgPerM: 19.8 },
  { key: 'CHS-165.2x4.5', family: 'CHS', kgPerM: 17.8 },
  { key: 'CHS-165.2x6', family: 'CHS', kgPerM: 23.6 },
  { key: 'CHS-190.7x5.3', family: 'CHS', kgPerM: 24.2 },
  { key: 'CHS-190.7x7', family: 'CHS', kgPerM: 31.7 },
  { key: 'CHS-216.3x4.5', family: 'CHS', kgPerM: 23.5 },
  { key: 'CHS-216.3x6', family: 'CHS', kgPerM: 31.1 },
  { key: 'CHS-216.3x8', family: 'CHS', kgPerM: 41.1 },
  { key: 'CHS-267.4x6', family: 'CHS', kgPerM: 38.7 },
  { key: 'CHS-267.4x8', family: 'CHS', kgPerM: 51.2 },
  { key: 'CHS-318.5x6', family: 'CHS', kgPerM: 46.2 },
  { key: 'CHS-318.5x9', family: 'CHS', kgPerM: 68.7 },
  { key: 'CHS-318.5x12', family: 'CHS', kgPerM: 90.7 },
  { key: 'CHS-355.6x9', family: 'CHS', kgPerM: 76.9 },
  { key: 'CHS-355.6x12', family: 'CHS', kgPerM: 101.0 },
  { key: 'CHS-406.4x9', family: 'CHS', kgPerM: 88.1 },
  { key: 'CHS-406.4x12', family: 'CHS', kgPerM: 117.0 },
  { key: 'CHS-457.2x9', family: 'CHS', kgPerM: 99.4 },
  { key: 'CHS-457.2x12', family: 'CHS', kgPerM: 132.0 },
  { key: 'CHS-508x12', family: 'CHS', kgPerM: 147.0 },
  { key: 'CHS-558.8x12', family: 'CHS', kgPerM: 162.0 },
  { key: 'CHS-609.6x12', family: 'CHS', kgPerM: 177.0 },
  { key: 'CHS-660.4x16', family: 'CHS', kgPerM: 254.0 },
  { key: 'CHS-711.2x16', family: 'CHS', kgPerM: 274.0 },
];

// ─── Equal angle (L) — bracing, light framing ──────────────────────
const L_SECTIONS: SectionWeightEntry[] = [
  { key: 'L-25x25x3', family: 'L', kgPerM: 1.12 },
  { key: 'L-30x30x3', family: 'L', kgPerM: 1.36 },
  { key: 'L-40x40x3', family: 'L', kgPerM: 1.83 },
  { key: 'L-40x40x5', family: 'L', kgPerM: 2.95 },
  { key: 'L-45x45x4', family: 'L', kgPerM: 2.74 },
  { key: 'L-50x50x4', family: 'L', kgPerM: 3.06 },
  { key: 'L-50x50x6', family: 'L', kgPerM: 4.43 },
  { key: 'L-60x60x4', family: 'L', kgPerM: 3.68 },
  { key: 'L-60x60x5', family: 'L', kgPerM: 4.55 },
  { key: 'L-65x65x6', family: 'L', kgPerM: 5.91 },
  { key: 'L-70x70x6', family: 'L', kgPerM: 6.38 },
  { key: 'L-75x75x6', family: 'L', kgPerM: 6.85 },
  { key: 'L-75x75x9', family: 'L', kgPerM: 9.96 },
  { key: 'L-80x80x6', family: 'L', kgPerM: 7.32 },
  { key: 'L-90x90x7', family: 'L', kgPerM: 9.96 },
  { key: 'L-90x90x10', family: 'L', kgPerM: 13.3 },
  { key: 'L-100x100x7', family: 'L', kgPerM: 10.7 },
  { key: 'L-100x100x10', family: 'L', kgPerM: 14.9 },
  { key: 'L-100x100x13', family: 'L', kgPerM: 19.1 },
  { key: 'L-120x120x8', family: 'L', kgPerM: 14.7 },
  { key: 'L-130x130x9', family: 'L', kgPerM: 17.9 },
  { key: 'L-130x130x12', family: 'L', kgPerM: 23.4 },
  { key: 'L-150x150x12', family: 'L', kgPerM: 27.3 },
  { key: 'L-150x150x15', family: 'L', kgPerM: 33.6 },
  { key: 'L-175x175x12', family: 'L', kgPerM: 31.8 },
  { key: 'L-175x175x15', family: 'L', kgPerM: 39.4 },
  { key: 'L-200x200x15', family: 'L', kgPerM: 45.3 },
  { key: 'L-200x200x20', family: 'L', kgPerM: 59.7 },
  { key: 'L-250x250x25', family: 'L', kgPerM: 93.7 },
];

// ─── Channel (C / [) — purlins, light beams ────────────────────────
const C_SECTIONS: SectionWeightEntry[] = [
  { key: 'C-75x40x5x7', family: 'C', kgPerM: 6.92 },
  { key: 'C-100x50x5x7.5', family: 'C', kgPerM: 9.36 },
  { key: 'C-125x65x6x8', family: 'C', kgPerM: 13.4 },
  { key: 'C-150x75x6.5x10', family: 'C', kgPerM: 18.6 },
  { key: 'C-150x75x9x12.5', family: 'C', kgPerM: 24.0 },
  { key: 'C-180x75x7x10.5', family: 'C', kgPerM: 21.4 },
  { key: 'C-200x80x7.5x11', family: 'C', kgPerM: 24.6 },
  { key: 'C-200x90x8x13.5', family: 'C', kgPerM: 30.3 },
  { key: 'C-250x90x9x13', family: 'C', kgPerM: 34.6 },
  { key: 'C-250x90x11x14.5', family: 'C', kgPerM: 40.2 },
  { key: 'C-300x90x9x13', family: 'C', kgPerM: 38.1 },
  { key: 'C-300x90x10x15.5', family: 'C', kgPerM: 43.8 },
  { key: 'C-380x100x10.5x16', family: 'C', kgPerM: 54.5 },
];

// ─── CT (Tee cut from H, JIS G3192) ────────────────────────────────
// Roughly half the H-shape unit weight for the matching size.
const CT_SECTIONS: SectionWeightEntry[] = [
  { key: 'CT-75x100x6x8', family: 'CT', kgPerM: 8.6 },
  { key: 'CT-100x100x6x8', family: 'CT', kgPerM: 8.7 },
  { key: 'CT-125x125x6.5x9', family: 'CT', kgPerM: 11.9 },
  { key: 'CT-150x150x7x10', family: 'CT', kgPerM: 15.8 },
  { key: 'CT-175x175x7.5x11', family: 'CT', kgPerM: 20.1 },
  { key: 'CT-200x200x8x12', family: 'CT', kgPerM: 25.0 },
  { key: 'CT-250x250x9x14', family: 'CT', kgPerM: 36.2 },
  { key: 'CT-300x300x10x15', family: 'CT', kgPerM: 47.0 },
  { key: 'CT-350x350x12x19', family: 'CT', kgPerM: 68.5 },
  { key: 'CT-400x400x13x21', family: 'CT', kgPerM: 86.0 },
];

const ALL_SECTIONS: SectionWeightEntry[] = [
  ...H_SECTIONS,
  ...I_SECTIONS,
  ...RHS_SECTIONS,
  ...CHS_SECTIONS,
  ...L_SECTIONS,
  ...C_SECTIONS,
  ...CT_SECTIONS,
];

const KEY_INDEX = new Map<string, SectionWeightEntry>(
  ALL_SECTIONS.map((e) => [e.key.toLowerCase(), e]),
);

/** Family typical fallback (used when section is unknown or partial). */
const FAMILY_FALLBACK: Record<string, number> = {
  H: 100,
  I: 25,
  RHS: 70,
  CHS: 30,
  L: 10,
  C: 25,
  CT: 30,
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

/** Public catalog read (diagnostic UI / admin export). */
export function getCatalogEntries(): readonly SectionWeightEntry[] {
  return ALL_SECTIONS;
}
