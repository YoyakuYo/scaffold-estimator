/**
 * Phase 2 — multi-product platform.
 *
 * Each top-level product is sold/billed independently. A user (or company) can
 * subscribe to any subset; their dashboard shows all three cards always, with
 * locked overlays on products they have not paid for. Stripe holds one Product
 * per app code (plus an optional Suite bundle).
 */
export type ProductCode = 'scaffold' | 'bim' | 'construction_plan';

export const PRODUCT_CODES: readonly ProductCode[] = ['scaffold', 'bim', 'construction_plan'] as const;

export interface ProductDef {
  code: ProductCode;
  /** i18n key prefix for display strings: title, tagline, locked CTA, etc. */
  i18nKey: string;
  /** URL prefixes guarded by this product (used by ProductAccessGuard). */
  routes: string[];
  /**
   * Stripe price IDs keyed by interval. Read from env at runtime so price IDs
   * never get hardcoded into the build. Missing env = no Stripe checkout for
   * that product (UI shows "Contact us" / bank wire instead).
   */
  stripePriceEnv: { monthly: string; yearly?: string };
}

/**
 * Always-on product registry. Adding a new product = add a new row here,
 * a new Stripe price env var, an EffectiveAccess slot, and a dashboard card.
 */
export const PRODUCTS: Record<ProductCode, ProductDef> = {
  scaffold: {
    code: 'scaffold',
    i18nKey: 'productScaffold',
    routes: ['/scaffold', '/quotations', '/cost', '/estimates', '/quantities'],
    stripePriceEnv: { monthly: 'STRIPE_PRICE_SCAFFOLD_MONTHLY' },
  },
  bim: {
    code: 'bim',
    i18nKey: 'productBim',
    routes: ['/bim'],
    stripePriceEnv: { monthly: 'STRIPE_PRICE_BIM_MONTHLY' },
  },
  construction_plan: {
    code: 'construction_plan',
    i18nKey: 'productConstructionPlan',
    routes: ['/construction-plan', '/structural-takeoff'],
    stripePriceEnv: { monthly: 'STRIPE_PRICE_CONSTRUCTION_PLAN_MONTHLY' },
  },
};

/**
 * Optional Suite bundle (all 3 products at a discount). Maps to its own Stripe
 * price; the webhook expands one bundle subscription into three rows
 * (one per product, sharing `stripeSubscriptionId`).
 */
export const SUITE_PRICE_ENV = 'STRIPE_PRICE_SUITE_MONTHLY';

/** Resolve a Stripe price id to its product, or null if unmapped. */
export function priceIdToProduct(
  priceId: string | null | undefined,
  envGet: (k: string) => string | undefined,
): { product: ProductCode | 'suite'; isSuite: boolean } | null {
  if (!priceId) return null;
  const suite = envGet(SUITE_PRICE_ENV)?.trim();
  if (suite && suite === priceId) return { product: 'suite', isSuite: true };
  for (const def of Object.values(PRODUCTS)) {
    const monthly = envGet(def.stripePriceEnv.monthly)?.trim();
    if (monthly && monthly === priceId) return { product: def.code, isSuite: false };
    if (def.stripePriceEnv.yearly) {
      const yearly = envGet(def.stripePriceEnv.yearly)?.trim();
      if (yearly && yearly === priceId) return { product: def.code, isSuite: false };
    }
  }
  return null;
}

/** Return URL prefix → product map. Used by frontend route guard. */
export function productForRoute(pathname: string): ProductCode | null {
  if (!pathname) return null;
  for (const def of Object.values(PRODUCTS)) {
    for (const prefix of def.routes) {
      if (pathname === prefix || pathname.startsWith(`${prefix}/`)) return def.code;
    }
  }
  return null;
}
