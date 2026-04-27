import type { DeliveryPlanResult } from './delivery-plan';
import type { TruckType } from './truck-bin-pack';
import { DEFAULT_TRUCKS } from './truck-bin-pack';

export interface DeliveryPlanOverrideEdit {
  date: string;
  binNo: number;
  truckType?: TruckType;
  note?: string;
}

export interface DeliveryPlanOverridesPayload {
  trucks?: DeliveryPlanOverrideEdit[];
}

const TRUCK_LABEL_BY_TYPE: Record<TruckType, string> = DEFAULT_TRUCKS.reduce(
  (acc, spec) => {
    acc[spec.type] = spec.label;
    return acc;
  },
  {} as Record<TruckType, string>,
);

const TRUCK_PAYLOAD_BY_TYPE: Record<TruckType, { payloadKg: number; bedLengthMm: number }> =
  DEFAULT_TRUCKS.reduce(
    (acc, spec) => {
      acc[spec.type] = { payloadKg: spec.payloadKg, bedLengthMm: spec.bedLengthMm };
      return acc;
    },
    {} as Record<TruckType, { payloadKg: number; bedLengthMm: number }>,
  );

/**
 * Apply foreman overrides on top of a freshly-generated DeliveryPlanResult.
 * For each (date, binNo) edit, swap the truck type and tag a note. Other
 * derived fields (totalKg, totalLengthMm, items) are preserved — only the
 * vehicle assignment changes.
 *
 * Mutates and returns the same `plan` for convenience.
 */
export function applyDeliveryPlanOverrides(
  plan: DeliveryPlanResult,
  overrides: DeliveryPlanOverridesPayload | null | undefined,
): DeliveryPlanResult {
  if (!overrides?.trucks?.length) return plan;
  const byKey = new Map<string, DeliveryPlanOverrideEdit>();
  for (const e of overrides.trucks) {
    if (!e?.date || typeof e.binNo !== 'number') continue;
    byKey.set(`${e.date}|${e.binNo}`, e);
  }

  for (const day of plan.days) {
    let binNo = 1;
    for (const truck of day.trucks) {
      const edit = byKey.get(`${day.date}|${binNo}`);
      if (edit) {
        if (edit.truckType && TRUCK_LABEL_BY_TYPE[edit.truckType]) {
          truck.truckType = edit.truckType;
          truck.truckLabel = TRUCK_LABEL_BY_TYPE[edit.truckType];
          const spec = TRUCK_PAYLOAD_BY_TYPE[edit.truckType];
          if (spec) {
            truck.payloadKg = spec.payloadKg;
            truck.bedLengthMm = spec.bedLengthMm;
          }
        }
        if (edit.note) {
          if (!truck.notes.includes(edit.note)) truck.notes.push(edit.note);
        }
      }
      binNo += 1;
    }
  }

  // Re-generate flat truck list from the (now-edited) days so callers see the
  // overrides reflected in the search results too.
  plan.trucks = [];
  for (const day of plan.days) {
    let binNo = 1;
    for (const truck of day.trucks) {
      plan.trucks.push({ date: day.date, dow: day.dow, binNo, load: truck });
      binNo += 1;
    }
  }

  return plan;
}
