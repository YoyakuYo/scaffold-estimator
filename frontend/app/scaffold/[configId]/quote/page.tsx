'use client';

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { scaffoldConfigsApi, CalculatedQuantity } from '@/lib/api/scaffold-configs';
import { quotationsApi } from '@/lib/api/quotations';
import { formatCurrency, formatNumber } from '@/lib/formatters';
import { useI18n } from '@/lib/i18n';
import { displaySizeSpecForUi } from '@/lib/scaffold-display-size-spec';
import { ArrowLeft, CheckCircle, FileSpreadsheet, Loader2 } from 'lucide-react';

const RENTAL_COST_CODES = [
  'basic_material',
  'material_wear',
  'transportation',
  'disposal',
  'surface_prep',
  'repair_reserve',
] as const;

type RentalCostCode = (typeof RENTAL_COST_CODES)[number];

function isRentalRangeValid(start: string, end: string): boolean {
  const a = start.slice(0, 10);
  const b = end.slice(0, 10);
  if (!a || !b) return false;
  return b >= a;
}

function wizardStorageKey(configId: string) {
  return `quoteWizard:${configId}`;
}

type Step2Stored = {
  rentalStartDate: string;
  rentalEndDate: string;
  rentalType: string;
  taxRatePercent: number;
  costs: Record<string, number>;
};

