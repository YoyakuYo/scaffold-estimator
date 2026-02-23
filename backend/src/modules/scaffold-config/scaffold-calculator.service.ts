import { Injectable, Logger } from '@nestjs/common';
import {
  fitSpansToWallLength,
  calculateLevels,
  NUNO_SIZES,
  ANCHI_LAYOUT_BY_WIDTH,
  CALC_RULES,
  findNearestSize,
  LevelCalcResult,
} from './scaffold-rules';

/**
 * ═══════════════════════════════════════════════════════════════
 * くさび式足場 (Kusabi Scaffold) Quantity Calculator Engine
 * ═══════════════════════════════════════════════════════════════
 *
 * Single scaffold type: Kusabi only.
 * Calculates per-wall and total quantities for all components.
 *
 * Flow:
 *   1. fitSpansToWallLength → determine span layout per wall
 *   2. calculateLevels → determine levels, post stacking
 *   3. Calculate all component quantities using established rules
 */

// ─── Input / Output Types ────────────────────────────────────

export interface WallSegment {
  lengthMm: number;
  offsetMm: number;
}

export interface WallCalculationInput {
  side: string; // Arbitrary identifier (e.g., 'edge-0', 'segment-1') from polygon geometry
  wallLengthMm: number;
  wallHeightMm: number;
  stairAccessCount: number;
  kaidanCount?: number; // Number of kaidan accesses
  kaidanOffsets?: number[]; // Array of positions in mm from left end
  /** Multi-segment wall definition. If provided, wallLengthMm should
   *  already be the total (segments + return transitions). */
  segments?: WallSegment[];
}

export interface ScaffoldCalculationInput {
  walls: WallCalculationInput[];
  structureType?: '改修工事' | 'S造' | 'RC造';  // Construction pattern
  scaffoldWidthMm: number;         // 600, 900, 1200
  preferredMainTatejiMm: number;   // 1800, 2700, 3600
  topGuardHeightMm: number;        // 900, 1350, 1800
  anchiWidthMm?: number;           // override anchi width (auto from scaffoldWidth if omitted)
}

export interface CalculatedComponent {
  type: string;
  category: string;       // classification group (e.g. '基礎', '支柱', '水平材', '踏板', '安全設備')
  categoryEn: string;     // English classification
  name: string;
  nameJp: string;
  sizeSpec: string;
  unit: string;
  quantity: number;
  sortOrder: number;
  materialCode?: string;
}

export interface WallCalculationResult {
  side: string; // Can be 'north' | 'south' | 'east' | 'west' or arbitrary edge names
  sideJp: string;
  wallLengthMm: number;
  spans: number[];                  // array of span sizes used
  totalSpans: number;
  postPositions: number;            // totalSpans + 1
  levelCalc: LevelCalcResult;
  stairAccessCount: number;
  kaidanSpanIndices?: number[];    // Array of start span indices for kaidan (0-based, each covers 2 spans)
  needsExtendedBay?: boolean;      // Whether extended bay pattern is used (width <= 600mm)
  segments?: WallSegment[];        // Multi-segment shape (passed through from input)
  components: CalculatedComponent[];
}

export interface ScaffoldCalculationResult {
  scaffoldType?: 'kusabi' | 'wakugumi';
  walls: WallCalculationResult[];
  summary: CalculatedComponent[];   // aggregated totals across all walls
  scaffoldWidthMm: number;
  preferredMainTatejiMm: number;
  topGuardHeightMm: number;
  totalLevels: number;
  // Wakugumi-specific (optional)
  frameSizeMm?: number;
  habakiCountPerSpan?: number;
  endStopperType?: 'nuno' | 'frame';
}

// Helper to get Japanese label for any side (polygon edges)
function getSideLabel(side: string): string {
  // Handle edge-0, edge-1, etc.
  if (side.startsWith('edge-')) {
    const num = parseInt(side.replace('edge-', ''), 10);
    return `辺${num + 1}`;
  }
  // Handle segment-0, segment-1, etc.
  if (side.startsWith('segment-')) {
    const num = parseInt(side.replace('segment-', ''), 10);
    return `セグメント${num + 1}`;
  }
  // Fallback: return as-is
  return side;
}

