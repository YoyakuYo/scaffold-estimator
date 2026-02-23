'use client';

import { Estimate, BillOfMaterials } from '@/lib/api/estimates';
import { formatCurrency, formatDate } from '@/lib/formatters';
import { FileText, Download, Edit } from 'lucide-react';

interface EstimatePreviewProps {
  estimate: Estimate;
  onEdit?: () => void;
  onExport?: (format: 'pdf' | 'excel') => void;
}

export function EstimatePreview({
  estimate,
  onEdit,
  onExport,
}: EstimatePreviewProps) {
  const bom = estimate.billOfMaterials;
  const totalCost = estimate.totalEstimatedCost || 0;
  const tax = totalCost * 0.1; // 10% consumption tax
  const subtotal = totalCost - tax;

  return (
    <div className="bg-white rounded-lg shadow-sm border p-6">
      <div className="flex justify-between items-start mb-6">
        <div>
          <h2 className="text-2xl font-bold text-gray-900 mb-2">
            見積書 #{estimate.id.substring(0, 8).toUpperCase()}
          </h2>
          <p className="text-sm text-gray-500">
            作成日: {formatDate(estimate.createdAt)}
          </p>
        </div>
        <div className="flex space-x-2">
          {onEdit && (
            <button
              onClick={onEdit}
              className="px-4 py-2 border border-gray-300 rounded-md hover:bg-gray-50 flex items-center space-x-2"
            >
              <Edit className="h-4 w-4" />
              <span>編集</span>
            </button>
          )}
          {onExport && (
            <>
              <button
                onClick={() => onExport('pdf')}
                className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 flex items-center space-x-2"
              >
                <FileText className="h-4 w-4" />
                <span>PDF</span>
              </button>
              <button
                onClick={() => onExport('excel')}
                className="px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 flex items-center space-x-2"
              >
                <Download className="h-4 w-4" />
                <span>Excel</span>
              </button>
            </>
          )}
        </div>
      </div>

      {/* Project Info */}
      <div className="grid grid-cols-2 gap-4 mb-6 p-4 bg-gray-50 rounded-lg">
        <div>
          <p className="text-sm text-gray-500">構造種別</p>
          <p className="font-medium">{estimate.structureType}</p>
        </div>
        <div>
          <p className="text-sm text-gray-500">リース期間</p>
          <p className="font-medium">
            {formatDate(estimate.rentalStartDate)} ～{' '}
            {formatDate(estimate.rentalEndDate)}
          </p>
        </div>
        <div>
          <p className="text-sm text-gray-500">総面積</p>
          <p className="font-medium">{bom.totalArea.toFixed(2)} m²</p>
        </div>
        <div>
          <p className="text-sm text-gray-500">高さ</p>
          <p className="font-medium">{bom.totalHeight.toFixed(2)} m</p>
        </div>
      </div>

      {/* Bill of Materials */}
      <div className="mb-6">
        <h3 className="text-lg font-semibold mb-4">仮設材詳細</h3>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  部品名
                </th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                  数量
                </th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                  単位
                </th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                  単価
                </th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                  小計
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {bom.components.map((component) => (
                <tr key={component.componentId}>
                  <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-900">
                    {component.componentName}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-900 text-right">
                    {component.quantity}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500 text-right">
                    {component.unit}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-900 text-right">
                    {formatCurrency(component.unitPrice)}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap text-sm font-medium text-gray-900 text-right">
                    {formatCurrency(component.quantity * component.unitPrice)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Cost Summary */}
      {estimate.costBreakdown && estimate.costBreakdown.length > 0 && (
        <div className="mb-6">
          <h3 className="text-lg font-semibold mb-4">費用内訳</h3>
          <div className="space-y-2">
            {estimate.costBreakdown.map((item) => (
              <div
                key={item.id}
                className="flex justify-between items-center p-3 bg-gray-50 rounded"
              >
                <span className="text-sm text-gray-700">{item.name}</span>
                <span className="font-medium">
                  {formatCurrency(
                    item.isLocked ? (item.userEditedValue ?? item.computedValue) : item.computedValue
                  )}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Total */}
      <div className="border-t pt-4">
        <div className="flex justify-between items-center mb-2">
          <span className="text-gray-600">小計</span>
          <span className="font-medium">{formatCurrency(subtotal)}</span>
        </div>
        <div className="flex justify-between items-center mb-2">
          <span className="text-gray-600">消費税 (10%)</span>
          <span className="font-medium">{formatCurrency(tax)}</span>
        </div>
        <div className="flex justify-between items-center pt-2 border-t">
          <span className="text-lg font-bold">合計</span>
          <span className="text-lg font-bold text-blue-600">
            {formatCurrency(totalCost)}
          </span>
        </div>
      </div>
    </div>
  );
}
