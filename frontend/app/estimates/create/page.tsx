'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery, useMutation } from '@tanstack/react-query';
import { drawingsApi } from '@/lib/api/drawings';
import { estimatesApi } from '@/lib/api/estimates';
import { Loader2, ArrowLeft } from 'lucide-react';

export default function CreateEstimatePage() {
  const router = useRouter();
  const [selectedDrawingId, setSelectedDrawingId] = useState<string>('');
  const [structureType, setStructureType] = useState<'改修工事' | 'S造' | 'RC造'>('RC造');
  const [rentalStartDate, setRentalStartDate] = useState('');
  const [rentalEndDate, setRentalEndDate] = useState('');
  const [rentalType, setRentalType] = useState<'weekly' | 'monthly' | 'custom'>('monthly');
  const [projectId] = useState('default-project'); // In production, get from context

  const { data: drawings, isLoading } = useQuery({
    queryKey: ['drawings', projectId],
    queryFn: () => drawingsApi.list(projectId),
  });

  const createEstimateMutation = useMutation({
    mutationFn: estimatesApi.create,
    onSuccess: (data) => {
      router.push(`/estimates/${data.id}`);
    },
    onError: (error: any) => {
      alert(error.response?.data?.message || '見積の作成に失敗しました。');
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedDrawingId || !rentalStartDate || !rentalEndDate) {
      alert('すべての必須項目を入力してください。');
      return;
    }

    createEstimateMutation.mutate({
      drawingId: selectedDrawingId,
      projectId,
      structureType,
      rentalStartDate,
      rentalEndDate,
      rentalType,
    });
  };

  const completedDrawings = drawings?.filter(
    (d) => d.uploadStatus === 'completed'
  ) || [];

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <button
          onClick={() => router.back()}
          className="mb-6 flex items-center space-x-2 text-gray-600 hover:text-gray-900"
        >
          <ArrowLeft className="h-4 w-4" />
          <span>戻る</span>
        </button>

        <div className="bg-white rounded-lg shadow-sm border p-6">
          <h1 className="text-2xl font-bold text-gray-900 mb-6">
            見積作成
          </h1>

          <form onSubmit={handleSubmit} className="space-y-6">
            {/* Drawing Selection */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                図面選択 <span className="text-red-500">*</span>
              </label>
              {isLoading ? (
                <div className="flex justify-center py-4">
                  <Loader2 className="h-6 w-6 animate-spin text-blue-500" />
                </div>
              ) : completedDrawings.length === 0 ? (
                <p className="text-gray-500 py-4">
                  処理済みの図面がありません。先に図面をアップロードしてください。
                </p>
              ) : (
                <select
                  value={selectedDrawingId}
                  onChange={(e) => setSelectedDrawingId(e.target.value)}
                  required
                  className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                >
                  <option value="">図面を選択してください</option>
                  {completedDrawings.map((drawing) => (
                    <option key={drawing.id} value={drawing.id}>
                      {drawing.filename} ({drawing.fileFormat.toUpperCase()})
                      {drawing.detectedStructureType &&
                        ` - 検出: ${drawing.detectedStructureType}`}
                    </option>
                  ))}
                </select>
              )}
            </div>

            {/* Structure Type */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                構造種別 <span className="text-red-500">*</span>
              </label>
              <select
                value={structureType}
                onChange={(e) =>
                  setStructureType(
                    e.target.value as '改修工事' | 'S造' | 'RC造'
                  )
                }
                required
                className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
              >
                <option value="RC造">RC造</option>
                <option value="S造">S造</option>
                <option value="改修工事">改修工事</option>
              </select>
            </div>

            {/* Rental Period */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                リース期間タイプ <span className="text-red-500">*</span>
              </label>
              <select
                value={rentalType}
                onChange={(e) =>
                  setRentalType(
                    e.target.value as 'weekly' | 'monthly' | 'custom'
                  )
                }
                required
                className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
              >
                <option value="monthly">月単位</option>
                <option value="weekly">週単位</option>
                <option value="custom">カスタム</option>
              </select>
            </div>

            {/* Rental Dates */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  開始日 <span className="text-red-500">*</span>
                </label>
                <input
                  type="date"
                  value={rentalStartDate}
                  onChange={(e) => setRentalStartDate(e.target.value)}
                  required
                  className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  終了日 <span className="text-red-500">*</span>
                </label>
                <input
                  type="date"
                  value={rentalEndDate}
                  onChange={(e) => setRentalEndDate(e.target.value)}
                  required
                  min={rentalStartDate}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                />
              </div>
            </div>

            {/* Submit Button */}
            <div className="flex justify-end space-x-4 pt-4">
              <button
                type="button"
                onClick={() => router.back()}
                className="px-4 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50"
              >
                キャンセル
              </button>
              <button
                type="submit"
                disabled={createEstimateMutation.isPending || !selectedDrawingId}
                className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {createEstimateMutation.isPending ? '作成中...' : '見積を作成'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
