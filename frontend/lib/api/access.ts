import apiClient from './client';

export type ProductCode = 'scaffold' | 'bim' | 'construction_plan';

export const PRODUCT_CODES: readonly ProductCode[] = [
  'scaffold',
  'bim',
  'construction_plan',
] as const;

export interface ScaffoldCaps {
  maxSeats: number;
  fileUpload: boolean;
  quickShape: boolean;
  cadDraw: boolean;
  aiExtract: boolean;
  view3d: boolean;
  perProjectWire?: boolean;
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

export type ProductReason =
  | 'active'
  | 'trial'
  | 'no_subscription'
  | 'expired'
  | 'canceled'
  | 'unknown';

export interface ProductAccess<Caps> {
  hasAccess: boolean;
  reason: ProductReason;
  plan: string;
  trialEnd: string | null;
  currentPeriodEnd: string | null;
  caps: Caps;
}

export interface EffectiveAccess {
  scaffold: ProductAccess<ScaffoldCaps>;
  bim: ProductAccess<BimCaps>;
  construction_plan: ProductAccess<ConstructionPlanCaps>;
}

export const accessApi = {
  /** Per-product entitlements for the current user. */
  getEffectiveAccess: async (): Promise<EffectiveAccess> => {
    const res = await apiClient.get<EffectiveAccess>('/subscriptions/me/access');
    return res.data;
  },
};

/**
 * Convenience helpers used by the dashboard / route guard.
 */
export function isProductUnlocked(access: EffectiveAccess | null | undefined, code: ProductCode): boolean {
  if (!access) return false;
  return access[code]?.hasAccess === true;
}

/** URL → product, mirroring backend products.ts route prefixes. */
const PRODUCT_ROUTE_PREFIX: Record<ProductCode, string[]> = {
  scaffold: ['/scaffold', '/quotations', '/cost', '/estimates', '/quantities'],
  bim: ['/bim'],
  construction_plan: ['/construction-plan', '/structural-takeoff'],
};

export function productForRoute(pathname: string): ProductCode | null {
  if (!pathname) return null;
  for (const code of PRODUCT_CODES) {
    for (const prefix of PRODUCT_ROUTE_PREFIX[code]) {
      if (pathname === prefix || pathname.startsWith(`${prefix}/`)) return code;
    }
  }
  return null;
}
