'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { quotationsApi } from '@/lib/api/quotations';
import { formatDate, formatCurrency } from '@/lib/formatters';
import { FileText, Loader2, Eye } from 'lucide-react';
import { useI18n } from '@/lib/i18n';

const scaffoldTypeLabels: Record<string, string> = {
  frame: '枠組足場',
  single_pipe: '単管足場',
  next_gen: '次世代足場',
};

export default function QuotationsListPage() {
  const router = useRouter();
  const { t } = useI18n();
  const [projectId] = useState('default-project');

  const { data: quotations = [], isLoading } = useQuery({
    queryKey: ['quotations', projectId],
    queryFn: () => quotationsApi.list(projectId),
  });

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="flex justify-between items-center mb-8">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">{t('quotationsList', 'title')}</h1>
            <p className="text-gray-500 mt-1">{t('quotationsList', 'subtitle')}</p>
          </div>
        </div>

        {isLoading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
          </div>
        ) : quotations.length === 0 ? (
          <div className="bg-white rounded-lg shadow-sm border p-12 text-center">
            <FileText className="h-12 w-12 text-gray-400 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-gray-900 mb-2">{t('quotationsList', 'noQuotations')}</h3>
            <p className="text-gray-500 mb-6">{t('quotationsList', 'noQuotationsHint')}</p>
            <button
              onClick={() => router.push('/dashboard')}
              className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
            >
              {t('quotationsList', 'goToDashboard')}
            </button>
          </div>
        ) : (
          <div className="bg-white rounded-lg shadow-sm border overflow-hidden">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    {t('quotationsList', 'colId')}
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    {t('quotationsList', 'colStructure')}
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    {t('quotationsList', 'colRental')}
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    {t('quotationsList', 'colCreated')}
                  </th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                    {t('quotationsList', 'colTotal')}
                  </th>
                  <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">
                    {t('quotationsList', 'colStatus')}
                  </th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                    {t('quotationsList', 'colAction')}
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {quotations.map((q) => (
                  <tr key={q.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                      #{q.id.substring(0, 8).toUpperCase()}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {q.config?.structureType || '–'}
                      {q.config?.scaffoldType && (
                        <span className="text-gray-400 ml-1">
                          / {scaffoldTypeLabels[q.config.scaffoldType] || q.config.scaffoldType}
                        </span>
                      )}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {formatDate(q.rentalStartDate)} ~ {formatDate(q.rentalEndDate)}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {formatDate(q.createdAt)}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900 text-right font-mono">
                      {formatCurrency(Number(q.totalAmount))}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-center">
                      <span
                        className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${
                          q.status === 'finalized'
                            ? 'bg-green-100 text-green-800'
                            : 'bg-yellow-100 text-yellow-800'
                        }`}
                      >
                        {q.status === 'finalized' ? t('quotationsList', 'finalized') : t('quotationsList', 'draft')}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                      <button
                        onClick={() => router.push(`/quotations/${q.id}`)}
                        className="text-blue-600 hover:text-blue-900 inline-flex items-center space-x-1"
                      >
                        <Eye className="h-4 w-4" />
                        <span>{t('quotationsList', 'view')}</span>
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
