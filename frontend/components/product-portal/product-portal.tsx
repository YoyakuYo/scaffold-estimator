'use client';

import { useQuery } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { accessApi, type EffectiveAccess } from '@/lib/api/access';
import { authApi } from '@/lib/api/auth';
import { useI18n } from '@/lib/i18n';
import { ProductCard } from './product-card';

const SCAFFOLD_HREF = '/scaffold';
const BIM_HREF = '/bim';
const CONSTRUCTION_PLAN_HREF = '/construction-plan';

interface ProductPortalProps {
  /** Optional: bypass the API call and use a pre-resolved access object. */
  access?: EffectiveAccess | null;
}

/**
 * Phase 2 — multi-product dashboard.
 * Renders three product cards always (Scaffold, BIM, Construction Plan).
 * Locked cards display a Subscribe CTA that deep-links to /billing#<code>.
 */
export function ProductPortal({ access: accessProp }: ProductPortalProps = {}) {
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
    <section className="mb-10" aria-labelledby="product-portal-heading">
      <div className="flex items-end justify-between mb-4">
        <div>
          <h2 id="product-portal-heading" className="text-2xl font-bold text-gray-900">
            {t('products', 'sectionTitle')}
          </h2>
          <p className="text-sm text-gray-500">{t('products', 'sectionSubtitle')}</p>
        </div>
        {isLoading && <Loader2 className="h-5 w-5 animate-spin text-gray-400" />}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <ProductCard
          product="scaffold"
          access={access?.scaffold}
          openHref={SCAFFOLD_HREF}
        />
        <ProductCard
          product="bim"
          access={access?.bim}
          openHref={BIM_HREF}
        />
        <ProductCard
          product="construction_plan"
          access={access?.construction_plan}
          openHref={CONSTRUCTION_PLAN_HREF}
        />
      </div>
    </section>
  );
}