@Injectable()
export class ScaffoldCalculatorService {
  private readonly logger = new Logger(ScaffoldCalculatorService.name);

  /**
   * Pattern-based complexity multipliers
   * Difficulty: 改修工事 (most complex) → S造 (medium) → RC造 (simplest)
   */
  private readonly PATTERN_MULTIPLIERS: Record<'改修工事' | 'S造' | 'RC造', number> = {
    '改修工事': 1.25,  // Most complex - irregular shapes, existing structure adaptation
    'S造': 1.0,       // Medium - grid-based steel frame
    'RC造': 0.9,      // Simplest - formwork-based concrete
  };

  /**
   * Main calculation entry point.
   * Calculates quantities for each selected wall, then aggregates.
   */
  calculate(input: ScaffoldCalculationInput): ScaffoldCalculationResult {
    const structureType = input.structureType || '改修工事'; // Default to most complex
    const complexityMultiplier = this.PATTERN_MULTIPLIERS[structureType];
    
    this.logger.log(
      `Calculating kusabi scaffold for ${input.walls.length} wall(s), pattern: ${structureType} (multiplier: ${complexityMultiplier}x)`
    );

    const wallResults: WallCalculationResult[] = [];

    for (const wall of input.walls) {
      // Calculate levels for this specific wall's height
      const levelCalc = calculateLevels(
        wall.wallHeightMm,
        input.preferredMainTatejiMm,
        input.topGuardHeightMm,
      );
      const result = this.calculateWall(wall, input, levelCalc, complexityMultiplier);
      wallResults.push(result);
    }

    // Aggregate components across all walls
    const summary = this.aggregateComponents(wallResults);

    // Get max levels across all walls for summary
    const maxLevels = Math.max(...wallResults.map(w => w.levelCalc.fullLevels), 0);

    this.logger.log(`Calculation complete: ${wallResults.length} walls, ${summary.length} material types`);

    return {
      walls: wallResults,
      summary,
      scaffoldWidthMm: input.scaffoldWidthMm,
      preferredMainTatejiMm: input.preferredMainTatejiMm,
      topGuardHeightMm: input.topGuardHeightMm,
      totalLevels: maxLevels,
    };
  }

