/**
 * Phase 4 — greedy 1D bin packer for truck loads.
 *
 * Constraints (per-truck): max payload weight, max bed length, optional
 * "long-piece permit" gate. We separate by element type per truck so the
 * foreman gets a clean delivery sheet (one truck = one category, mostly).
 */
import type { ActivityDemand } from './erection-sequencer';
import type { StructuralElementType } from '../element-types';
import { DEFAULT_PIECE_LENGTH_MM } from './jis-sections';

export type TruckType = '4t' | '4tunic' | '10t' | '25t_trailer';

export interface TruckSpec {
  type: TruckType;
  /** Max payload kg. */
  payloadKg: number;
  /** Max bed length mm. */
  bedLengthMm: number;
  /** Whether this truck can carry pieces longer than 12 m (needs road permit). */
  acceptsLongPieces: boolean;
  /** UI label key fragment. */
  label: string;
}

export const DEFAULT_TRUCKS: TruckSpec[] = [
  { type: '4tunic', payloadKg: 4000, bedLengthMm: 6000, acceptsLongPieces: false, label: '4tユニック' },
  { type: '4t', payloadKg: 4000, bedLengthMm: 6000, acceptsLongPieces: false, label: '4t平' },
  { type: '10t', payloadKg: 10000, bedLengthMm: 13000, acceptsLongPieces: false, label: '10t平' },
  { type: '25t_trailer', payloadKg: 25000, bedLengthMm: 17000, acceptsLongPieces: true, label: '25tトレーラー' },
];

const ELEMENT_TYPE_TRUCK_PREFERENCE: Record<StructuralElementType, TruckType[]> = {
  hashira: ['10t', '25t_trailer'],
  oobari: ['10t', '25t_trailer'],
  kobari: ['4t', '10t'],
  taifubari: ['25t_trailer', '10t'],
  brace: ['4t', '10t'],
  kaidan: ['4tunic', '4t'],
  elevator: ['4tunic', '4t'],
  deck: ['10t', '4t'],
};

export interface TruckLoad {
  truckType: TruckType;
  truckLabel: string;
  payloadKg: number;
  bedLengthMm: number;
  totalKg: number;
  totalLengthMm: number;
  /** All items on this truck. */
  items: Array<{
    block: string | null;
    level: string;
    elementType: StructuralElementType;
    pieces: number;
    pieceLengthMm: number;
    kg: number;
  }>;
  notes: string[];
}

export interface PackDayInput {
  date: string;
  demand: ActivityDemand[];
  trucks?: TruckSpec[];
}

export interface PackDayResult {
  date: string;
  trucks: TruckLoad[];
}

/**
 * Greedy first-fit-decreasing within element-type groups.
 *  - For each group, sort pieces by length descending.
 *  - Pick the smallest truck whose bed and payload accept the longest piece.
 *  - Open more trucks of the same type as needed.
 *  - Long pieces (>12 m) force 25t_trailer with note `road_permit_required`.
 */
export function packDay(input: PackDayInput): PackDayResult {
  const trucks = input.trucks ?? DEFAULT_TRUCKS;
  const out: TruckLoad[] = [];
  // Group day demand by element type while preserving block/level info.
  const groups = new Map<StructuralElementType, ActivityDemand[]>();
  for (const d of input.demand) {
    if (d.pieces <= 0) continue;
    const k = d.elementType;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(d);
  }

  for (const [elementType, items] of groups.entries()) {
    const expanded: Array<{ block: string | null; level: string; pieceLengthMm: number; kg: number }> = [];
    for (const item of items) {
      const lenMm = item.maxLengthMm > 0 ? item.maxLengthMm : DEFAULT_PIECE_LENGTH_MM[elementType] ?? 4000;
      const perPieceKg = item.pieces > 0 ? item.kg / item.pieces : 0;
      for (let i = 0; i < item.pieces; i++) {
        expanded.push({
          block: item.block,
          level: item.level,
          pieceLengthMm: lenMm,
          kg: Math.max(0, perPieceKg),
        });
      }
    }
    expanded.sort((a, b) => b.pieceLengthMm - a.pieceLengthMm);

    const preferences = ELEMENT_TYPE_TRUCK_PREFERENCE[elementType] ?? ['10t'];

    let currentTruck: TruckLoad | null = null;
    const flushTruck = () => {
      if (currentTruck && currentTruck.items.length > 0) out.push(currentTruck);
      currentTruck = null;
    };

    for (const piece of expanded) {
      const requiresLong = piece.pieceLengthMm > 12000;
      const tryTypes = requiresLong ? (['25t_trailer'] as TruckType[]) : preferences;

      const fitsCurrent =
        currentTruck != null &&
        (!requiresLong || currentTruck.truckType === '25t_trailer') &&
        currentTruck.totalLengthMm + piece.pieceLengthMm <= currentTruck.bedLengthMm + 500 && // 500mm slack
        currentTruck.totalKg + piece.kg <= currentTruck.payloadKg;

      if (!fitsCurrent) {
        flushTruck();
        const spec =
          trucks.find((t) => tryTypes.includes(t.type) && piece.pieceLengthMm <= t.bedLengthMm + 500 && piece.kg <= t.payloadKg) ??
          trucks.find((t) => piece.pieceLengthMm <= t.bedLengthMm + 500 && piece.kg <= t.payloadKg) ??
          trucks[trucks.length - 1];
        currentTruck = {
          truckType: spec.type,
          truckLabel: spec.label,
          payloadKg: spec.payloadKg,
          bedLengthMm: spec.bedLengthMm,
          totalKg: 0,
          totalLengthMm: 0,
          items: [],
          notes: requiresLong ? ['road_permit_required'] : [],
        };
      }

      currentTruck!.items.push({
        block: piece.block,
        level: piece.level,
        elementType,
        pieces: 1,
        pieceLengthMm: piece.pieceLengthMm,
        kg: piece.kg,
      });
      currentTruck!.totalKg += piece.kg;
      currentTruck!.totalLengthMm += piece.pieceLengthMm;
    }
    flushTruck();
  }

  // Coalesce identical contiguous items into single rows for display.
  for (const truck of out) {
    const merged: typeof truck.items = [];
    for (const it of truck.items) {
      const prev = merged[merged.length - 1];
      if (
        prev &&
        prev.block === it.block &&
        prev.level === it.level &&
        prev.elementType === it.elementType &&
        prev.pieceLengthMm === it.pieceLengthMm
      ) {
        prev.pieces += it.pieces;
        prev.kg += it.kg;
      } else {
        merged.push({ ...it });
      }
    }
    truck.items = merged;
    truck.totalKg = Math.round(truck.totalKg);
  }

  return { date: input.date, trucks: out };
}
