'use client';

import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { scaffoldConfigsApi, CalculatedQuantity, ScaffoldConfiguration } from '@/lib/api/scaffold-configs';
import { useI18n } from '@/lib/i18n';
import {
  Loader2,
  ArrowLeft,
  ArrowRight,
  Save,
  CheckCircle,
  Edit3,
  X,
  AlertCircle,
} from 'lucide-react';

function formatNumber(n: number): string {
  return n.toLocaleString();
}

export default function QuantitiesPage() {
  const params = useParams();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { t } = useI18n();
  const configId = params.configId as string;

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState<number>(0);
  const [editReason, setEditReason] = useState('');

  const { data: config, isLoading: configLoading } = useQuery({
    queryKey: ['scaffold-config', configId],
    queryFn: () => scaffoldConfigsApi.get(configId),
  });

  const { data: quantities, isLoading: quantitiesLoading } = useQuery({
    queryKey: ['quantities', configId],
    queryFn: () => scaffoldConfigsApi.getQuantities(configId),
    enabled: !!configId,
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, qty, reason }: { id: string; qty: number; reason?: string }) =>
      scaffoldConfigsApi.updateQuantity(id, qty, reason),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['quantities', configId] });
      setEditingId(null);
      setEditReason('');
    },
  });

  const reviewMutation = useMutation({
    mutationFn: () => scaffoldConfigsApi.markReviewed(configId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['scaffold-config', configId] });
      router.push(`/scaffold/${configId}`);
    },
  });

  const startEdit = (q: CalculatedQuantity) => {
    setEditingId(q.id);
    setEditValue(q.adjustedQuantity ?? q.calculatedQuantity);
    setEditReason(q.adjustmentReason || '');
  };

  const saveEdit = () => {
    if (!editingId) return;
    updateMutation.mutate({ id: editingId, qty: editValue, reason: editReason || undefined });
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditReason('');
  };

  if (configLoading || quantitiesLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
      </div>
    );
  }

  if (!config || !quantities) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-gray-500">{t('quantities', 'notFound')}</p>
      </div>
    );
  }

  const hasAdjustments = quantities.some((q) => q.adjustedQuantity !== null);

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center space-x-4">
            <button
              onClick={() => router.back()}
              className="flex items-center space-x-1 text-gray-600 hover:text-gray-900"
            >
              <ArrowLeft className="h-4 w-4" />
              <span>{t('quantities', 'back')}</span>
            </button>
            <div>
              <h1 className="text-2xl font-bold text-gray-900">{t('quantities', 'title')}</h1>
              <p className="text-sm text-gray-500">
                くさび式足場 • {t('quantities', 'buildingHeight')}: {config.buildingHeightMm?.toLocaleString()}mm
                • {t('quantities', 'scaffoldWidth')}: {config.scaffoldWidthMm}mm
              </p>
            </div>
          </div>
        </div>

        {/* Summary Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          <div className="bg-white rounded-lg border p-4">
            <p className="text-xs text-gray-500 uppercase">{t('quantities', 'buildingHeight')}</p>
            <p className="text-xl font-bold">{config.buildingHeightMm?.toLocaleString()} mm</p>
          </div>
          <div className="bg-white rounded-lg border p-4">
            <p className="text-xs text-gray-500 uppercase">{t('quantities', 'scaffoldWidth')}</p>
            <p className="text-xl font-bold">{config.scaffoldWidthMm} mm</p>
          </div>
          <div className="bg-white rounded-lg border p-4">
            <p className="text-xs text-gray-500 uppercase">{t('quantities', 'postSize')}</p>
            <p className="text-xl font-bold">{config.preferredMainTatejiMm} mm</p>
          </div>
          <div className="bg-white rounded-lg border p-4">
            <p className="text-xs text-gray-500 uppercase">{t('quantities', 'wallCount')}</p>
            <p className="text-xl font-bold">{config.walls?.filter((w: any) => w.enabled).length || 0}{t('quantities', 'wallsUnit')}</p>
          </div>
        </div>

        {/* Quantity Table */}
        <div className="bg-white rounded-lg shadow-sm border overflow-hidden mb-6">
          <div className="px-6 py-4 border-b bg-gray-50 flex items-center justify-between">
            <h2 className="text-lg font-semibold">{t('quantities', 'listTitle')}</h2>
            <p className="text-sm text-gray-500">
              {quantities.length} {t('quantities', 'componentsCount')} • {t('quantities', 'clickToAdjust')}
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-bold text-gray-600 uppercase w-8">{t('quantities', 'colNo')}</th>
                  <th className="px-4 py-3 text-left text-xs font-bold text-gray-600 uppercase">{t('quantities', 'colComponent')}</th>
                  <th className="px-4 py-3 text-left text-xs font-bold text-gray-600 uppercase">{t('quantities', 'colSpec')}</th>
                  <th className="px-4 py-3 text-center text-xs font-bold text-gray-600 uppercase">{t('quantities', 'colUnit')}</th>
                  <th className="px-4 py-3 text-right text-xs font-bold text-gray-600 uppercase">{t('quantities', 'colCalcQty')}</th>
                  <th className="px-4 py-3 text-right text-xs font-bold text-gray-600 uppercase">{t('quantities', 'colAdjQty')}</th>
                  <th className="px-4 py-3 text-left text-xs font-bold text-gray-600 uppercase">{t('quantities', 'colReason')}</th>
                  <th className="px-4 py-3 text-center text-xs font-bold text-gray-600 uppercase w-20">{t('quantities', 'colAction')}</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-100">
                {quantities.map((q, idx) => {
                  const isEditing = editingId === q.id;
                  const isAdjusted = q.adjustedQuantity !== null;

                  return (
                    <tr
                      key={q.id}
                      className={`hover:bg-blue-50 transition-colors ${isAdjusted ? 'bg-yellow-50' : ''}`}
                    >
                      <td className="px-4 py-3 text-sm text-gray-500">{idx + 1}</td>
                      <td className="px-4 py-3 text-sm font-medium text-gray-900">{q.componentName}</td>
                      <td className="px-4 py-3 text-sm text-gray-600">{q.sizeSpec}</td>
                      <td className="px-4 py-3 text-sm text-center text-gray-600">{q.unit}</td>
                      <td className="px-4 py-3 text-sm text-right font-mono text-gray-700">
                        {formatNumber(q.calculatedQuantity)}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {isEditing ? (
                          <input
                            type="number"
                            value={editValue}
                            onChange={(e) => setEditValue(Number(e.target.value))}
                            min={0}
                            className="w-24 px-2 py-1 border rounded text-right text-sm font-mono focus:ring-blue-500 focus:border-blue-500"
                            autoFocus
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') saveEdit();
                              if (e.key === 'Escape') cancelEdit();
                            }}
                          />
                        ) : (
                          <span
                            className={`text-sm font-mono cursor-pointer hover:text-blue-600 ${
                              isAdjusted ? 'text-orange-600 font-bold' : 'text-gray-400'
                            }`}
                            onClick={() => startEdit(q)}
                          >
                            {isAdjusted ? formatNumber(q.adjustedQuantity!) : '–'}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {isEditing ? (
                          <input
                            type="text"
                            value={editReason}
                            onChange={(e) => setEditReason(e.target.value)}
                            placeholder={t('quantities', 'reasonPlaceholder')}
                            className="w-full px-2 py-1 border rounded text-sm focus:ring-blue-500 focus:border-blue-500"
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') saveEdit();
                              if (e.key === 'Escape') cancelEdit();
                            }}
                          />
                        ) : (
                          <span className="text-xs text-gray-500 italic">{q.adjustmentReason || ''}</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-center">
                        {isEditing ? (
                          <div className="flex items-center justify-center space-x-1">
                            <button onClick={saveEdit} disabled={updateMutation.isPending} className="p-1 text-green-600 hover:text-green-700">
                              <Save className="h-4 w-4" />
                            </button>
                            <button onClick={cancelEdit} className="p-1 text-gray-400 hover:text-gray-600">
                              <X className="h-4 w-4" />
                            </button>
                          </div>
                        ) : (
                          <button onClick={() => startEdit(q)} className="p-1 text-blue-500 hover:text-blue-700">
                            <Edit3 className="h-4 w-4" />
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between">
          <div className="text-sm text-gray-500">
            {hasAdjustments && (
              <div className="flex items-center space-x-1 text-orange-600">
                <AlertCircle className="h-4 w-4" />
                <span>{t('quantities', 'adjustmentNote')}</span>
              </div>
            )}
          </div>
          <div className="flex items-center space-x-3">
            <button
              onClick={() => router.back()}
              className="px-4 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50"
            >
              {t('quantities', 'back')}
            </button>
            <button
              onClick={() => reviewMutation.mutate()}
              disabled={reviewMutation.isPending}
              className="px-6 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 disabled:opacity-50 flex items-center space-x-2"
            >
              {reviewMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <CheckCircle className="h-4 w-4" />
              )}
              <span>{t('quantities', 'confirmReview')}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
