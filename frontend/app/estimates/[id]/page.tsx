'use client';

import { useParams, useRouter } from 'next/navigation';
import { useQuery, useMutation } from '@tanstack/react-query';
import { estimatesApi } from '@/lib/api/estimates';
import { costsApi } from '@/lib/api/costs';
import { exportsApi } from '@/lib/api/exports';
import { EstimatePreview } from '@/components/estimate-preview';
import { CostBreakdownEditor } from '@/components/cost-breakdown-editor';
import { Loader2, ArrowLeft } from 'lucide-react';

export default function EstimateDetailPage() {
  const params = useParams();
  const router = useRouter();
  const estimateId = params.id as string;

  const { data: estimate, isLoading, refetch } = useQuery({
    queryKey: ['estimate', estimateId],
    queryFn: () => estimatesApi.get(estimateId),
  });

  const { data: costBreakdown, refetch: refetchCosts } = useQuery({
    queryKey: ['costBreakdown', estimateId],
    queryFn: () => costsApi.getBreakdown(estimateId),
    enabled: !!estimate,
  });

  const calculateCostsMutation = useMutation({
    mutationFn: () => costsApi.calculate(estimateId),
    onSuccess: () => {
      refetchCosts();
      refetch();
    },
  });

  const handleExport = async (format: 'pdf' | 'excel') => {
    try {
      const blob = await exportsApi.generate(estimateId, format);
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `estimate-${estimateId}.${format === 'pdf' ? 'pdf' : 'xlsx'}`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (error) {
      console.error('Export failed:', error);
      alert('エクスポートに失敗しました。');
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
      </div>
    );
  }

  if (!estimate) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-gray-500">見積が見つかりません</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <button
          onClick={() => router.back()}
          className="mb-6 flex items-center space-x-2 text-gray-600 hover:text-gray-900"
        >
          <ArrowLeft className="h-4 w-4" />
          <span>戻る</span>
        </button>

        <div className="space-y-6">
          <EstimatePreview
            estimate={{
              ...estimate,
              costBreakdown: costBreakdown || [],
            }}
            onExport={handleExport}
          />

          {costBreakdown && costBreakdown.length > 0 && (
            <CostBreakdownEditor
              estimateId={estimateId}
              lineItems={costBreakdown}
              onUpdate={() => {
                refetchCosts();
                refetch();
              }}
            />
          )}

          {(!costBreakdown || costBreakdown.length === 0) && (
            <div className="bg-white rounded-lg shadow-sm border p-6">
              <h3 className="text-lg font-semibold mb-4">費用計算</h3>
              <p className="text-gray-600 mb-4">
                費用内訳を計算するには、以下のボタンをクリックしてください。
              </p>
              <button
                onClick={() => calculateCostsMutation.mutate()}
                disabled={calculateCostsMutation.isPending}
                className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50"
              >
                {calculateCostsMutation.isPending
                  ? '計算中...'
                  : '費用を計算'}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
