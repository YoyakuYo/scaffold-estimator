/**
 * Phase 4 — block-aware erection sequencer (CPM-light).
 *
 * Inputs:
 *   * Project levels (in erection order, e.g. 1F → RF).
 *   * Project blocks (工区) — empty = "single block".
 *   * Extracted elements aggregated per (level, block, type).
 *   * Working calendar.
 *   * DurationTemplate (pieces/day per type, slab cure days, block lag).
 *
 * Output:
 *   * Per-(block, level, activity) start/end ISO dates.
 *   * Per-day demand: Map<isoDate, ActivityDemand[]> for the bin packer.
 *
 * Stair / elevator / kaidan are NOT folded into the floor cycle — they're
 * treated as optional parallel tasks scheduled after the level's slab cure.
 */
import type { StructuralElementType } from '../element-types';
import type { ExtractedElement } from '../extracted-element.entity';
import { buildWorkingCalendar, type WorkingCalendarOptions } from './calendar';
import { DEFAULT_DURATION_TEMPLATE, type DurationTemplate } from './duration-template';
import { pieceWeightKg, DEFAULT_PIECE_LENGTH_MM } from './jis-sections';

export interface SequencerInput {
  levels: string[];
  blocks: string[]; // empty array means "single block"
  elements: ExtractedElement[];
  template?: DurationTemplate;
  calendar: WorkingCalendarOptions;
}

export interface ScheduleActivity {
  block: string | null;
  level: string;
  elementType: StructuralElementType;
  startIso: string;
  endIso: string;
  workingDays: number;
  totalPieces: number;
  totalWeightKg: number;
}

export interface ActivityDemand {
  block: string | null;
  level: string;
  elementType: StructuralElementType;
  /** Pieces required on this date (subset of total for the activity span). */
  pieces: number;
  /** Approx kg for those pieces (sum of pieceWeight × n). */
  kg: number;
  /** Longest piece estimate (mm) — drives truck length rules. */
  maxLengthMm: number;
}

export interface SequencerResult {
  activities: ScheduleActivity[];
  /** isoDate → list of day-level demands (one per element-type aggregate). */
  dailyDemand: Record<string, ActivityDemand[]>;
  /** isoDate ordered ascending. */
  workingDays: string[];
  endIso: string;
}

interface AggregatedKey {
  block: string | null;
  level: string;
  elementType: StructuralElementType;
}

interface Aggregated extends AggregatedKey {
  pieces: number;
  totalLengthMm: number;
  totalWeightKg: number;
  maxPieceLengthMm: number;
  representativeSection: string | null;
}

function aggregate(elements: ExtractedElement[]): Aggregated[] {
  const map = new Map<string, Aggregated>();
  for (const e of elements) {
    if (!Number.isFinite(e.qty) || e.qty <= 0) continue;
    const lk = e.lineKind ?? 'member';
    if (lk !== 'member') continue;
    const key = `${e.block ?? ''}|${e.level}|${e.elementType}`;
    const existing = map.get(key);
    const lenMm =
      e.pieceLengthMm != null && Number.isFinite(e.pieceLengthMm) && e.pieceLengthMm > 0
        ? Math.min(120_000, Math.max(1, Math.floor(e.pieceLengthMm)))
        : DEFAULT_PIECE_LENGTH_MM[e.elementType] ?? 4000;
    const weight = pieceWeightKg(e.section, e.elementType, lenMm) * e.qty;
    if (existing) {
      existing.pieces += e.qty;
      existing.totalLengthMm += lenMm * e.qty;
      existing.totalWeightKg += weight;
      existing.maxPieceLengthMm = Math.max(existing.maxPieceLengthMm, lenMm);
      if (!existing.representativeSection) existing.representativeSection = e.section;
    } else {
      map.set(key, {
        block: e.block,
        level: e.level,
        elementType: e.elementType,
        pieces: e.qty,
        totalLengthMm: lenMm * e.qty,
        totalWeightKg: weight,
        maxPieceLengthMm: lenMm,
        representativeSection: e.section,
      });
    }
  }
  return Array.from(map.values());
}

