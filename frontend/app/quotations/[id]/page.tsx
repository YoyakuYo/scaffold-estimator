'use client';

import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { quotationsApi } from '@/lib/api/quotations';
import { formatCurrency, formatDate, formatNumber } from '@/lib/formatters';
import { useI18n } from '@/lib/i18n';
import { displaySizeSpecForUi } from '@/lib/scaffold-display-size-spec';
import {
  Loader2,
  ArrowLeft,
  CheckCircle,
  Save,
  X,
  RefreshCw,
  Settings,
  FileSpreadsheet,
} from 'lucide-react';

export default function QuotationDetailPage() {
  const params = useParams();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { t } = useI18n();
  const quotationId = params.id as string;

  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [editPrice, setEditPrice] = useState<number>(0);
  const [editingCostItemId, setEditingCostItemId] = useState<string | null>(null);
  const [editCostAmount, setEditCostAmount] = useState<number>(0);
  const [excelExporting, setExcelExporting] = useState(false);

  const { data: quotation, isLoading } = useQuery({
    queryKey: ['quotation', quotationId],
    queryFn: () => quotationsApi.get(quotationId),
  });

  const updatePriceMutation = useMutation({
    mutationFn: ({ itemId, price }: { itemId: string; price: number }) =>
      quotationsApi.updateItemPrice(itemId, price),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['quotation', quotationId] });
      setEditingItemId(null);
    },
    onError: (error: any) => {
      alert(`Error: ${error.response?.data?.message || error.message}`);
    },
  });

  const updateCostAmountMutation = useMutation({
    mutationFn: ({ costItemId, amount }: { costItemId: string; amount: number | null }) =>
      quotationsApi.updateCostItemAmount(costItemId, amount),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['quotation', quotationId] });
      setEditingCostItemId(null);
    },
    onError: (error: any) => {
      alert(`Error: ${error.response?.data?.message || error.message}`);
    },
  });

  const repopulateMutation = useMutation({
    mutationFn: () => quotationsApi.repopulatePrices(quotationId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['quotation', quotationId] });
    },
    onError: (error: any) => {
      alert(`Error: ${error.response?.data?.message || error.message}`);
    },
  });

  const finalizeMutation = useMutation({
    mutationFn: () => quotationsApi.finalize(quotationId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['quotation', quotationId] });
    },
    onError: (error: any) => {
      alert(`Error: ${error.response?.data?.message || error.message}`);
    },
  });

  const handleExportExcel = async () => {
    setExcelExporting(true);
    try {
      const blob = await quotationsApi.exportExcel(quotationId);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `quotation_budget_${quotationId.slice(0, 8)}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      alert(t('quotationDetail', 'exportExcelFailed'));
    } finally {
      setExcelExporting(false);
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
      </div>
    );
  }

  if (!quotation) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-gray-500">{t('quotationDetail', 'notFound')}</p>
      </div>
    );
  }

  const startEditPrice = (itemId: string, currentPrice: number) => {
    setEditingItemId(itemId);
    setEditPrice(currentPrice);
  };

  const startEditCostAmount = (costItemId: string, effectiveAmount: number) => {
    setEditingCostItemId(costItemId);
    setEditCostAmount(Math.round(effectiveAmount));
  };

  const saveCostAmount = () => {
    if (!editingCostItemId) return;
    const n = Number(editCostAmount);
    if (Number.isNaN(n) || n < 0) return;
    updateCostAmountMutation.mutate({ costItemId: editingCostItemId, amount: Math.round(n) });
  };

  const clearCostManualOverride = (costItemId: string) => {
    updateCostAmountMutation.mutate({ costItemId, amount: null });
  };

  const savePrice = () => {
    if (!editingItemId) return;
    updatePriceMutation.mutate({ itemId: editingItemId, price: editPrice });
  };

  const isFinalized = quotation.status === 'finalized';
  const sortedItems = [...(quotation.items || [])].sort((a, b) => a.sortOrder - b.sortOrder);

  // Format size spec: convert "500×1800mm" to "500×1800" or "L=600mm" to "600"
  const formatSizeSpec = (sizeSpec: string): string => {
    if (!displaySizeSpecForUi(sizeSpec)) return '';
    // Handle plank format: "500×1800mm" or "240×1800mm" -> "500×1800" or "240×1800" (keep width, remove mm)
    const plankMatch = sizeSpec.match(/^(\d+)×(\d+)mm$/);
    if (plankMatch) {
      return `${plankMatch[1]}×${plankMatch[2]}`;
    }
    // Handle "L=600mm" -> "600"
    const lengthMatch = sizeSpec.match(/^L=(\d+)mm$/);
    if (lengthMatch) {
      return lengthMatch[1];
    }
    // Return as-is for other formats (e.g., "調整式", "1階段+2手摺+1ガード")
    return sizeSpec;
  };

  // Group items by component name
  const groupedItems = sortedItems.reduce((acc, item) => {
    const key = item.componentName;
    if (!acc[key]) {
      acc[key] = [];
    }
    acc[key].push(item);
    return acc;
  }, {} as Record<string, typeof sortedItems>);

  // Flatten grouped items for display (one row per size variant)
  const displayItems = Object.entries(groupedItems).flatMap(([componentName, items]) =>
    items.map((item, idx) => ({
      ...item,
      displayName: idx === 0 ? componentName : '', // Only show name on first row
      formattedSize: formatSizeSpec(item.sizeSpec),
    }))
  );

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center space-x-4">
            <button
              onClick={() => router.push('/quotations')}
              className="flex items-center space-x-1 text-gray-600 hover:text-gray-900"
            >
              <ArrowLeft className="h-4 w-4" />
              <span>{t('quotationDetail', 'backToList')}</span>
            </button>
            <div>
              <h1 className="text-2xl font-bold text-gray-900">
                {t('quotationDetail', 'quotationId')} #{quotation.id.substring(0, 8).toUpperCase()}
              </h1>
              <p className="text-sm text-gray-500">
                {t('quotationDetail', 'created')}: {formatDate(quotation.createdAt)}
                {quotation.config && (
                  <>
                    {' • '}
                    {quotation.config.structureType}
                  </>
                )}
                {quotation.config?.drawing?.filename && ` • ${quotation.config.drawing.filename}`}
              </p>
            </div>
          </div>
          <div className="flex items-center space-x-2">
            <button
              type="button"
              onClick={handleExportExcel}
              disabled={excelExporting}
              className="px-4 py-2 bg-white border border-gray-300 text-gray-800 rounded-md hover:bg-gray-50 disabled:opacity-50 flex items-center space-x-2"
            >
              {excelExporting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <FileSpreadsheet className="h-4 w-4 text-green-600" />
              )}
              <span>{t('quotationDetail', 'exportExcel')}</span>
            </button>
            {!isFinalized && (
              <>
                <button
                  onClick={() => repopulateMutation.mutate()}
                  disabled={repopulateMutation.isPending}
                  className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 flex items-center space-x-2"
                  title={t('quotationDetail', 'repopulateTooltip')}
                >
                  {repopulateMutation.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <RefreshCw className="h-4 w-4" />
                  )}
                  <span>{t('quotationDetail', 'repopulate')}</span>
                </button>
                <button
                  onClick={() => {
                    if (confirm(t('quotationDetail', 'finalizeConfirm'))) {
                      finalizeMutation.mutate();
                    }
                  }}
                  disabled={finalizeMutation.isPending}
                  className="px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 disabled:opacity-50 flex items-center space-x-2"
                >
                  {finalizeMutation.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <CheckCircle className="h-4 w-4" />
                  )}
                  <span>{t('quotationDetail', 'finalize')}</span>
                </button>
              </>
            )}
            <span
              className={`px-3 py-1 rounded-full text-sm font-medium ${
                isFinalized
                  ? 'bg-green-100 text-green-800'
                  : 'bg-yellow-100 text-yellow-800'
              }`}
            >
              {isFinalized ? t('quotationDetail', 'finalized') : t('quotationDetail', 'draft')}
            </span>
          </div>
        </div>

        {/* Rental Info */}
        <div className="bg-white rounded-lg shadow-sm border p-6 mb-6">
          <div className="grid grid-cols-3 gap-6">
            <div>
              <p className="text-sm text-gray-500">{t('quotationDetail', 'rentalPeriod')}</p>
              <p className="font-medium">
                {formatDate(quotation.rentalStartDate)} ~ {formatDate(quotation.rentalEndDate)}
              </p>
            </div>
            <div>
              <p className="text-sm text-gray-500">{t('quotationDetail', 'rentalType')}</p>
              <p className="font-medium capitalize">{quotation.rentalType}</p>
            </div>
            <div>
              <p className="text-sm text-gray-500">{t('quotationDetail', 'items')}</p>
              <p className="font-medium">{sortedItems.length} {t('quotationDetail', 'components')}</p>
            </div>
          </div>
        </div>

        {/* Quotation Items Table */}
        <div className="bg-white rounded-lg shadow-sm border overflow-hidden mb-6">
          <div className="px-6 py-4 border-b bg-gray-50">
            <h2 className="text-lg font-semibold">{t('quotationDetail', 'quotationItems')}</h2>
            {!isFinalized && (
              <p className="text-sm text-gray-500">{t('quotationDetail', 'clickToEdit')}</p>
            )}
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-bold text-gray-600 uppercase w-8">{t('quotationDetail', 'colNo')}</th>
                  <th className="px-4 py-3 text-left text-xs font-bold text-gray-600 uppercase">{t('quotationDetail', 'colComponent')}</th>
                  <th className="px-4 py-3 text-left text-xs font-bold text-gray-600 uppercase">{t('quotationDetail', 'colSpec')}</th>
                  <th className="px-4 py-3 text-center text-xs font-bold text-gray-600 uppercase">{t('quotationDetail', 'colUnit')}</th>
                  <th className="px-4 py-3 text-right text-xs font-bold text-gray-600 uppercase">{t('quotationDetail', 'colQty')}</th>
                  <th className="px-4 py-3 text-right text-xs font-bold text-gray-600 uppercase">{t('quotationDetail', 'colUnitPrice')}</th>
                  <th className="px-4 py-3 text-right text-xs font-bold text-gray-600 uppercase">{t('quotationDetail', 'colLineTotal')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {displayItems.map((item, idx) => (
                  <tr key={item.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 text-sm text-gray-500">{idx + 1}</td>
                    <td className="px-4 py-3 text-sm font-medium text-gray-900">
                      {item.displayName || <span className="text-gray-400">└</span>}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600 font-mono">{item.formattedSize}</td>
                    <td className="px-4 py-3 text-sm text-center text-gray-600">{item.unit}</td>
                    <td className="px-4 py-3 text-sm text-right font-mono">{formatNumber(item.quantity)}</td>
                    <td className="px-4 py-3 text-sm text-right">
                      {editingItemId === item.id ? (
                        <div className="flex items-center justify-end space-x-1">
                          <input
                            type="number"
                            value={editPrice}
                            onChange={(e) => setEditPrice(Number(e.target.value))}
                            min={0}
                            className="w-28 px-2 py-1 border rounded text-right text-sm font-mono"
                            autoFocus
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') savePrice();
                              if (e.key === 'Escape') setEditingItemId(null);
                            }}
                          />
                          <button
                            onClick={savePrice}
                            disabled={updatePriceMutation.isPending}
                            className="p-1 text-green-600 hover:text-green-700"
                          >
                            <Save className="h-3 w-3" />
                          </button>
                          <button onClick={() => setEditingItemId(null)} className="p-1 text-gray-400 hover:text-gray-600">
                            <X className="h-3 w-3" />
                          </button>
                        </div>
                      ) : (
                        <span
                          className={`font-mono cursor-pointer hover:text-blue-600 ${
                            !isFinalized ? 'underline decoration-dashed' : ''
                          } ${Number(item.unitPrice) === 0 ? 'text-red-400' : ''}`}
                          onClick={() => !isFinalized && startEditPrice(item.id, Number(item.unitPrice))}
                          title={!isFinalized ? t('quotationDetail', 'clickToEditPrice') : ''}
                        >
                          {formatCurrency(Number(item.unitPrice))}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-sm text-right font-mono font-medium">
                      {formatCurrency(Number(item.lineTotal))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Cost Items (Rental-Based) */}
        {quotation.costItems && quotation.costItems.length > 0 && (
          <div className="bg-white rounded-lg shadow-sm border overflow-hidden mb-6">
            <div className="px-6 py-4 border-b bg-gray-50">
              <h2 className="text-lg font-semibold">{t('quotationDetail', 'costItems')}</h2>
              <p className="text-sm text-gray-500">{t('quotationDetail', 'costItemsDesc')}</p>
              {!isFinalized && (
                <p className="text-sm text-gray-500 mt-0.5">{t('quotationDetail', 'costClickToEditAmount')}</p>
              )}
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-bold text-gray-600 uppercase w-8">#</th>
                    <th className="px-4 py-3 text-left text-xs font-bold text-gray-600 uppercase">{t('quotationDetail', 'costName')}</th>
                    <th className="px-4 py-3 text-left text-xs font-bold text-gray-600 uppercase">{t('quotationDetail', 'costFormula')}</th>
                    <th className="px-4 py-3 text-right text-xs font-bold text-gray-600 uppercase">{t('quotationDetail', 'costAmount')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {[...(quotation.costItems || [])].sort((a, b) => a.sortOrder - b.sortOrder).map((cost, idx) => {
                    const effectiveCost = Number(cost.userEditedValue ?? cost.calculatedValue);
                    const calcOnly = Number(cost.calculatedValue);
                    return (
                      <tr key={cost.id} className="hover:bg-gray-50">
                        <td className="px-4 py-3 text-sm text-gray-500">{idx + 1}</td>
                        <td className="px-4 py-3 text-sm font-medium text-gray-900">{cost.name}</td>
                        <td className="px-4 py-3 text-xs text-gray-500 font-mono">{cost.formulaExpression || '-'}</td>
                        <td className="px-4 py-3 text-sm text-right align-top">
                          {editingCostItemId === cost.id ? (
                            <div className="flex flex-col items-end gap-1">
                              <div className="flex items-center justify-end space-x-1">
                                <input
                                  type="number"
                                  value={editCostAmount}
                                  onChange={(e) => setEditCostAmount(Number(e.target.value))}
                                  min={0}
                                  step={1}
                                  className="w-32 px-2 py-1 border rounded text-right text-sm font-mono"
                                  autoFocus
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter') saveCostAmount();
                                    if (e.key === 'Escape') setEditingCostItemId(null);
                                  }}
                                />
                                <button
                                  type="button"
                                  onClick={saveCostAmount}
                                  disabled={updateCostAmountMutation.isPending}
                                  className="p-1 text-green-600 hover:text-green-700"
                                >
                                  <Save className="h-3 w-3" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setEditingCostItemId(null)}
                                  className="p-1 text-gray-400 hover:text-gray-600"
                                >
                                  <X className="h-3 w-3" />
                                </button>
                              </div>
                              <button
                                type="button"
                                onClick={() => clearCostManualOverride(cost.id)}
                                disabled={updateCostAmountMutation.isPending}
                                className="text-xs text-blue-600 hover:text-blue-800"
                              >
                                {t('quotationDetail', 'costUseFormula')}
                              </button>
                              <span className="text-xs text-gray-400">
                                {t('quotationDetail', 'costFormulaValue')}: {formatCurrency(calcOnly)}
                              </span>
                            </div>
                          ) : (
                            <div className="flex flex-col items-end gap-0.5">
                              <span
                                className={`font-mono font-medium ${!isFinalized ? 'cursor-pointer hover:text-blue-600 underline decoration-dashed' : ''}`}
                                onClick={() =>
                                  !isFinalized && startEditCostAmount(cost.id, effectiveCost)
                                }
                                title={!isFinalized ? t('quotationDetail', 'costClickToEditAmount') : undefined}
                              >
                                {formatCurrency(effectiveCost)}
                              </span>
                              {cost.userEditedValue != null && !isFinalized && (
                                <button
                                  type="button"
                                  onClick={() => clearCostManualOverride(cost.id)}
                                  disabled={updateCostAmountMutation.isPending}
                                  className="text-xs text-blue-600 hover:text-blue-800"
                                >
                                  {t('quotationDetail', 'costUseFormula')}
                                </button>
                              )}
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Totals */}
        <div className="bg-white rounded-lg shadow-sm border p-6">
          <div className="max-w-md ml-auto space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-gray-600">{t('quotationDetail', 'materialSubtotal')}</span>
              <span className="font-medium font-mono">{formatCurrency(Number(quotation.materialSubtotal || 0))}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-gray-600">{t('quotationDetail', 'costSubtotal')}</span>
              <span className="font-medium font-mono">{formatCurrency(Number(quotation.costSubtotal || 0))}</span>
            </div>
            <div className="flex justify-between text-sm pt-1 border-t">
              <span className="text-gray-600">{t('quotationDetail', 'subtotal')}</span>
              <span className="font-medium font-mono">{formatCurrency(Number(quotation.subtotal))}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-gray-600">{t('quotationDetail', 'tax')}</span>
              <span className="font-medium font-mono">{formatCurrency(Number(quotation.taxAmount))}</span>
            </div>
            <div className="flex justify-between text-lg font-bold pt-2 border-t">
              <span>{t('quotationDetail', 'total')}</span>
              <span className="text-blue-600 font-mono">{formatCurrency(Number(quotation.totalAmount))}</span>
            </div>
          </div>
        </div>

        {/* Help text for pricing */}
        {!isFinalized && displayItems.some((i) => Number(i.unitPrice) === 0) && (
          <div className="mt-4 p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
            <div className="flex items-start justify-between">
              <p className="text-sm text-yellow-800">
                <strong>{t('quotationDetail', 'note')}:</strong> {t('quotationDetail', 'priceNote')}
              </p>
              <div className="flex items-center space-x-3 ml-4 flex-shrink-0">
                <button
                  onClick={() => router.push(`/scaffold/${quotation.configId}/quote?step=1`)}
                  className="flex items-center space-x-1 text-sm text-blue-600 hover:text-blue-800 font-medium"
                >
                  <Settings className="h-3.5 w-3.5" />
                  <span>{t('quotationDetail', 'goToSettings')}</span>
                </button>
                <button
                  onClick={() => repopulateMutation.mutate()}
                  disabled={repopulateMutation.isPending}
                  className="flex items-center space-x-1 text-sm text-green-600 hover:text-green-800 font-medium disabled:opacity-50"
                >
                  {repopulateMutation.isPending ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <RefreshCw className="h-3.5 w-3.5" />
                  )}
                  <span>{t('quotationDetail', 'repopulate')}</span>
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
