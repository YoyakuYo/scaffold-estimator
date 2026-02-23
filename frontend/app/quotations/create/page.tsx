'use client';

import { useState, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQuery, useMutation } from '@tanstack/react-query';
import { scaffoldConfigsApi } from '@/lib/api/scaffold-configs';
import { quotationsApi, CreateQuotationDto } from '@/lib/api/quotations';
import { formatNumber } from '@/lib/formatters';
import { Loader2, ArrowLeft, ArrowRight, FileText } from 'lucide-react';
import { useI18n } from '@/lib/i18n';

function CreateQuotationContent() {
  const router = useRouter();
  const { t } = useI18n();
  const searchParams = useSearchParams();
  const configId = searchParams.get('configId') || '';
  const projectId = searchParams.get('projectId') || 'default-project';

  const [rentalStartDate, setRentalStartDate] = useState('');
  const [rentalEndDate, setRentalEndDate] = useState('');
  const [rentalType, setRentalType] = useState('monthly');

  // Fetch the config to verify it's reviewed
  const { data: config, isLoading: configLoading } = useQuery({
    queryKey: ['scaffold-config', configId],
    queryFn: () => scaffoldConfigsApi.get(configId),
    enabled: !!configId,
  });

  // Fetch quantities for preview
  const { data: quantities } = useQuery({
    queryKey: ['quantities', configId],
    queryFn: () => scaffoldConfigsApi.getQuantities(configId),
    enabled: !!configId,
  });

  const createMutation = useMutation({
    mutationFn: (dto: CreateQuotationDto) => quotationsApi.create(dto),
    onSuccess: (data) => {
      router.push(`/quotations/${data.id}`);
    },
    onError: (error: any) => {
      console.error('Quotation creation error:', error);
      const errorMessage = 
        error.response?.data?.message || 
        error.response?.data?.error || 
        error.message || 
        'Failed to create quotation. Please check the console for details.';
      alert(`Error: ${errorMessage}\n\nStatus: ${error.response?.status || 'N/A'}\nCode: ${error.code || 'N/A'}`);
    },
  });

  const handleCreate = () => {
    if (!rentalStartDate || !rentalEndDate) {
      alert(t('quotationCreate', 'setDates'));
      return;
    }
    createMutation.mutate({
      configId,
      projectId,
      rentalStartDate,
      rentalEndDate,
      rentalType,
    });
  };

  if (!configId) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <p className="text-gray-500 mb-4">{t('quotationCreate', 'noConfig')}</p>
          <button
            onClick={() => router.push('/dashboard')}
            className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
          >
            {t('quotationCreate', 'goToDashboard')}
          </button>
        </div>
      </div>
    );
  }

  if (configLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
      </div>
    );
  }

  if (config && config.status !== 'reviewed') {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center max-w-md">
          <p className="text-red-600 font-medium mb-2">{t('quotationCreate', 'cannotCreate')}</p>
          <p className="text-gray-500 mb-4">
            {t('quotationCreate', 'reviewRequired')}{' '}
            {t('quotationCreate', 'currentStatus')}: <strong>{config.status}</strong>
          </p>
          <button
            onClick={() => router.push(`/quantities/${configId}`)}
            className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
          >
            {t('quotationCreate', 'goToReview')}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center space-x-4">
            <button
              onClick={() => router.back()}
              className="flex items-center space-x-1 text-gray-600 hover:text-gray-900"
            >
              <ArrowLeft className="h-4 w-4" />
              <span>{t('quotationCreate', 'back')}</span>
            </button>
            <h1 className="text-2xl font-bold text-gray-900">{t('quotationCreate', 'title')}</h1>
          </div>
          {/* Workflow indicator */}
          <div className="flex items-center space-x-2 text-sm">
            <span className="px-3 py-1 bg-green-100 text-green-800 rounded-full">{t('quotationCreate', 'stepAnalysis')}</span>
            <ArrowRight className="h-4 w-4 text-gray-400" />
            <span className="px-3 py-1 bg-green-100 text-green-800 rounded-full">{t('quotationCreate', 'stepQuantities')}</span>
            <ArrowRight className="h-4 w-4 text-gray-400" />
            <span className="px-3 py-1 bg-blue-100 text-blue-800 rounded-full font-medium">
              {t('quotationCreate', 'stepQuotation')}
            </span>
          </div>
        </div>

        {/* Configuration Summary */}
        {config && (
          <div className="bg-white rounded-lg shadow-sm border p-6 mb-6">
            <h2 className="text-lg font-semibold mb-3">{t('quotationCreate', 'configSummary')}</h2>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
              <div>
                <span className="text-gray-500">{t('quotationCreate', 'scaffoldType')}:</span>
                <span className="ml-2 font-medium">{t('quotationCreate', 'kusabi')}</span>
              </div>
              <div>
                <span className="text-gray-500">{t('quotationCreate', 'buildingHeight')}:</span>
                <span className="ml-2 font-medium">{config.buildingHeightMm?.toLocaleString()} mm</span>
              </div>
              <div>
                <span className="text-gray-500">{t('quotationCreate', 'scaffoldWidth')}:</span>
                <span className="ml-2 font-medium">{config.scaffoldWidthMm} mm</span>
              </div>
              <div>
                <span className="text-gray-500">{t('quotationCreate', 'wallCount')}:</span>
                <span className="ml-2 font-medium">{config.walls?.filter((w: any) => w.enabled).length || 0}{t('quotationCreate', 'wallsUnit')}</span>
              </div>
              <div>
                <span className="text-gray-500">{t('quotationCreate', 'componentCount')}:</span>
                <span className="ml-2 font-medium">{quantities?.length || 0} {t('quotationCreate', 'types')}</span>
              </div>
              <div>
                <span className="text-gray-500">{t('quotationCreate', 'status')}:</span>
                <span className="ml-2 px-2 py-0.5 bg-green-100 text-green-800 rounded text-xs font-medium">
                  {t('quotationCreate', 'confirmed')}
                </span>
              </div>
            </div>
          </div>
        )}

        {/* Quantity Preview */}
        {quantities && quantities.length > 0 && (
          <div className="bg-white rounded-lg shadow-sm border overflow-hidden mb-6">
            <div className="px-6 py-3 border-b bg-gray-50">
              <h2 className="text-md font-semibold">{t('quotationCreate', 'componentsToQuote')}</h2>
            </div>
            <div className="max-h-60 overflow-y-auto">
              <table className="min-w-full divide-y divide-gray-100 text-sm">
                <thead className="bg-gray-50 sticky top-0">
                  <tr>
                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">{t('quotationCreate', 'colComponent')}</th>
                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">{t('quotationCreate', 'colSpec')}</th>
                    <th className="px-4 py-2 text-right text-xs font-medium text-gray-500">{t('quotationCreate', 'colQty')}</th>
                    <th className="px-4 py-2 text-center text-xs font-medium text-gray-500">{t('quotationCreate', 'colUnit')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {quantities.map((q) => (
                    <tr key={q.id} className="hover:bg-gray-50">
                      <td className="px-4 py-2 font-medium">{q.componentName}</td>
                      <td className="px-4 py-2 text-gray-500">{q.sizeSpec}</td>
                      <td className="px-4 py-2 text-right font-mono">
                        {formatNumber(q.adjustedQuantity ?? q.calculatedQuantity)}
                      </td>
                      <td className="px-4 py-2 text-center text-gray-500">{q.unit}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Rental Period */}
        <div className="bg-white rounded-lg shadow-sm border p-6 mb-6">
          <h2 className="text-lg font-semibold mb-4">{t('quotationCreate', 'rentalPeriod')}</h2>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                {t('quotationCreate', 'rentalType')}
              </label>
              <select
                value={rentalType}
                onChange={(e) => setRentalType(e.target.value)}
                className="w-full px-3 py-2 border rounded-md focus:ring-blue-500 focus:border-blue-500"
              >
                <option value="monthly">{t('quotationCreate', 'monthly')}</option>
                <option value="weekly">{t('quotationCreate', 'weekly')}</option>
                <option value="custom">{t('quotationCreate', 'custom')}</option>
              </select>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  {t('quotationCreate', 'startDate')} <span className="text-red-500">*</span>
                </label>
                <input
                  type="date"
                  value={rentalStartDate}
                  onChange={(e) => setRentalStartDate(e.target.value)}
                  required
                  className="w-full px-3 py-2 border rounded-md focus:ring-blue-500 focus:border-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  {t('quotationCreate', 'endDate')} <span className="text-red-500">*</span>
                </label>
                <input
                  type="date"
                  value={rentalEndDate}
                  onChange={(e) => setRentalEndDate(e.target.value)}
                  min={rentalStartDate}
                  required
                  className="w-full px-3 py-2 border rounded-md focus:ring-blue-500 focus:border-blue-500"
                />
              </div>
            </div>
          </div>
        </div>

        {/* Submit */}
        <div className="flex items-center justify-end space-x-3">
          <button
            onClick={() => router.back()}
            className="px-4 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50"
          >
            {t('quotationCreate', 'cancel')}
          </button>
          <button
            onClick={handleCreate}
            disabled={createMutation.isPending || !rentalStartDate || !rentalEndDate}
            className="px-6 py-3 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 flex items-center space-x-2"
          >
            {createMutation.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <FileText className="h-4 w-4" />
            )}
            <span>{t('quotationCreate', 'generate')}</span>
          </button>
        </div>
      </div>
    </div>
  );
}

export default function CreateQuotationPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
      </div>
    }>
      <CreateQuotationContent />
    </Suspense>
  );
}