  /**
   * Calculate all component quantities for a single wall.
   */
  private calculateWall(
    wall: WallCalculationInput,
    input: ScaffoldCalculationInput,
    levelCalc: LevelCalcResult,
    complexityMultiplier: number = 1.0,
  ): WallCalculationResult {
    // Step 1: Fit spans to wall length
    const spans = fitSpansToWallLength(wall.wallLengthMm);
    const totalSpans = spans.length;
    const postPositions = totalSpans + 1; // sharing principle
    const L = levelCalc.fullLevels;
    const widthMm = input.scaffoldWidthMm;

    // ─── Convert kaidan offsets to span indices ──────────────
    // Helper: find which 2-span window is closest to an offset
    const findKaidanSpanIndex = (offsetMm: number): number => {
      // Build cumulative positions
      const positions: number[] = [0];
      let accum = 0;
      for (const span of spans) {
        accum += span;
        positions.push(accum);
      }
      
      // Find the span boundary closest to offset
      let closestIdx = 0;
      let minDist = Math.abs(offsetMm - positions[0]);
      for (let i = 1; i < positions.length; i++) {
        const dist = Math.abs(offsetMm - positions[i]);
        if (dist < minDist) {
          minDist = dist;
          closestIdx = i;
        }
      }
      
      // Return the start span index (2-span window: [idx-1, idx] or [idx, idx+1])
      // Prefer the span that contains the offset
      if (closestIdx > 0 && offsetMm < positions[closestIdx]) {
        return Math.max(0, closestIdx - 1);
      }
      return Math.min(closestIdx, totalSpans - 2); // Ensure we have 2 spans
    };

    // Get kaidan span indices from offsets
    const kaidanCount = wall.kaidanCount ?? wall.stairAccessCount;
    const kaidanOffsets = wall.kaidanOffsets || [];
    const kaidanSpanIndices: number[] = [];
    
    if (kaidanOffsets.length > 0) {
      // Use provided offsets
      for (const offset of kaidanOffsets) {
        const spanIdx = findKaidanSpanIndex(offset);
        if (!kaidanSpanIndices.includes(spanIdx)) {
          kaidanSpanIndices.push(spanIdx);
        }
      }
      kaidanSpanIndices.sort((a, b) => a - b);
    } else if (kaidanCount > 0) {
      // Fallback: distribute evenly (old behavior)
      for (let i = 0; i < kaidanCount; i++) {
        const idx = Math.floor((i + 1) * totalSpans / (kaidanCount + 1));
        const clamped = Math.max(0, Math.min(totalSpans - 2, idx));
        if (!kaidanSpanIndices.includes(clamped)) {
          kaidanSpanIndices.push(clamped);
        }
      }
      kaidanSpanIndices.sort((a, b) => a - b);
    }

    // Determine if extended bay pattern is needed
    const needsExtendedBay = widthMm <= 600 && kaidanSpanIndices.length > 0;

    // Group spans by size for material counting
    const spanGroups = this.groupSpansBySize(spans);

    const components: CalculatedComponent[] = [];
    let sortOrder = 0;

    // ══════════════════════════════════════════════════════
    // CATEGORY LABELS
    // ══════════════════════════════════════════════════════
    const CAT = {
      foundation:  { jp: '基礎部材',   en: 'Foundation' },
      post:        { jp: '支柱',       en: 'Posts' },
      nuno:        { jp: '布材',       en: 'Nuno Bars' },
      brace:       { jp: 'ブレス',     en: 'Brace' },
      platform:    { jp: '踏板',       en: 'Plank' },
      habaki:      { jp: '巾木',       en: 'Toe Board' },
      access:      { jp: '階段',      en: 'Stair' },
    };

    // Helper: MA code lookup
    const maCode = (mm: number) => {
      const map: Record<number, string> = {
        225: 'MA-2', 450: 'MA-4', 600: 'MA-6', 900: 'MA-9',
        1350: 'MA-13', 1800: 'MA-18', 2700: 'MA-27', 3600: 'MA-36',
      };
      return map[mm] || `MA-${mm}`;
    };

    // ─── Extended Bay: Calculate extra posts needed ────────
    // For each kaidan in extended bay pattern: add 3 posts (one per level)
    const extraPostsPerKaidan = needsExtendedBay ? 3 : 0; // 3 posts: O, P, Q
    const totalExtraPosts = extraPostsPerKaidan * kaidanSpanIndices.length;

    // ─── 1. ジャッキベース ────────────────────────────────
    sortOrder++;
    components.push({
      type: 'jack_base',
      category: CAT.foundation.jp,
      categoryEn: CAT.foundation.en,
      name: 'Jack Base',
      nameJp: 'ジャッキベース',
      sizeSpec: '調整式',
      unit: '本',
      quantity: postPositions * 2 + totalExtraPosts,
      sortOrder,
      materialCode: 'KUSABI-JB',
    });

    // ─── 2. 支柱 (メイン) ────────────────────────────────
    sortOrder++;
    const mainCode = maCode(input.preferredMainTatejiMm);
    components.push({
      type: 'post_main',
      category: CAT.post.jp,
      categoryEn: CAT.post.en,
      name: `Post ${mainCode}`,
      nameJp: `支柱 ${mainCode}`,
      sizeSpec: `${input.preferredMainTatejiMm}mm`,
      unit: '本',
      quantity: postPositions * 2 * levelCalc.mainPostsPerLine + totalExtraPosts * levelCalc.mainPostsPerLine,
      sortOrder,
      materialCode: `KUSABI-${mainCode}`,
    });

    // ─── 3. 上部支柱 (トップガード) ─────────────────────
    sortOrder++;
    const topCode = maCode(input.topGuardHeightMm);
    components.push({
      type: 'post_top',
      category: CAT.post.jp,
      categoryEn: CAT.post.en,
      name: `Top Guard Post ${topCode}`,
      nameJp: `上部支柱 ${topCode}`,
      sizeSpec: `${input.topGuardHeightMm}mm`,
      unit: '本',
      quantity: postPositions * 2 + totalExtraPosts,
      sortOrder,
      materialCode: `KUSABI-${topCode}-TOP`,
    });

    // ─── 4. ブレス (外面・交差筋違) ─────────────────────
    for (const [spanSizeMm, count] of Object.entries(spanGroups)) {
      sortOrder++;
      components.push({
        type: 'brace',
        category: CAT.brace.jp,
        categoryEn: CAT.brace.en,
        name: `Brace ${spanSizeMm}mm`,
        nameJp: `ブレス`,
        sizeSpec: `${spanSizeMm}`,
        unit: '本',
        quantity: Number(count) * L * CALC_RULES.bracePerSpanPerLevel,
        sortOrder,
        materialCode: `KUSABI-BRACE-${spanSizeMm}`,
      });
    }

    // ─── 5-7. 布材 (Nuno Bars) - Grouped by size ────────
    // Collect all nuno bar types (tesuri, stopper, negarami, bearer) by size
    const nunoBarsBySize: Record<number, {
      tesuri: number;
      stopper: number;
      negarami: number;
      bearer: number;
    }> = {};

    // 5. 手摺 (Tesuri/Handrail) - collect by size
    for (const [spanSizeMm, count] of Object.entries(spanGroups)) {
      const size = Number(spanSizeMm);
      if (!nunoBarsBySize[size]) {
        nunoBarsBySize[size] = { tesuri: 0, stopper: 0, negarami: 0, bearer: 0 };
      }
      nunoBarsBySize[size].tesuri += Number(count) * L * CALC_RULES.tesuriPerSpanPerLevel;
    }

    // 6. 端部手摺 (Stopper/End Handrail)
    const stopperSize = findNearestSize(widthMm, NUNO_SIZES);
    if (!nunoBarsBySize[stopperSize]) {
      nunoBarsBySize[stopperSize] = { tesuri: 0, stopper: 0, negarami: 0, bearer: 0 };
    }
    nunoBarsBySize[stopperSize].stopper += CALC_RULES.stoppersPerEndPerLevel * 2 * L;

    // 7. 根がらみ (Negarami/Base Tie) - collect by size
    const yokojiWidthSize = findNearestSize(widthMm, NUNO_SIZES);
    const negaramiBySize: Record<number, number> = {};

    // Accumulate span direction
    for (const [spanSizeMm, count] of Object.entries(spanGroups)) {
      const sz = Number(spanSizeMm);
      negaramiBySize[sz] = (negaramiBySize[sz] || 0) + Number(count) * 2;
    }
    // Accumulate width direction
    negaramiBySize[yokojiWidthSize] = (negaramiBySize[yokojiWidthSize] || 0) + postPositions;

    // Add negarami to nuno bars by size
    for (const [sizeMm, qty] of Object.entries(negaramiBySize)) {
      const size = Number(sizeMm);
      if (!nunoBarsBySize[size]) {
        nunoBarsBySize[size] = { tesuri: 0, stopper: 0, negarami: 0, bearer: 0 };
      }
      nunoBarsBySize[size].negarami += Number(qty);
    }

    // 8. 踏板受け (Bearer/Plank Support) - collect by size
    const extraWidthYokoji = needsExtendedBay ? kaidanSpanIndices.length * 3 * L : 0;
    if (!nunoBarsBySize[yokojiWidthSize]) {
      nunoBarsBySize[yokojiWidthSize] = { tesuri: 0, stopper: 0, negarami: 0, bearer: 0 };
    }
    nunoBarsBySize[yokojiWidthSize].bearer += postPositions * L + extraWidthYokoji;

    // Emit all Nuno Bars grouped by size - combine all types into single line per size
    const sortedSizes = Object.keys(nunoBarsBySize).map(Number).sort((a, b) => a - b);
    for (const size of sortedSizes) {
      const nuno = nunoBarsBySize[size];
      
      // Sum all nuno bar types for this size
      const totalQuantity = nuno.tesuri + nuno.stopper + nuno.negarami + nuno.bearer;
      
      if (totalQuantity > 0) {
        sortOrder++;
        components.push({
          type: 'nuno_bar',
          category: CAT.nuno.jp,
          categoryEn: CAT.nuno.en,
          name: `Nuno Bar ${size}mm`,
          nameJp: `布材`,
          sizeSpec: `${size}`,
          unit: '本',
          quantity: totalQuantity,
          sortOrder,
          // No materialCode - will be matched by category + sizeSpec in price lookup
          materialCode: undefined,
        });
      }
    }

    // ─── 9. 踏板 / アンチ ──────────────────────────────
    const anchiLayout = ANCHI_LAYOUT_BY_WIDTH[widthMm] || ANCHI_LAYOUT_BY_WIDTH[600];
    const totalAnchiSlots = totalSpans * L;
    
    // For extended bay (≤600mm): NO anchi removal (kaidan sits on extended bay)
    // For replacement (≥900mm): Remove 1 full anchi per kaidan per level
    let stairReplacements = 0;
    if (!needsExtendedBay && kaidanSpanIndices.length > 0) {
      // Replacement pattern: remove 1 full anchi per kaidan per level
      stairReplacements = kaidanSpanIndices.length * L;
    }

    // Stair deduction is a SHARED POOL: stairs replace planks from
    // the largest span group first (stairs are placed in 1800mm spans),
    // then remaining deductions spill to smaller groups if needed.
    // Sort span groups by size descending so stairs deduct from large spans first.
    const spanEntries = Object.entries(spanGroups).sort(
      (a, b) => Number(b[0]) - Number(a[0]),
    );
    let remainingStairDeductions = stairReplacements;

    // First pass: calculate deductions per group
    const anchiDeductions: Record<string, number> = {};
    for (const [spanSizeMm, count] of spanEntries) {
      const perSpanAnchi = anchiLayout.fullAnchiPerSpan * Number(count) * L;
      const deduction = Math.min(remainingStairDeductions, perSpanAnchi);
      anchiDeductions[spanSizeMm] = deduction;
      remainingStairDeductions -= deduction;
    }

    // Second pass: emit components with corrected deductions
    for (const [spanSizeMm, count] of Object.entries(spanGroups)) {
      sortOrder++;
      const perSpanAnchi = anchiLayout.fullAnchiPerSpan * Number(count) * L;
      const stairDeduction = anchiDeductions[spanSizeMm] || 0;
      components.push({
        type: 'anchi',
        category: CAT.platform.jp,
        categoryEn: CAT.platform.en,
        name: `Plank ${anchiLayout.fullAnchiWidth}×${spanSizeMm}mm`,
        nameJp: `踏板`,
        sizeSpec: `${anchiLayout.fullAnchiWidth}×${spanSizeMm}`,
        unit: '枚',
        quantity: Math.max(0, perSpanAnchi - stairDeduction),
        sortOrder,
        materialCode: `KUSABI-ANCHI-${anchiLayout.fullAnchiWidth}x${spanSizeMm}`,
      });
    }

    // Half anchi (900mm width) - only for replacement pattern
    // For extended bay, half anchi stays as normal
    if (anchiLayout.halfAnchiWidth && anchiLayout.halfAnchiPerSpan > 0) {
      for (const [spanSizeMm, count] of Object.entries(spanGroups)) {
        sortOrder++;
        components.push({
          type: 'anchi_half',
          category: CAT.platform.jp,
          categoryEn: CAT.platform.en,
          name: `Half Plank ${anchiLayout.halfAnchiWidth}×${spanSizeMm}mm`,
          nameJp: `踏板 (半幅)`,
          sizeSpec: `${anchiLayout.halfAnchiWidth}×${spanSizeMm}`,
          unit: '枚',
          quantity: anchiLayout.halfAnchiPerSpan * Number(count) * L,
          sortOrder,
          materialCode: `KUSABI-ANCHI-HALF-${anchiLayout.halfAnchiWidth}x${spanSizeMm}`,
        });
      }
    }

    // ─── 10. 巾木 ───────────────────────────────────────
    for (const [spanSizeMm, count] of Object.entries(spanGroups)) {
      sortOrder++;
      components.push({
        type: 'habaki',
        category: CAT.habaki.jp,
        categoryEn: CAT.habaki.en,
        name: `Toe Board ${spanSizeMm}mm`,
        nameJp: `巾木`,
        sizeSpec: `${spanSizeMm}`,
        unit: '枚',
        quantity: Number(count) * L * CALC_RULES.habakiPerSpanPerLevel,
        sortOrder,
        materialCode: `KUSABI-HABAKI-${spanSizeMm}`,
      });
    }

    // ─── 11. 階段セット ─────────────────────────────────
    const finalKaidanCount = kaidanCount || wall.stairAccessCount;
    if (finalKaidanCount > 0) {
      sortOrder++;
      components.push({
        type: 'stair_set',
        category: CAT.access.jp,
        categoryEn: CAT.access.en,
        name: 'Stair Set',
        nameJp: '階段セット',
        sizeSpec: '1階段+2手摺+1ガード',
        unit: 'セット',
        quantity: finalKaidanCount * L,
        sortOrder,
        materialCode: 'KUSABI-STAIR-SET',
      });
    }

    // Apply pattern-based complexity multiplier to all quantities
    if (complexityMultiplier !== 1.0) {
      for (const comp of components) {
        comp.quantity = Math.ceil(comp.quantity * complexityMultiplier);
      }
    }

    return {
      side: wall.side,
      sideJp: getSideLabel(wall.side),
      wallLengthMm: wall.wallLengthMm,
      spans,
      totalSpans,
      postPositions,
      levelCalc,
      stairAccessCount: kaidanCount || wall.stairAccessCount,
      kaidanSpanIndices: kaidanSpanIndices.length > 0 ? kaidanSpanIndices : undefined,
      needsExtendedBay: needsExtendedBay,
      segments: wall.segments,
      components,
    };
  }

