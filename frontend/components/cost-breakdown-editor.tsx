'use client';

import { useState } from 'react';
import { CostLineItem } from '@/lib/api/estimates';
import { formatCurrency } from '@/lib/formatters';
import { Lock, Unlock, Save, X } from 'lucide-react';
import { costsApi } from '@/lib/api/costs';

interface CostBreakdownEditorProps {
  estimateId: string;
  lineItems: CostLineItem[];
  onUpdate?: () => void;
}

export function CostBreakdownEditor({
  estimateId,
  lineItems,
  onUpdate,
}: CostBreakdownEditorProps) {
  const [editingItem, setEditingItem] = useState<string | null>(null);
  const [editValue, setEditValue] = useState<number>(0);
  const [editReason, setEditReason] = useState<string>('');
  const [saving, setSaving] = useState(false);

  const startEdit = (item: CostLineItem) => {
    setEditingItem(item.id);
    setEditValue(
      item.userEditedValue ?? item.computedValue
    );
    setEditReason('');
  };

  const cancelEdit = () => {
    setEditingItem(null);
    setEditValue(0);
    setEditReason('');
  };

  const saveEdit = async (itemId: string) => {
    setSaving(true);
    try {
      await costsApi.updateLineItem(itemId, {
        userEditedValue: editValue,
        isLocked: true,
        editReason: editReason || undefined,
      });
      setEditingItem(null);
      onUpdate?.();
    } catch (error) {
      console.error('Failed to update cost item:', error);
      alert('更新に失敗しました。');
    } finally {
      setSaving(false);
    }
  };

  const toggleLock = async (item: CostLineItem) => {
    try {
      await costsApi.updateLineItem(item.id, {
        isLocked: !item.isLocked,
      });
      onUpdate?.();
    } catch (error) {
      console.error('Failed to toggle lock:', error);
    }
  };

  return (
    <div className="bg-white rounded-lg shadow-sm border p-6">
      <h3 className="text-lg font-semibold mb-4">費用内訳編集</h3>
      <div className="space-y-3">
        {lineItems.map((item) => (
          <div
            key={item.id}
            className="border rounded-lg p-4 hover:bg-gray-50 transition-colors"
          >
            <div className="flex justify-between items-start mb-2">
              <div className="flex-1">
                <div className="flex items-center space-x-2 mb-1">
                  <h4 className="font-medium text-gray-900">{item.name}</h4>
                  <button
                    onClick={() => toggleLock(item)}
                    className="text-gray-400 hover:text-gray-600"
                    title={item.isLocked ? 'ロック解除' : 'ロック'}
                  >
                    {item.isLocked ? (
                      <Lock className="h-4 w-4" />
                    ) : (
                      <Unlock className="h-4 w-4" />
                    )}
                  </button>
                </div>
                <p className="text-xs text-gray-500 mb-2">
                  式: {item.formulaExpression}
                </p>
              </div>
              <div className="text-right">
                {editingItem === item.id ? (
                  <div className="flex items-center space-x-2">
                    <input
                      type="number"
                      value={editValue}
                      onChange={(e) => setEditValue(Number(e.target.value))}
                      className="w-32 px-2 py-1 border rounded text-right"
                    />
                    <button
                      onClick={() => saveEdit(item.id)}
                      disabled={saving}
                      className="p-1 text-green-600 hover:text-green-700"
                    >
                      <Save className="h-4 w-4" />
                    </button>
                    <button
                      onClick={cancelEdit}
                      className="p-1 text-gray-400 hover:text-gray-600"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center space-x-2">
                    <span
                      className={`font-medium ${
                        item.isLocked ? 'text-blue-600' : 'text-gray-900'
                      }`}
                    >
                      {formatCurrency(
                        item.isLocked ? (item.userEditedValue ?? item.computedValue) : item.computedValue
                      )}
                    </span>
                    {!item.isLocked && (
                      <button
                        onClick={() => startEdit(item)}
                        className="text-blue-600 hover:text-blue-700 text-sm"
                      >
                        編集
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>
            {editingItem === item.id && (
              <div className="mt-2">
                <input
                  type="text"
                  placeholder="編集理由（任意）"
                  value={editReason}
                  onChange={(e) => setEditReason(e.target.value)}
                  className="w-full px-2 py-1 border rounded text-sm"
                />
              </div>
            )}
          </div>
        ))}
      </div>
      <div className="mt-4 pt-4 border-t">
        <div className="flex justify-between items-center">
          <span className="font-semibold">合計</span>
          <span className="text-lg font-bold text-blue-600">
            {formatCurrency(
              lineItems.reduce(
                (sum, item) =>
                  sum +
                  (item.isLocked ? (item.userEditedValue ?? item.computedValue) : item.computedValue),
                0
              )
            )}
          </span>
        </div>
      </div>
    </div>
  );
}
