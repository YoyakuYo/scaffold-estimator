'use client';

import Link from 'next/link';
import {
  Lock,
  ArrowRight,
  CheckCircle2,
  HardHat,
  Box,
  Calendar,
} from 'lucide-react';
import type { ProductAccess, ProductCode } from '@/lib/api/access';
import { useI18n } from '@/lib/i18n';

interface ProductCardProps {
  product: ProductCode;
  access: ProductAccess<unknown> | undefined;
  /** Where the primary CTA goes when the product is unlocked. */
  openHref: string;
  /** Clicking the card (outside links) focuses this product on the dashboard. */
  onActivate?: () => void;
  /** Larger layout when the dashboard is in single-product focus mode. */
  isFocusLayout?: boolean;
}

const PRODUCT_ICON: Record<ProductCode, React.ComponentType<{ className?: string }>> = {
  scaffold: HardHat,
  bim: Box,
  construction_plan: Calendar,
};

const PRODUCT_ACCENT: Record<ProductCode, { from: string; to: string; ring: string }> = {
  scaffold: { from: 'from-blue-500/10', to: 'to-blue-50', ring: 'ring-blue-200' },
  bim: { from: 'from-violet-500/10', to: 'to-violet-50', ring: 'ring-violet-200' },
  construction_plan: { from: 'from-amber-500/10', to: 'to-amber-50', ring: 'ring-amber-200' },
};

export function ProductCard({ product, access, openHref, onActivate, isFocusLayout }: ProductCardProps) {
  const { t } = useI18n();
  const Icon = PRODUCT_ICON[product];
  const accent = PRODUCT_ACCENT[product];

  const titleKey =
    product === 'scaffold'
      ? 'productScaffold'
      : product === 'bim'
        ? 'productBim'
        : 'productConstructionPlan';
  const taglineKey =
    product === 'scaffold'
      ? 'productScaffoldTagline'
      : product === 'bim'
        ? 'productBimTagline'
        : 'productConstructionPlanTagline';
  const bodyKey =
    product === 'scaffold'
      ? 'productScaffoldBody'
      : product === 'bim'
        ? 'productBimBody'
        : 'productConstructionPlanBody';

  const unlocked = !!access?.hasAccess;
  const reason = access?.reason ?? 'no_subscription';

  const activate = () => onActivate?.();

  const handleCardClick = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('a')) return;
    activate();
  };

  const handleCardKeyDown = (e: React.KeyboardEvent) => {
    if (!onActivate) return;
    if (e.key !== 'Enter' && e.key !== ' ') return;
    if ((e.target as HTMLElement).closest('a')) return;
    e.preventDefault();
    activate();
  };

  return (
    <div
      role={onActivate ? 'button' : undefined}
      tabIndex={onActivate ? 0 : undefined}
      onClick={onActivate ? handleCardClick : undefined}
      onKeyDown={onActivate ? handleCardKeyDown : undefined}
      className={`relative bg-gradient-to-br ${accent.from} ${accent.to} rounded-2xl border border-gray-200 ring-1 ${accent.ring} ring-opacity-50 overflow-hidden flex flex-col ${onActivate ? 'cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-gray-400' : ''} ${isFocusLayout ? 'shadow-md' : ''}`}
    >
      <div className={`${isFocusLayout ? 'p-8 sm:p-10' : 'p-6'} flex-1 flex flex-col`}>
        <div className="flex items-start justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="h-12 w-12 rounded-xl bg-white shadow-sm flex items-center justify-center">
              <Icon className="h-6 w-6 text-gray-700" />
            </div>
            <div>
              <h3 className={`font-bold text-gray-900 ${isFocusLayout ? 'text-xl sm:text-2xl' : 'text-lg'}`}>
                {t('products', titleKey)}
              </h3>
              <p className={`text-gray-500 max-w-[20rem] ${isFocusLayout ? 'text-sm mt-1' : 'text-xs max-w-[14rem]'}`}>
                {t('products', taglineKey)}
              </p>
            </div>
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

        <p className={`text-gray-700 mb-6 flex-1 ${isFocusLayout ? 'text-base leading-relaxed' : 'text-sm'}`}>
          {t('products', bodyKey)}
        </p>

        {unlocked ? (
          onActivate && !isFocusLayout ? (
            <div className="flex flex-col gap-2">
              <button
                type="button"
                onClick={() => activate()}
                className="inline-flex items-center justify-center gap-1.5 w-full px-4 py-2.5 rounded-xl bg-gray-900 text-white font-medium hover:bg-gray-800 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-400"
              >
                {t('products', 'enterWorkspace')}
                <ArrowRight className="h-4 w-4" />
              </button>
              <Link
                href={openHref}
                className="inline-flex items-center justify-center gap-1.5 w-full px-4 py-2.5 rounded-xl border border-gray-900/20 bg-white/70 text-gray-800 font-medium hover:bg-white transition-colors"
              >
                {t('products', 'openProduct')}
                <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
          ) : (
            <Link
              href={openHref}
              className="inline-flex items-center justify-center gap-1.5 w-full px-4 py-2.5 rounded-xl bg-gray-900 text-white font-medium hover:bg-gray-800 transition-colors"
            >
              {t('products', 'openProduct')}
              <ArrowRight className="h-4 w-4" />
            </Link>
          )
        ) : (
          <Link
            href={`/billing#${product}`}
            className="inline-flex items-center justify-center gap-1.5 w-full px-4 py-2.5 rounded-xl bg-blue-600 text-white font-medium hover:bg-blue-700 transition-colors"
          >
            {t('products', 'subscribeCta')}
            <ArrowRight className="h-4 w-4" />
          </Link>
        )}
      </div>

      {!unlocked && (
        <div className="absolute inset-0 bg-white/30 backdrop-blur-[1px] pointer-events-none" />
      )}
    </div>
  );
}