  /**
   * Group span sizes and count occurrences.
   * E.g., [1800, 1800, 1800, 600] → { '1800': 3, '600': 1 }
   */
  private groupSpansBySize(spans: number[]): Record<string, number> {
    const groups: Record<string, number> = {};
    for (const s of spans) {
      const key = String(s);
      groups[key] = (groups[key] || 0) + 1;
    }
    return groups;
  }

  /**
   * Aggregate components from all walls into a summary.
   * Groups by materialCode, sums quantities.
   * For Nuno Bars, groups by category + sizeSpec (combines all types by size).
   */
  private aggregateComponents(walls: WallCalculationResult[]): CalculatedComponent[] {
    const map = new Map<string, CalculatedComponent>();

    for (const wall of walls) {
      for (const comp of wall.components) {
        // For Nuno Bars, group by category + sizeSpec (not by materialCode)
        // This combines all nuno bar types (tesuri, stopper, negarami, bearer) by size
        let key: string;
        if (comp.category === '布材') {
          // Group all nuno bars by size: "布材-600", "布材-900", etc.
          key = `${comp.category}-${comp.sizeSpec}`;
        } else {
          // For other components, use materialCode or type-sizeSpec
          key = comp.materialCode || `${comp.type}-${comp.sizeSpec}`;
        }
        
        const existing = map.get(key);
        if (existing) {
          existing.quantity += comp.quantity;
        } else {
          map.set(key, { ...comp });
        }
      }
    }

    // Sort: first by category, then by size (for nuno bars), then by sortOrder
    return Array.from(map.values()).sort((a, b) => {
      // Category order: 基礎部材, 支柱, ブレス, 布材, 踏板, 巾木, 階段
      const categoryOrder: Record<string, number> = {
        '基礎部材': 1,
        '支柱': 2,
        'ブレス': 3,
        '布材': 4,
        '踏板': 5,
        '巾木': 6,
        '階段': 7,
      };
      const catA = categoryOrder[a.category] || 99;
      const catB = categoryOrder[b.category] || 99;
      if (catA !== catB) return catA - catB;

      // For same category, sort by size (extract number from sizeSpec)
      if (a.category === b.category) {
        // Extract numeric size from sizeSpec (handles "600", "500×600", etc.)
        const extractSize = (spec: string): number => {
          // Try to extract first number from sizeSpec
          const match = spec.match(/(\d+)/);
          return match ? parseInt(match[1], 10) : 0;
        };
        
        const sizeA = extractSize(a.sizeSpec);
        const sizeB = extractSize(b.sizeSpec);
        if (sizeA !== sizeB) return sizeA - sizeB;
      }

      // Finally by sortOrder
      return a.sortOrder - b.sortOrder;
    });
  }
}
