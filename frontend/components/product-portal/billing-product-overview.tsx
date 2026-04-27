'use client';

import { useQuery } from '@tanstack/react-query';
import {
  Lock,
  CheckCircle2,
  Loader2,
  HardHat,
  Box,
  Calendar,
  ArrowRight,
} from 'lucide-react';
import { accessApi, type ProductCode, type EffectiveAccess } from '@/lib/api/access';
import { authApi } from '@/lib/api/auth';
import { useI18n } from '@/lib/i18n';

const PRODUCTS: ProductCode[] = ['scaffold', 'bim', 'construction_plan'];

const PRODUCT_ICON: Record<ProductCode, React.ComponentType<{ className?: string }>> = {
  scaffold: HardHat,
  bim: Box,
  construction_plan: Calendar,
};

const PRODUCT_TITLE_KEY: Record<ProductCode, 'productScaffold' | 'productBim' | 'productConstructionPlan'> = {
  scaffold: 'productScaffold',
  bim: 'productBim',
  construction_plan: 'productConstructionPlan',
};

interface Props {
  /** Optional pre-resolved access (avoids a second API call when caller already has it). */
  access?: EffectiveAccess | null;
}

/**
 * Phase 2 — billing page product overview.
 * Lists all 3 products with status badge + per-product Subscribe / Manage CTA,
 * deep-linked via URL hash so users coming from the dashboard land on the right card.
 */
export function BillingProductOverview({ access: accessProp }: Props = {}) {
  const { t } = useI18n();
  const enabled = accessProp == null && !!authApi.getToken();
  const { data: fetched, isLoading } = useQuery({
    queryKey: ['effective-access'],
    queryFn: accessApi.getEffectiveAccess,
    enabled,
    staleTime: 60_000,
  });
  const access = accessProp ?? fetched ?? null;

  return (
    <section className="mb-8" aria-labelledby="billing-products-heading">
      <div className="flex items-center justify-between mb-3">
        <h2 id="billing-products-heading" className="text-lg font-semibold text-gray-900">
          {t('products', 'billingOverviewTitle')}
        </h2>
        {isLoading && <Loader2 className="h-4 w-4 animate-spin text-gray-400" />}
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {PRODUCTS.map((code) => {
          const Icon = PRODUCT_ICON[code];
          const slot = access?.[code];
          const unlocked = !!slot?.hasAccess;
          const reason = slot?.reason ?? 'no_subscription';
          return (
            <div
              key={code}
              id={code}
              className={`bg-white rounded-xl border p-4 scroll-mt-24 ${
                unlocked ? 'border-green-200 ring-1 ring-green-100' : 'border-gray-200'
              }`}
            >
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <div className="h-9 w-9 rounded-lg bg-gray-100 flex items-center justify-center">
                    <Icon className="h-5 w-5 text-gray-700" />
                  </div>
                  <h3 className="font-semibold text-gray-900">{t('products', PRODUCT_TITLE_KEY[code])}</h3>
                </div>
                {unlocked ? (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700 border border-green-200">
                    <CheckCircle2 className="h-3 w-3" />
                    {reason === 'trial' ? t('products', 'badgeTrial') : t('products', 'badgeActive')}
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-600 border border-gray-200">
                    <Lock className="h-3 w-3" />
                    {t('products', 'badgeLocked')}
                  </span>
                )}
              </div>
              <p className="text-xs text-gray-500 mb-3">
                {slot?.plan ? `${t('products', 'planLabel')}: ${slot.plan}` : '—'}
              </p>
              {!unlocked && (
                <a
                  href="#payment-options"
                  className="inline-flex items-center gap-1 text-sm font-medium text-blue-600 hover:text-blue-700"
                >
                  {t('products', 'subscribeCta')}
                  <ArrowRight className="h-3.5 w-3.5" />
                </a>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
