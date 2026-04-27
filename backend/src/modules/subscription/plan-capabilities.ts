import type { ProductCode } from './products';

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
  /** Interactive 3D view + 3D exports (Medium / Premium / Enterprise; legacy Professional matches Medium). */
  view3d: boolean;
  /**
   * Bank wire tier `monthly`: priced per scaffold project (not a large seat bundle).
   * Used only for feature/display inference; merge with OR across company subs.
   */
  perProjectWire?: boolean;
}

export const SUPERADMIN_CAPABILITIES: EffectivePlanCapabilities = {
  maxSeats: 9999,
  fileUpload: true,
  quickShape: true,
  cadDraw: true,
  aiExtract: true,
  view3d: true,
};

/** No valid subscription — scaffold / AI blocked */
export const NO_ACCESS_CAPABILITIES: EffectivePlanCapabilities = {
  maxSeats: 0,
  fileUpload: false,
  quickShape: false,
  cadDraw: false,
  aiExtract: false,
  view3d: false,
};

export function capabilitiesForPlan(plan: string): EffectivePlanCapabilities {
  switch (plan) {
    case 'basic':
    case 'starter':
      return {
        maxSeats: 1,
        fileUpload: true,
        quickShape: true,
        cadDraw: false,
        aiExtract: false,
        view3d: false,
      };
    case 'medium':
    case 'professional':
      return {
        maxSeats: 5,
        fileUpload: true,
        quickShape: true,
        cadDraw: true,
        aiExtract: false,
        view3d: true,
      };
    /** Bank per-project wire: full CAD/3D/upload tier except AI; single user. */
    case 'monthly':
      return {
        maxSeats: 1,
        fileUpload: true,
        quickShape: true,
        cadDraw: true,
        aiExtract: false,
        view3d: true,
        perProjectWire: true,
      };
    case 'premium':
      return {
        maxSeats: 20,
        fileUpload: true,
        quickShape: true,
        cadDraw: true,
        aiExtract: true,
        view3d: true,
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
    view3d: false,
  };
}

/** Maps merged company capabilities to a plan label for API responses (invited seats inherit org tier). */
export function inferDisplayPlanFromCapabilities(caps: EffectivePlanCapabilities): string {
  if (caps.maxSeats <= 0) return 'free_trial';
  if (caps.maxSeats >= 9000) return 'enterprise';
  if (caps.aiExtract) return 'premium';
  if (caps.perProjectWire && caps.cadDraw && caps.view3d && !caps.aiExtract) return 'monthly';
  if (caps.cadDraw || caps.view3d || caps.maxSeats > 2) return 'medium';
  return 'basic';
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
    view3d: a.view3d || b.view3d,
    perProjectWire: !!(a.perProjectWire || b.perProjectWire),
  };
}

// ─── Phase 2: per-product access ─────────────────────────────────────

/**
 * Per-product effective access. The dashboard renders one card per product;
 * each card reads `hasAccess` to decide whether to show the unlocked product
 * UI or a locked overlay with a Subscribe CTA.
 *
 * Capabilities are kept generic for now (`scaffold` keeps the rich legacy
 * capability shape; `bim` and `construction_plan` start with a minimal seat
 * shape that we extend as those products grow).
 */
export interface ProductAccess<Caps> {
  hasAccess: boolean;
  /** When false: trialing | inactive | canceled | no_subscription. */
  reason: 'active' | 'trial' | 'no_subscription' | 'expired' | 'canceled' | 'unknown';
  /** Plan label for display (e.g. 'premium', 'free_trial', '—'). */
  plan: string;
  /** ISO date when the trial ends, if any. */
  trialEnd: string | null;
  /** ISO date when the current paid period ends, if any. */
  currentPeriodEnd: string | null;
  caps: Caps;
}

export interface BimCaps {
  maxSeats: number;
  ifcUpload: boolean;
  dxfImport: boolean;
  view3d: boolean;
  aiExtract: boolean;
}

export interface ConstructionPlanCaps {
  maxSeats: number;
  manualEntry: boolean;
  excelImport: boolean;
  dxfLayer: boolean;
  aiExtract: boolean;
  truckPlanner: boolean;
  ganttExport: boolean;
}

export type EffectiveAccess = {
  scaffold: ProductAccess<EffectivePlanCapabilities>;
  bim: ProductAccess<BimCaps>;
  construction_plan: ProductAccess<ConstructionPlanCaps>;
};

const NO_BIM_CAPS: BimCaps = {
  maxSeats: 0,
  ifcUpload: false,
  dxfImport: false,
  view3d: false,
  aiExtract: false,
};

const NO_CONSTRUCTION_CAPS: ConstructionPlanCaps = {
  maxSeats: 0,
  manualEntry: false,
  excelImport: false,
  dxfLayer: false,
  aiExtract: false,
  truckPlanner: false,
  ganttExport: false,
};

/** Locked / no-subscription product card (default for products the user has not paid for). */
export function lockedProductAccess<Caps>(zeroCaps: Caps): ProductAccess<Caps> {
  return {
    hasAccess: false,
    reason: 'no_subscription',
    plan: 'free_trial',
    trialEnd: null,
    currentPeriodEnd: null,
    caps: zeroCaps,
  };
}

export function lockedAccessAllProducts(): EffectiveAccess {
  return {
    scaffold: lockedProductAccess(NO_ACCESS_CAPABILITIES),
    bim: lockedProductAccess(NO_BIM_CAPS),
    construction_plan: lockedProductAccess(NO_CONSTRUCTION_CAPS),
  };
}

/**
 * Map a Subscription row + tier to product caps. The scaffold product still
 * uses the rich plan-capabilities table; bim and construction_plan use simple
 * tier-based caps that mostly mirror Premium (full feature set per product).
 */
export function bimCapsForPlan(plan: string): BimCaps {
  const base = capabilitiesForPlan(plan);
  if (base.maxSeats <= 0) return NO_BIM_CAPS;
  return {
    maxSeats: base.maxSeats,
    ifcUpload: true,
    dxfImport: true,
    view3d: true,
    aiExtract: !!base.aiExtract,
  };
}

export function constructionPlanCapsForPlan(plan: string): ConstructionPlanCaps {
  const base = capabilitiesForPlan(plan);
  if (base.maxSeats <= 0) return NO_CONSTRUCTION_CAPS;
  return {
    maxSeats: base.maxSeats,
    manualEntry: true,
    excelImport: true,
    dxfLayer: true,
    aiExtract: !!base.aiExtract,
    truckPlanner: true,
    ganttExport: true,
  };
}

/** Convenience guard for Nest controllers. */
export function hasProduct(access: EffectiveAccess, code: ProductCode): boolean {
  return access[code]?.hasAccess === true;
}