export function runSequencer(input: SequencerInput): SequencerResult {
  const tmpl = input.template ?? DEFAULT_DURATION_TEMPLATE;
  const calendar = buildWorkingCalendar(input.calendar);
  const aggregated = aggregate(input.elements);

  // Index aggregations by (block, level, type) for fast lookup.
  const lookup = new Map<string, Aggregated>();
  for (const a of aggregated) {
    lookup.set(`${a.block ?? ''}|${a.level}|${a.elementType}`, a);
  }

  const blocks: (string | null)[] = input.blocks.length > 0 ? input.blocks.slice() : [null];
  const levels = input.levels.slice();
  const activities: ScheduleActivity[] = [];

  // Track per-block "ready next floor" date so blocks can lag each other.
  const blockNextLevelStart = new Map<string | null, string>();

  for (let bi = 0; bi < blocks.length; bi++) {
    const block = blocks[bi];
    let levelStart = input.calendar.startDateIso;
    if (bi > 0) {
      // Block N+1 starts when block N has reached level (1 + blockOverlapFloors).
      const prevBlock = blocks[bi - 1];
      const idx = Math.min(tmpl.blockOverlapFloors, levels.length - 1);
      const lagLevel = levels[idx];
      const referenceActivity = activities.find(
        (a) =>
          a.block === prevBlock &&
          a.level === lagLevel &&
          tmpl.cycleOrder.includes(a.elementType),
      );
      if (referenceActivity) {
        levelStart = calendar.next(referenceActivity.endIso);
      } else {
        levelStart = blockNextLevelStart.get(prevBlock) ?? levelStart;
      }
    }
    levelStart = calendar.next(addDays(levelStart, -1));
    if (!calendar.isWorking(levelStart)) {
      levelStart = calendar.next(levelStart);
    }

    for (const level of levels) {
      let cursor = levelStart;
      // Run cycle activities sequentially.
      for (const elementType of tmpl.cycleOrder) {
        const agg = lookup.get(`${block ?? ''}|${level}|${elementType}`);
        if (!agg || agg.pieces <= 0) continue;
        const ratePerDay = tmpl.piecesPerDay[elementType] ?? 16;
        const days = Math.max(1, Math.ceil(agg.pieces / ratePerDay));
        const endIso = calendar.add(cursor, days - 1);
        activities.push({
          block,
          level,
          elementType,
          startIso: cursor,
          endIso,
          workingDays: days,
          totalPieces: agg.pieces,
          totalWeightKg: Math.round(agg.totalWeightKg),
        });
        cursor = calendar.next(endIso);
      }
      // Optional parallel tasks: kaidan, elevator — schedule starting on the
      // last cycle day so they overlap rather than blocking.
      for (const optionalType of ['kaidan', 'elevator'] as StructuralElementType[]) {
        const agg = lookup.get(`${block ?? ''}|${level}|${optionalType}`);
        if (!agg || agg.pieces <= 0) continue;
        const ratePerDay = tmpl.piecesPerDay[optionalType] ?? 4;
        const days = Math.max(1, Math.ceil(agg.pieces / ratePerDay));
        const optionalStart = activities.length > 0
          ? activities[activities.length - 1].endIso
          : levelStart;
        const endIso = calendar.add(optionalStart, days - 1);
        activities.push({
          block,
          level,
          elementType: optionalType,
          startIso: optionalStart,
          endIso,
          workingDays: days,
          totalPieces: agg.pieces,
          totalWeightKg: Math.round(agg.totalWeightKg),
        });
      }
      // Slab cure before next level can start columns.
      const lastEnd = activities.length > 0 ? activities[activities.length - 1].endIso : cursor;
      levelStart = calendar.add(lastEnd, tmpl.slabCureDays);
      blockNextLevelStart.set(block, levelStart);
    }
  }

  // Build daily demand map.
  const dailyDemand: Record<string, ActivityDemand[]> = {};
  for (const a of activities) {
    const piecesPerDay = Math.max(1, Math.ceil(a.totalPieces / a.workingDays));
    let remaining = a.totalPieces;
    let cur = a.startIso;
    for (let day = 0; day < a.workingDays; day++) {
      const today = day === a.workingDays - 1 ? remaining : Math.min(piecesPerDay, remaining);
      remaining -= today;
      const aggKey = `${a.block ?? ''}|${a.level}|${a.elementType}`;
      const agg = lookup.get(aggKey);
      const lenMm = agg?.maxPieceLengthMm ?? DEFAULT_PIECE_LENGTH_MM[a.elementType] ?? 4000;
      const weight = today > 0 && a.totalPieces > 0
        ? Math.round((a.totalWeightKg * today) / a.totalPieces)
        : 0;
      if (!dailyDemand[cur]) dailyDemand[cur] = [];
      dailyDemand[cur].push({
        block: a.block,
        level: a.level,
        elementType: a.elementType,
        pieces: today,
        kg: weight,
        maxLengthMm: lenMm,
      });
      cur = calendar.next(cur);
    }
  }

  const workingDays = Object.keys(dailyDemand).sort();
  const endIso = workingDays.length > 0 ? workingDays[workingDays.length - 1] : input.calendar.startDateIso;

  return {
    activities,
    dailyDemand,
    workingDays,
    endIso,
  };
}

function addDays(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map((s) => Number.parseInt(s, 10));
  const t = new Date(Date.UTC(y, (m || 1) - 1, d || 1));
  t.setUTCDate(t.getUTCDate() + days);
  return `${t.getUTCFullYear()}-${pad2(t.getUTCMonth() + 1)}-${pad2(t.getUTCDate())}`;
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}
