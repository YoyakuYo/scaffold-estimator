/**
 * Commercial tiers: Basic / Medium / Premium (plus legacy starter/professional).
 * Used for feature gating and seat limits at company level.
 */
export interface EffectivePlanCapabilities {
  maxSeats: number;
  fileUpload: boolean;
  quickShape: boolean;
  cadDraw: boolean;
  aiExtract: boolean;
}

export const SUPERADMIN_CAPABILITIES: EffectivePlanCapabilities = {
  maxSeats: 9999,
  fileUpload: true,
  quickShape: true,
  cadDraw: true,
  aiExtract: true,
};

/** No valid subscription — scaffold / AI blocked */
export const NO_ACCESS_CAPABILITIES: EffectivePlanCapabilities = {
  maxSeats: 0,
  fileUpload: false,
  quickShape: false,
  cadDraw: false,
  aiExtract: false,
};

export function capabilitiesForPlan(plan: string): EffectivePlanCapabilities {
  switch (plan) {
    case 'basic':
    case 'starter':
      return {
        maxSeats: 2,
        fileUpload: true,
        quickShape: true,
        cadDraw: false,
        aiExtract: false,
      };
    case 'medium':
    case 'professional':
      return {
        maxSeats: 5,
        fileUpload: true,
        quickShape: true,
        cadDraw: true,
        aiExtract: false,
      };
    case 'premium':
      return {
        maxSeats: 20,
        fileUpload: true,
        quickShape: true,
        cadDraw: true,
        aiExtract: true,
      };
    case 'enterprise':
      return { ...SUPERADMIN_CAPABILITIES };
    default:
      return { ...NO_ACCESS_CAPABILITIES };
  }
}

/** Active trial: Quick + file upload only (no CAD, no AI); 2 seats; max 2 drawing uploads enforced separately */
export function capabilitiesForTrial(): EffectivePlanCapabilities {
  return {
    maxSeats: 2,
    fileUpload: true,
    quickShape: true,
    cadDraw: false,
    aiExtract: false,
  };
}

export function mergeCapabilitiesMax(
  a: EffectivePlanCapabilities,
  b: EffectivePlanCapabilities,
): EffectivePlanCapabilities {
  return {
    maxSeats: Math.max(a.maxSeats, b.maxSeats),
    fileUpload: a.fileUpload || b.fileUpload,
    quickShape: a.quickShape || b.quickShape,
    cadDraw: a.cadDraw || b.cadDraw,
    aiExtract: a.aiExtract || b.aiExtract,
  };
}
