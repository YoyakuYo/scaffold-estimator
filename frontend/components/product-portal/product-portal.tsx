'use client';

import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { accessApi, type EffectiveAccess, type ProductCode } from '@/lib/api/access';
import { authApi } from '@/lib/api/auth';
import { useI18n } from '@/lib/i18n';
import { ProductCard } from './product-card';

const SCAFFOLD_HREF = '/scaffold';
const BIM_HREF = '/bim';
const CONSTRUCTION_PLAN_HREF = '/construction-plan';

interface ProductPortalProps {
  /** Optional: bypass the API call and use a pre-resolved access object. */
  access?: EffectiveAccess | null;
  /** When set, only this product card is shown (dashboard hides other sections). */
  focusedProduct?: ProductCode | null;
  onFocusProduct?: (product: ProductCode) => void;
  onClearFocus?: () => void;
}

/**
 * Phase 2 — multi-product dashboard.
 * Renders three product cards always (Scaffold, BIM, Construction Plan).
 * Locked cards display a Subscribe CTA that deep-links to /billing#<code>.
 */
export function ProductPortal({
  access: accessProp,
  focusedProduct = null,
  onFocusProduct,
  onClearFocus,
}: ProductPortalProps) {
  const { t } = useI18n();
  const enabled = accessProp == null && !!authApi.getToken();
  const { data: fetched, isLoading } = useQuery({
    queryKey: ['effective-access'],
    queryFn: accessApi.getEffectiveAccess,
    enabled,
    staleTime: 60_000,
  });
  const access = accessProp ?? fetched ?? null;
  const isFocused = focusedProduct != null;

  return (
    <section className={isFocused ? 'mb-0' : 'mb-10'} aria-labelledby="product-portal-heading">
      <div className="flex flex-wrap items-end justify-between gap-3 mb-4">
        <div className="min-w-0 flex-1">
          {isFocused && onClearFocus ? (
            <button
              type="button"
              onClick={onClearFocus}
              className="inline-flex items-center gap-2 text-sm font-semibold text-gray-700 hover:text-gray-900 mb-2 rounded-lg py-1.5 pr-2 -ml-1 pl-1 focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-400"
            >
              <ArrowLeft className="h-4 w-4 shrink-0" aria-hidden />
              {t('products', 'backToAll')}
            </button>
          ) : null}
          <h2 id="product-portal-heading" className="text-2xl font-bold text-gray-900">
            {t('products', 'sectionTitle')}
          </h2>
          <p className="text-sm text-gray-500">
            {isFocused ? t('products', 'sectionSubtitleFocused') : t('products', 'sectionSubtitle')}
          </p>
        </div>
        {isLoading && <Loader2 className="h-5 w-5 animate-spin text-gray-400 shrink-0" />}
      </div>

      <div
        className={
          isFocused
            ? 'max-w-xl mx-auto w-full'
            : 'grid grid-cols-1 md:grid-cols-3 gap-4'
        }
      >
        {(!isFocused || focusedProduct === 'scaffold') && (
          <ProductCard
            product="scaffold"
            access={access?.scaffold}
            openHref={SCAFFOLD_HREF}
            onActivate={!isFocused ? () => onFocusProduct?.('scaffold') : undefined}
            isFocusLayout={isFocused}
          />
        )}
        {(!isFocused || focusedProduct === 'bim') && (
          <ProductCard
            product="bim"
            access={access?.bim}
            openHref={BIM_HREF}
            onActivate={!isFocused ? () => onFocusProduct?.('bim') : undefined}
            isFocusLayout={isFocused}
          />
        )}
        {(!isFocused || focusedProduct === 'construction_plan') && (
          <ProductCard
            product="construction_plan"
            access={access?.construction_plan}
            openHref={CONSTRUCTION_PLAN_HREF}
            onActivate={!isFocused ? () => onFocusProduct?.('construction_plan') : undefined}
            isFocusLayout={isFocused}
          />
        )}
      </div>
    </section>
  );
}
