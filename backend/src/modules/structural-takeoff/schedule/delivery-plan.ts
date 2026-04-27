/**
 * Phase 4 — combine erection sequencer output + truck bin-packer into a
 * single per-day delivery plan + flat truck manifest. This is what the
 * Excel exporter, the schedule UI, and the daily printable cards all read.
 */
import type { ActivityDemand, ScheduleActivity } from './erection-sequencer';
import { packDay, type TruckLoad, type TruckSpec } from './truck-bin-pack';
import type { StructuralElementType } from '../element-types';

export interface DailyPlanRow {
  date: string;
  /** Day of week ISO 1-7. */
  dow: number;
  totalPieces: number;
  totalKg: number;
  trucks: TruckLoad[];
}

export interface DeliveryPlanResult {
  days: DailyPlanRow[];
  /** Full flat list (one row per truck). */
  trucks: Array<{
    date: string;
    dow: number;
    binNo: number;
    load: TruckLoad;
  }>;
  /** Aggregates for monthly / weekly summary sheets. */
  monthly: Array<{ month: string; pieces: number; kg: number; trucks: number; days: number }>;
  weekly: Array<{ isoWeek: string; pieces: number; kg: number; trucks: number; days: number }>;
  /** byType[type] = total pieces / kg over the whole plan. */
  byType: Record<StructuralElementType, { pieces: number; kg: number }>;
}

export function buildDeliveryPlan(
  activities: ScheduleActivity[],
  dailyDemand: Record<string, ActivityDemand[]>,
  trucks?: TruckSpec[],
): DeliveryPlanResult {
  const days: DailyPlanRow[] = [];
  const flatTrucks: DeliveryPlanResult['trucks'] = [];
  const monthly = new Map<string, { pieces: number; kg: number; trucks: number; days: Set<string> }>();
  const weekly = new Map<string, { pieces: number; kg: number; trucks: number; days: Set<string> }>();
  const byType: Record<StructuralElementType, { pieces: number; kg: number }> = {
    hashira: { pieces: 0, kg: 0 },
    oobari: { pieces: 0, kg: 0 },
    kobari: { pieces: 0, kg: 0 },
    taifubari: { pieces: 0, kg: 0 },
    brace: { pieces: 0, kg: 0 },
    kaidan: { pieces: 0, kg: 0 },
    elevator: { pieces: 0, kg: 0 },
    deck: { pieces: 0, kg: 0 },
  };

  const sortedDates = Object.keys(dailyDemand).sort();
  for (const date of sortedDates) {
    const demand = dailyDemand[date];
    if (!demand || demand.length === 0) continue;
    const packed = packDay({ date, demand, trucks });
    const totalPieces = demand.reduce((s, d) => s + d.pieces, 0);
    const totalKg = demand.reduce((s, d) => s + d.kg, 0);
    const dow = isoDow(date);
    days.push({ date, dow, totalPieces, totalKg: Math.round(totalKg), trucks: packed.trucks });

    let binNo = 1;
    for (const truck of packed.trucks) {
      flatTrucks.push({ date, dow, binNo, load: truck });
      binNo += 1;
    }

    // Roll up by month + week.
    const month = date.slice(0, 7);
    const isoWeek = isoYearWeek(date);
    const monthBucket = monthly.get(month) ?? { pieces: 0, kg: 0, trucks: 0, days: new Set<string>() };
    monthBucket.pieces += totalPieces;
    monthBucket.kg += totalKg;
    monthBucket.trucks += packed.trucks.length;
    monthBucket.days.add(date);
    monthly.set(month, monthBucket);

    const weekBucket = weekly.get(isoWeek) ?? { pieces: 0, kg: 0, trucks: 0, days: new Set<string>() };
    weekBucket.pieces += totalPieces;
    weekBucket.kg += totalKg;
    weekBucket.trucks += packed.trucks.length;
    weekBucket.days.add(date);
    weekly.set(isoWeek, weekBucket);

    // Sum by type from demand.
    for (const d of demand) {
      byType[d.elementType].pieces += d.pieces;
      byType[d.elementType].kg += Math.round(d.kg);
    }
  }

  return {
    days,
    trucks: flatTrucks,
    monthly: Array.from(monthly.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, v]) => ({
        month,
        pieces: v.pieces,
        kg: Math.round(v.kg),
        trucks: v.trucks,
        days: v.days.size,
      })),
    weekly: Array.from(weekly.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([isoWeek, v]) => ({
        isoWeek,
        pieces: v.pieces,
        kg: Math.round(v.kg),
        trucks: v.trucks,
        days: v.days.size,
      })),
    byType,
  };
}

function isoDow(iso: string): number {
  const [y, m, d] = iso.split('-').map((s) => Number.parseInt(s, 10));
  const day = new Date(Date.UTC(y, (m || 1) - 1, d || 1)).getUTCDay();
  return day === 0 ? 7 : day; // ISO Mon=1..Sun=7
}

function isoYearWeek(iso: string): string {
  const [y, m, d] = iso.split('-').map((s) => Number.parseInt(s, 10));
  const t = new Date(Date.UTC(y, (m || 1) - 1, d || 1));
  const dayNum = (t.getUTCDay() + 6) % 7; // Mon=0..Sun=6
  t.setUTCDate(t.getUTCDate() - dayNum + 3);
  const firstThursday = new Date(Date.UTC(t.getUTCFullYear(), 0, 4));
  const diff = (t.getTime() - firstThursday.getTime()) / 86_400_000;
  const week = 1 + Math.round(diff / 7);
  return `${t.getUTCFullYear()}-W${week.toString().padStart(2, '0')}`;
}
