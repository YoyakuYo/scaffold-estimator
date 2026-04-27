/**
 * Phase 4 — working calendar arithmetic.
 *
 * Pure functions, no DI. The site calendar is described by a tiny, stable
 * options object so callers can persist preferences in `construction_plan_projects`
 * (e.g. "土曜稼働", "盆休 8/13–16").
 *
 * Holidays are seeded with a known default list of Japanese public holidays
 * for 2026 and 2027; admins can override per-project.
 */

export interface WorkingCalendarOptions {
  /** Project start date (inclusive). ISO yyyy-mm-dd. */
  startDateIso: string;
  /** Whether Saturday counts as a working day. Default: true. */
  workSaturday?: boolean;
  /** Whether Sunday counts as a working day. Default: false. */
  workSunday?: boolean;
  /** Additional holiday ISO dates (yyyy-mm-dd). Combined with default JP holidays. */
  extraHolidaysIso?: string[];
  /** When true, the seeded JP holiday list is included. Default: true. */
  includeJpHolidays?: boolean;
}

/**
 * Public holidays for Japan, seed list (2026/2027). Update when calendar changes.
 * Source: 国民の祝日に関する法律 (公表されている内閣府リスト).
 */
const JP_HOLIDAYS: string[] = [
  // 2026
  '2026-01-01',
  '2026-01-12',
  '2026-02-11',
  '2026-02-23',
  '2026-03-20',
  '2026-04-29',
  '2026-05-03',
  '2026-05-04',
  '2026-05-05',
  '2026-05-06', // 振替休日
  '2026-07-20',
  '2026-08-11',
  '2026-09-21',
  '2026-09-22', // 国民の休日
  '2026-09-23',
  '2026-10-12',
  '2026-11-03',
  '2026-11-23',
  // 2027
  '2027-01-01',
  '2027-01-11',
  '2027-02-11',
  '2027-02-23',
  '2027-03-21',
  '2027-03-22', // 振替休日
  '2027-04-29',
  '2027-05-03',
  '2027-05-04',
  '2027-05-05',
  '2027-07-19',
  '2027-08-11',
  '2027-09-20',
  '2027-09-23',
  '2027-10-11',
  '2027-11-03',
  '2027-11-23',
];

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

export function isoFromDate(date: Date): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

export function dateFromIso(iso: string): Date {
  const [y, m, d] = iso.split('-').map((s) => Number.parseInt(s, 10));
  return new Date(Date.UTC(y, (m || 1) - 1, d || 1));
}

/** 0=Sun ... 6=Sat (UTC). */
export function dayOfWeekUtc(iso: string): number {
  return dateFromIso(iso).getUTCDay();
}

export function buildWorkingCalendar(options: WorkingCalendarOptions): {
  isWorking(iso: string): boolean;
  next(iso: string): string;
  add(iso: string, businessDays: number): string;
  range(startIso: string, endIso: string): string[];
  totalWorkingDaysBetween(startIso: string, endIso: string): number;
  holidaysSet(): Set<string>;
} {
  const workSaturday = options.workSaturday ?? true;
  const workSunday = options.workSunday ?? false;
  const includeJp = options.includeJpHolidays ?? true;
  const extra = options.extraHolidaysIso ?? [];
  const holidays = new Set<string>([...(includeJp ? JP_HOLIDAYS : []), ...extra]);

  const isWorking = (iso: string): boolean => {
    if (holidays.has(iso)) return false;
    const dow = dayOfWeekUtc(iso);
    if (dow === 0) return workSunday;
    if (dow === 6) return workSaturday;
    return true;
  };

  const next = (iso: string): string => {
    let d = dateFromIso(iso);
    for (let i = 0; i < 31; i++) {
      d = new Date(d.getTime() + 86_400_000);
      const candidate = isoFromDate(d);
      if (isWorking(candidate)) return candidate;
    }
    return iso;
  };

  const add = (iso: string, businessDays: number): string => {
    if (businessDays <= 0) return iso;
    let cur = iso;
    let added = 0;
    while (added < businessDays) {
      cur = next(cur);
      added++;
    }
    return cur;
  };

  const range = (startIso: string, endIso: string): string[] => {
    const out: string[] = [];
    let d = dateFromIso(startIso);
    const end = dateFromIso(endIso);
    while (d.getTime() <= end.getTime()) {
      out.push(isoFromDate(d));
      d = new Date(d.getTime() + 86_400_000);
    }
    return out;
  };

  const totalWorkingDaysBetween = (startIso: string, endIso: string): number => {
    return range(startIso, endIso).filter(isWorking).length;
  };

  return {
    isWorking,
    next,
    add,
    range,
    totalWorkingDaysBetween,
    holidaysSet: () => new Set(holidays),
  };
}

/** Today as ISO (UTC) — useful as a default project start. */
export function todayIso(): string {
  return isoFromDate(new Date());
}
