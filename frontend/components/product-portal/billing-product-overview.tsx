'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Lock,
  CheckCircle2,
  Loader2,
  HardHat,
  Box,
  Calendar,
  ArrowRight,
  Landmark,
  X,
  AlertTriangle,
} from 'lucide-react';
import { accessApi, type ProductCode, type EffectiveAccess } from '@/lib/api/access';
import { authApi } from '@/lib/api/auth';
import { useI18n } from '@/lib/i18n';
import {
  subscriptionsApi,
  type BankWirePlanTier,
  type BankTransferInstructions,
} from '@/lib/api/subscriptions';

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

const TIER_OPTIONS: BankWirePlanTier[] = ['basic', 'medium', 'monthly', 'premium'];

interface Props {
  /** Optional pre-resolved access (avoids a second API call when caller already has it). */
  access?: EffectiveAccess | null;
}

/**
 * Phase 2 follow-up — billing page product overview with per-product
 * Subscribe action that creates a bank-wire intent for the right product
 * and shows the resulting wire reference + bank details inline.
 */
export function BillingProductOverview({ access: accessProp }: Props = {}) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const [openProduct, setOpenProduct] = useState<ProductCode | null>(null);
  const [tier, setTier] = useState<BankWirePlanTier>('basic');
  const [intent, setIntent] = useState<{
    wireReference: string;
    productCode: ProductCode;
    planTier: BankWirePlanTier;
    bankTransfer: BankTransferInstructions;
  } | null>(null);

  const enabled = accessProp == null && !!authApi.getToken();
  const { data: fetched, isLoading } = useQuery({
    queryKey: ['effective-access'],
    queryFn: accessApi.getEffectiveAccess,
    enabled,
    staleTime: 60_000,
  });
  const access = accessProp ?? fetched ?? null;

  const intentMutation = useMutation({
    mutationFn: (payload: { plan: BankWirePlanTier; productCode: ProductCode }) =>
      subscriptionsApi.createBankWireIntent(payload.plan, payload.productCode),
    onSuccess: (data) => {
      setIntent({
        wireReference: data.wireReference,
        productCode: data.productCode,
        planTier: data.planTier,
        bankTransfer: data.bankTransfer,
      });
      queryClient.invalidateQueries({ queryKey: ['my-subscription'] });
    },
  });

  const closeDialog = () => {
    setOpenProduct(null);
    setIntent(null);
    intentMutation.reset();
  };

  const productNeedsManageOnly = useMemo(() => {
    return (code: ProductCode) => {
      const slot = access?.[code];
      return !!slot?.hasAccess;
    };
  }, [access]);

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
          const isOpen = openProduct === code;
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
              {productNeedsManageOnly(code) ? (
                <span className="inline-flex items-center gap-1 text-xs text-gray-500">
                  <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />
                  {t('productSubscribe', 'manageBelow')}
                </span>
              ) : (
                <button
                  onClick={() => {
                    setOpenProduct(code);
                    setIntent(null);
                    intentMutation.reset();
                  }}
                  className="inline-flex items-center gap-1 text-sm font-medium text-blue-600 hover:text-blue-700"
                >
                  {t('products', 'subscribeCta')}
                  <ArrowRight className="h-3.5 w-3.5" />
                </button>
              )}

              {isOpen && (
                <ProductSubscribeDialog
                  product={code}
                  tier={tier}
                  setTier={setTier}
                  intent={intent}
                  isPending={intentMutation.isPending}
                  errorMessage={intentMutation.isError ? t('productSubscribe', 'intentFailed') : null}
                  onSubmit={() =>
                    intentMutation.mutate({
                      plan: tier,
                      productCode: code,
                    })
                  }
                  onClose={closeDialog}
                />
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function ProductSubscribeDialog(props: {
  product: ProductCode;
  tier: BankWirePlanTier;
  setTier: (t: BankWirePlanTier) => void;
  intent: {
    wireReference: string;
    productCode: ProductCode;
    planTier: BankWirePlanTier;
    bankTransfer: BankTransferInstructions;
  } | null;
  isPending: boolean;
  errorMessage: string | null;
  onSubmit: () => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const { product, tier, setTier, intent, isPending, errorMessage, onSubmit, onClose } = props;
  const productLabel = t('products', PRODUCT_TITLE_KEY[product]);
  return (
    <div className="mt-3 border-t border-gray-100 pt-3">
      <div className="flex items-center justify-between mb-2">
        <p className="text-sm font-semibold text-gray-900 flex items-center gap-1.5">
          <Landmark className="h-4 w-4 text-blue-600" />
          {t('productSubscribe', 'dialogTitle').replace('{product}', productLabel)}
        </p>
        <button onClick={onClose} className="text-gray-400 hover:text-gray-600" aria-label="close">
          <X className="h-4 w-4" />
        </button>
      </div>

      {!intent ? (
        <>
          <label className="block text-xs text-gray-600 mb-1">
            {t('productSubscribe', 'pickTier')}
          </label>
          <select
            value={tier}
            onChange={(e) => setTier(e.target.value as BankWirePlanTier)}
            className="w-full px-2 py-1.5 border border-gray-200 rounded-md text-sm mb-3"
          >
            {TIER_OPTIONS.map((opt) => (
              <option key={opt} value={opt}>
                {t('productSubscribe', `tier_${opt}` as never)}
              </option>
            ))}
          </select>
          <button
            onClick={onSubmit}
            disabled={isPending}
            className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 text-sm"
          >
            {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Landmark className="h-4 w-4" />}
            {t('productSubscribe', 'createIntent')}
          </button>
          {errorMessage && (
            <div className="mt-2 flex items-start gap-1.5 text-xs text-red-700 bg-red-50 border border-red-200 rounded p-2">
              <AlertTriangle className="h-3.5 w-3.5 mt-0.5" />
              <p>{errorMessage}</p>
            </div>
          )}
        </>
      ) : (
        <div className="space-y-2 text-xs">
          <div className="bg-amber-50 border border-amber-200 rounded p-2">
            <p className="font-medium text-amber-900">
              {t('productSubscribe', 'wireRefLabel')}: <span className="font-mono">{intent.wireReference}</span>
            </p>
            <p className="text-amber-800 mt-1">
              {t('productSubscribe', 'wireRefHint')}
            </p>
          </div>
          <dl className="grid grid-cols-3 gap-x-2 gap-y-1 text-gray-700">
            <dt className="text-gray-500">{t('productSubscribe', 'bankName')}</dt>
            <dd className="col-span-2">{intent.bankTransfer.bankName}</dd>
            <dt className="text-gray-500">{t('productSubscribe', 'branch')}</dt>
            <dd className="col-span-2">{intent.bankTransfer.branch}</dd>
            <dt className="text-gray-500">{t('productSubscribe', 'accountType')}</dt>
            <dd className="col-span-2">{intent.bankTransfer.accountType}</dd>
            <dt className="text-gray-500">{t('productSubscribe', 'accountNumber')}</dt>
            <dd className="col-span-2 font-mono">{intent.bankTransfer.accountNumber}</dd>
            <dt className="text-gray-500">{t('productSubscribe', 'accountHolder')}</dt>
            <dd className="col-span-2">{intent.bankTransfer.accountHolder}</dd>
          </dl>
          <p className="text-gray-500 italic mt-1">
            {t('productSubscribe', 'afterTransfer')}
          </p>
        </div>
      )}
    </div>
  );
}
