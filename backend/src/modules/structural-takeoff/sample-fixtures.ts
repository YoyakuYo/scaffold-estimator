/**
 * Phase 4 — gap #4 validation fixture.
 *
 * A realistic mid-rise S-frame office (5 floors + RF, two blocks A/B) with
 * sane element counts, sections, and grid labels. Used by the
 * `loadSampleProject` flow so users (and tests) can validate the schedule,
 * truck plan, and Excel exporter end to end without typing 100 elements
 * by hand.
 *
 * Numbers approximate a building footprint of roughly 20m × 30m per block,
 * ~210 t of steel for the whole job, and one tower crane lift cycle.
 */
import type { StructuralElementType } from './element-types';

export interface SampleElementRow {
  level: string;
  block: string | null;
  elementType: StructuralElementType;
  label: string | null;
  section: string | null;
  qty: number;
  grid: string | null;
}

export interface SampleProjectFixture {
  name: string;
  siteAddress: string;
  blocks: string[];
  levels: string[];
  elements: SampleElementRow[];
}

const FLOORS = ['1F', '2F', '3F', '4F', '5F', 'RF'];
const BLOCKS = ['A', 'B'];

function generateElementsPerFloor(level: string, block: string): SampleElementRow[] {
  const isRoof = level === 'RF';
  const rows: SampleElementRow[] = [];

  // 柱 — 12 columns per block (4×3 grid).
  rows.push({
    level,
    block,
    elementType: 'hashira',
    label: 'C1',
    section: 'H-400x400x13x21',
    qty: isRoof ? 0 : 12,
    grid: 'X1-X4 / Y1-Y3',
  });

  // 大梁 — 14 main beams per block per floor.
  rows.push({
    level,
    block,
    elementType: 'oobari',
    label: 'G1',
    section: 'H-600x200x11x17',
    qty: 14,
    grid: 'X1-X4',
  });

  // 小梁 — 22 small beams per block per floor.
  rows.push({
    level,
    block,
    elementType: 'kobari',
    label: 'b1',
    section: 'H-450x200x9x14',
    qty: 22,
    grid: 'between mains',
  });

  // 耐風梁 — 4 wind beams per floor (perimeter).
  rows.push({
    level,
    block,
    elementType: 'taifubari',
    label: 'W1',
    section: 'H-500x200x10x16',
    qty: 4,
    grid: 'perimeter',
  });

  // ブレース — 6 braces per block per floor.
  rows.push({
    level,
    block,
    elementType: 'brace',
    label: 'BR1',
    section: 'L-90x90x7',
    qty: 6,
    grid: 'core',
  });

  // 階段 — 2 stair flights per block per floor.
  rows.push({
    level,
    block,
    elementType: 'kaidan',
    label: 'S1',
    section: 'pre-fab',
    qty: 2,
    grid: null,
  });

  // エレベーター — 1 EV pit per block, 3F up has shaft segments.
  if (level === '1F' || level === '3F' || level === '5F') {
    rows.push({
      level,
      block,
      elementType: 'elevator',
      label: 'EV1',
      section: 'kit',
      qty: 1,
      grid: null,
    });
  }

  return rows.filter((r) => r.qty > 0);
}

export function buildSampleFixture(): SampleProjectFixture {
  const elements: SampleElementRow[] = [];
  for (const block of BLOCKS) {
    for (const level of FLOORS) {
      elements.push(...generateElementsPerFloor(level, block));
    }
  }
  return {
    name: '【サンプル】5階建てS造オフィス（A/B工区）',
    siteAddress: '東京都中央区サンプル町 1-1-1',
    blocks: BLOCKS,
    levels: FLOORS,
    elements,
  };
}