function QuoteWizardInner() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const { t } = useI18n();
  const configId = params.configId as string;
  const projectId = searchParams.get('projectId') || 'default-project';
  const step = Math.min(3, Math.max(1, Number(searchParams.get('step')) || 1));

  const [unitPrices, setUnitPrices] = useState<Record<string, number>>({});
  const [rentalStartDate, setRentalStartDate] = useState('');
  const [rentalEndDate, setRentalEndDate] = useState('');
  const [rentalType, setRentalType] = useState('monthly');
  const [taxRatePercent, setTaxRatePercent] = useState(10);
  const [costs, setCosts] = useState<Record<string, number>>(() =>
    Object.fromEntries(RENTAL_COST_CODES.map((c) => [c, 0])) as Record<string, number>,
  );
  const [createdQuotationId, setCreatedQuotationId] = useState<string | null>(null);
  const [excelBusy, setExcelBusy] = useState(false);

  const { data: config, isLoading: configLoading } = useQuery({
    queryKey: ['scaffold-config', configId],
    queryFn: () => scaffoldConfigsApi.get(configId),
    enabled: !!configId,
  });

  const { data: quantities, isLoading: qtyLoading } = useQuery({
    queryKey: ['quantities', configId],
    queryFn: () => scaffoldConfigsApi.getQuantities(configId),
    enabled: !!configId,
  });

  useEffect(() => {
    if (!quantities?.length) return;
    setUnitPrices((prev) => {
      const next = { ...prev };
      for (const q of quantities) {
        if (next[q.id] === undefined) {
          next[q.id] = Math.round(Number(q.unitPrice) || 0);
        }
      }
      return next;
    });
  }, [quantities]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const raw = sessionStorage.getItem(wizardStorageKey(configId));
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw) as Step2Stored;
      if (parsed.rentalStartDate) setRentalStartDate(parsed.rentalStartDate);
      if (parsed.rentalEndDate) setRentalEndDate(parsed.rentalEndDate);
      if (parsed.rentalType) setRentalType(parsed.rentalType);
      if (parsed.taxRatePercent != null) setTaxRatePercent(parsed.taxRatePercent);
      if (parsed.costs) {
        setCosts((c) => ({ ...c, ...parsed.costs }));
      }
    } catch {
      /* ignore */
    }
  }, [configId]);

  const persistStep2 = useCallback(() => {
    const payload: Step2Stored = {
      rentalStartDate,
      rentalEndDate,
      rentalType,
      taxRatePercent,
      costs,
    };
    sessionStorage.setItem(wizardStorageKey(configId), JSON.stringify(payload));
  }, [configId, rentalStartDate, rentalEndDate, rentalType, taxRatePercent, costs]);

  const saveUnitPricesMutation = useMutation({
    mutationFn: () =>
      scaffoldConfigsApi.bulkSaveQuantityUnitPrices(
        configId,
        (quantities || []).map((q) => ({
          quantityId: q.id,
          unitPrice: Math.max(0, Math.round(Number(unitPrices[q.id]) || 0)),
        })),
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['quantities', configId] });
    },
  });

  const createAndFinalizeMutation = useMutation({
    mutationFn: async () => {
      const rentalCostAmounts: Record<string, number> = {};
      for (const code of RENTAL_COST_CODES) {
        rentalCostAmounts[code] = Math.max(0, Math.round(Number(costs[code]) || 0));
      }
      const created = await quotationsApi.create({
        configId,
        projectId,
        rentalStartDate,
        rentalEndDate,
        rentalType,
        rentalCostAmounts,
        taxRatePercent,
      });
      const finalized = await quotationsApi.finalize(created.id);
      return finalized;
    },
    onSuccess: (q) => {
      setCreatedQuotationId(q.id);
      queryClient.invalidateQueries({ queryKey: ['quotation', q.id] });
      queryClient.invalidateQueries({ queryKey: ['quotations'] });
    },
    onError: (error: any) => {
      const msg =
        error?.response?.data?.message ||
        error?.response?.data?.error ||
        error?.message ||
        'Request failed';
      alert(String(msg));
    },
  });

  const materialSubtotalPreview = useMemo(() => {
    if (!quantities?.length) return 0;
    let sum = 0;
    for (const q of quantities) {
      const qty = q.adjustedQuantity ?? q.calculatedQuantity;
      const price = Math.round(Number(unitPrices[q.id]) || 0);
      sum += qty * price;
    }
    return sum;
  }, [quantities, unitPrices]);

  const costSubtotalPreview = useMemo(() => {
    return RENTAL_COST_CODES.reduce((s, c) => s + Math.max(0, Math.round(Number(costs[c]) || 0)), 0);
  }, [costs]);

  const taxPreview = useMemo(() => {
    const sub = materialSubtotalPreview + costSubtotalPreview;
    const rate = Math.min(100, Math.max(0, Number(taxRatePercent) || 0));
    return Math.floor((sub * rate) / 100);
  }, [materialSubtotalPreview, costSubtotalPreview, taxRatePercent]);

  const totalPreview = materialSubtotalPreview + costSubtotalPreview + taxPreview;

  const setStep = (n: number) => {
    const sp = new URLSearchParams(searchParams.toString());
    sp.set('step', String(n));
    sp.set('projectId', projectId);
    router.push(`/scaffold/${configId}/quote?${sp.toString()}`);
  };

  const handleStep1Next = async () => {
    await saveUnitPricesMutation.mutateAsync();
    persistStep2();
    setStep(2);
  };

  const handleStep2Next = () => {
    if (!rentalStartDate || !rentalEndDate) {
      alert(t('quotationCreate', 'setDates'));
      return;
    }
    if (!isRentalRangeValid(rentalStartDate, rentalEndDate)) {
      alert(t('quoteWizard', 'rentalDatesInvalid'));
      return;
    }
    persistStep2();
    setStep(3);
  };

  const handleFinalize = () => {
    if (!rentalStartDate || !rentalEndDate) {
      alert(t('quotationCreate', 'setDates'));
      return;
    }
    if (!isRentalRangeValid(rentalStartDate, rentalEndDate)) {
      alert(t('quoteWizard', 'rentalDatesInvalid'));
      return;
    }
    if (!confirm(t('quotationDetail', 'finalizeConfirm'))) return;
    createAndFinalizeMutation.mutate();
  };

  const downloadExcel = async () => {
    if (!createdQuotationId) return;
    setExcelBusy(true);
    try {
      const blob = await quotationsApi.exportExcel(createdQuotationId);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `quotation_budget_${createdQuotationId.slice(0, 8)}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      alert(t('quotationDetail', 'exportExcelFailed'));
    } finally {
      setExcelBusy(false);
    }
  };

  if (configLoading || qtyLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
      </div>
    );
  }

  if (!config || !quantities?.length) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <p className="text-gray-500">{t('common', 'noData')}</p>
      </div>
    );
  }

  if (config.status !== 'reviewed') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
        <div className="text-center max-w-md">
          <p className="text-red-600 font-medium mb-2">{t('quoteWizard', 'notReviewed')}</p>
          <button
            type="button"
            onClick={() => router.push(`/quantities/${configId}`)}
            className="mt-4 px-4 py-2 bg-blue-600 text-white rounded-md"
          >
            {t('quotationCreate', 'goToReview')}
          </button>
        </div>
      </div>
    );
  }

  const hasZeroUnit = quantities.some(
    (q) => Math.round(Number(unitPrices[q.id]) || 0) === 0,
  );

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="flex items-center gap-4 mb-6">
          <button
            type="button"
            onClick={() => router.push(`/scaffold/${configId}`)}
            className="flex items-center gap-1 text-gray-600 hover:text-gray-900"
          >
            <ArrowLeft className="h-4 w-4" />
            <span>{t('common', 'back')}</span>
          </button>
          <h1 className="text-2xl font-bold text-gray-900">{t('quoteWizard', 'title')}</h1>
        </div>

        <div className="flex gap-2 mb-6 text-sm">
          {[1, 2, 3].map((n) => (
            <span
              key={n}
              className={`px-3 py-1 rounded-full ${step === n ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-600'}`}
            >
              {n}
            </span>
          ))}
        </div>

        {step === 1 && (
          <div className="bg-white rounded-lg border shadow-sm overflow-hidden">
            <div className="px-6 py-4 border-b bg-gray-50">
              <h2 className="text-lg font-semibold">{t('quoteWizard', 'step1Title')}</h2>
              <p className="text-sm text-gray-500 mt-1">{t('quoteWizard', 'step1Desc')}</p>
              {hasZeroUnit && (
                <p className="text-sm text-amber-700 mt-2">{t('quoteWizard', 'zeroPriceWarn')}</p>
              )}
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200 text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-2 text-left text-xs font-semibold text-gray-600">#</th>
                    <th className="px-4 py-2 text-left text-xs font-semibold text-gray-600">
                      {t('quoteWizard', 'colComponent')}
                    </th>
                    <th className="px-4 py-2 text-left text-xs font-semibold text-gray-600">
                      {t('quoteWizard', 'colSpec')}
                    </th>
                    <th className="px-4 py-2 text-right text-xs font-semibold text-gray-600">
                      {t('quoteWizard', 'colQty')}
                    </th>
                    <th className="px-4 py-2 text-center text-xs font-semibold text-gray-600">
                      {t('quoteWizard', 'colUnit')}
                    </th>
                    <th className="px-4 py-2 text-right text-xs font-semibold text-gray-600">
                      {t('quoteWizard', 'colUnitPrice')}
                    </th>
                    <th className="px-4 py-2 text-right text-xs font-semibold text-gray-600">
                      {t('quoteWizard', 'colLineTotal')}
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {quantities.map((q: CalculatedQuantity, idx: number) => {
                    const qty = q.adjustedQuantity ?? q.calculatedQuantity;
                    const up = Math.round(Number(unitPrices[q.id]) || 0);
                    return (
                      <tr key={q.id} className={up === 0 ? 'bg-amber-50/50' : ''}>
                        <td className="px-4 py-2 text-gray-500">{idx + 1}</td>
                        <td className="px-4 py-2 font-medium">{q.componentName}</td>
                        <td className="px-4 py-2 text-gray-600 font-mono text-xs">
                          {displaySizeSpecForUi(q.sizeSpec)}
                        </td>
                        <td className="px-4 py-2 text-right font-mono">{formatNumber(qty)}</td>
                        <td className="px-4 py-2 text-center text-gray-600">{q.unit}</td>
                        <td className="px-4 py-2 text-right">
                          <input
                            type="number"
                            min={0}
                            step={1}
                            className="w-28 px-2 py-1 border rounded text-right font-mono text-sm"
                            value={unitPrices[q.id] ?? 0}
                            onChange={(e) =>
                              setUnitPrices((prev) => ({
                                ...prev,
                                [q.id]: Number(e.target.value),
                              }))
                            }
                          />
                        </td>
                        <td className="px-4 py-2 text-right font-mono">{formatCurrency(qty * up)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="px-6 py-4 border-t flex justify-end">
              <button
                type="button"
                disabled={saveUnitPricesMutation.isPending}
                onClick={() => void handleStep1Next()}
                className="px-6 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2"
              >
                {saveUnitPricesMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : null}
                {saveUnitPricesMutation.isPending
                  ? t('quoteWizard', 'savingPrices')
                  : t('quoteWizard', 'proceed')}
              </button>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="bg-white rounded-lg border shadow-sm p-6 space-y-6">
            <div>
              <h2 className="text-lg font-semibold">{t('quoteWizard', 'step2Title')}</h2>
              <p className="text-sm text-gray-500 mt-1">{t('quoteWizard', 'step2Desc')}</p>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  {t('quotationCreate', 'rentalType')}
                </label>
                <select
                  value={rentalType}
                  onChange={(e) => setRentalType(e.target.value)}
                  className="w-full px-3 py-2 border rounded-md"
                >
                  <option value="monthly">{t('quotationCreate', 'monthly')}</option>
                  <option value="weekly">{t('quotationCreate', 'weekly')}</option>
                  <option value="custom">{t('quotationCreate', 'custom')}</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  {t('quoteWizard', 'taxRate')}
                </label>
                <input
                  type="number"
                  min={0}
                  max={100}
                  step={0.1}
                  value={taxRatePercent}
                  onChange={(e) => setTaxRatePercent(Number(e.target.value))}
                  className="w-full px-3 py-2 border rounded-md"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  {t('quotationCreate', 'startDate')}
                </label>
                <input
                  type="date"
                  value={rentalStartDate}
                  onChange={(e) => {
                    const v = e.target.value;
                    setRentalStartDate(v);
                    if (rentalEndDate && rentalEndDate.slice(0, 10) < v) {
                      setRentalEndDate(v);
                    }
                  }}
                  className="w-full px-3 py-2 border rounded-md"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  {t('quotationCreate', 'endDate')}
                </label>
                <input
                  type="date"
                  value={rentalEndDate}
                  min={rentalStartDate ? rentalStartDate.slice(0, 10) : undefined}
                  onChange={(e) => setRentalEndDate(e.target.value)}
                  className="w-full px-3 py-2 border rounded-md"
                />
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {RENTAL_COST_CODES.map((code) => (
                <div key={code}>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    {t('quoteWizard', code as RentalCostCode)}
                  </label>
                  <input
                    type="number"
                    min={0}
                    step={1}
                    value={costs[code] ?? 0}
                    onChange={(e) =>
                      setCosts((prev) => ({
                        ...prev,
                        [code]: Number(e.target.value),
                      }))
                    }
                    className="w-full px-3 py-2 border rounded-md font-mono"
                  />
                </div>
              ))}
            </div>
            <div className="flex justify-between pt-2">
              <button
                type="button"
                onClick={() => setStep(1)}
                className="px-4 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50"
              >
                {t('quoteWizard', 'back')}
              </button>
              <button
                type="button"
                onClick={handleStep2Next}
                className="px-6 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
              >
                {t('quoteWizard', 'proceed')}
              </button>
            </div>
          </div>
        )}

        {step === 3 && !createdQuotationId && (
          <div className="bg-white rounded-lg border shadow-sm p-6 space-y-6">
            <div>
              <h2 className="text-lg font-semibold">{t('quoteWizard', 'step3Title')}</h2>
              <p className="text-sm text-gray-500 mt-1">{t('quoteWizard', 'step3Desc')}</p>
            </div>
            <div className="overflow-x-auto border rounded-md">
              <table className="min-w-full text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-2 text-left text-xs font-semibold text-gray-600">
                      {t('quoteWizard', 'colComponent')}
                    </th>
                    <th className="px-4 py-2 text-right text-xs font-semibold text-gray-600">
                      {t('quoteWizard', 'colLineTotal')}
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {quantities.map((q: CalculatedQuantity) => {
                    const qty = q.adjustedQuantity ?? q.calculatedQuantity;
                    const up = Math.round(Number(unitPrices[q.id]) || 0);
                    const specUi = displaySizeSpecForUi(q.sizeSpec);
                    return (
                      <tr key={q.id}>
                        <td className="px-4 py-2">
                          {q.componentName}
                          {specUi ? (
                            <>
                              {' '}
                              <span className="text-gray-500 font-mono text-xs">{specUi}</span>
                            </>
                          ) : null}
                        </td>
                        <td className="px-4 py-2 text-right font-mono">{formatCurrency(qty * up)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="max-w-sm ml-auto space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-600">{t('quotationDetail', 'materialSubtotal')}</span>
                <span className="font-mono font-medium">{formatCurrency(materialSubtotalPreview)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600">{t('quotationDetail', 'costSubtotal')}</span>
                <span className="font-mono font-medium">{formatCurrency(costSubtotalPreview)}</span>
              </div>
              <div className="flex justify-between pt-1 border-t">
                <span className="text-gray-600">{t('quotationDetail', 'subtotal')}</span>
                <span className="font-mono font-medium">
                  {formatCurrency(materialSubtotalPreview + costSubtotalPreview)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600">
                  {t('quotationDetail', 'tax')} ({taxRatePercent}%)
                </span>
                <span className="font-mono font-medium">{formatCurrency(taxPreview)}</span>
              </div>
              <div className="flex justify-between text-lg font-bold pt-2 border-t">
                <span>{t('common', 'total')}</span>
                <span className="text-blue-600 font-mono">{formatCurrency(totalPreview)}</span>
              </div>
            </div>
            <div className="flex justify-between pt-4">
              <button
                type="button"
                onClick={() => setStep(2)}
                className="px-4 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50"
              >
                {t('quoteWizard', 'back')}
              </button>
              <button
                type="button"
                disabled={createAndFinalizeMutation.isPending}
                onClick={handleFinalize}
                className="px-6 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 disabled:opacity-50 flex items-center gap-2"
              >
                {createAndFinalizeMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <CheckCircle className="h-4 w-4" />
                )}
                {t('quoteWizard', 'finalize')}
              </button>
            </div>
          </div>
        )}

        {step === 3 && createdQuotationId && (
          <div className="bg-white rounded-lg border shadow-sm p-8 text-center space-y-4">
            <CheckCircle className="h-12 w-12 text-green-600 mx-auto" />
            <p className="text-lg font-semibold text-gray-900">{t('quotationDetail', 'finalized')}</p>
            <div className="flex flex-wrap justify-center gap-3">
              <button
                type="button"
                disabled={excelBusy}
                onClick={() => void downloadExcel()}
                className="px-4 py-2 bg-white border border-gray-300 rounded-md hover:bg-gray-50 flex items-center gap-2 disabled:opacity-50"
              >
                {excelBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileSpreadsheet className="h-4 w-4 text-green-600" />}
                {t('quoteWizard', 'exportExcel')}
              </button>
              <button
                type="button"
                onClick={() => router.push(`/quotations/${createdQuotationId}`)}
                className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
              >
                {t('quoteWizard', 'goToQuotations')}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default function QuoteWizardPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center bg-gray-50">
          <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
        </div>
      }
    >
      <QuoteWizardInner />
    </Suspense>
  );
}
