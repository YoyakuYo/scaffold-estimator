'use client';

import { useState, useEffect, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { scaffoldConfigsApi, ScaffoldMaterial } from '@/lib/api/scaffold-configs';
import { useI18n } from '@/lib/i18n';
import { Save, Loader2, Package, CheckCircle, AlertCircle, Download, Info, Upload, X } from 'lucide-react';
import { useDropzone } from 'react-dropzone';

const CATEGORY_ORDER = [
  'jack_base',
  'post',
  'brace',
  'handrail',
  'horizontal',
  'plank',
  'toe_board',
  'stairway',
];

const CATEGORY_LABELS: Record<string, { key: string }> = {
  jack_base: { key: 'catJackBase' },
  post: { key: 'catPost' },
  brace: { key: 'catBrace' },
  handrail: { key: 'catHandrail' },
  horizontal: { key: 'catHorizontal' },
  plank: { key: 'catPlank' },
  toe_board: { key: 'catToeBoard' },
  stairway: { key: 'catStairway' },
};

export default function SettingsPage() {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const [editedPrices, setEditedPrices] = useState<Record<string, number>>({});
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [priceMatches, setPriceMatches] = useState<Array<{
    materialId: string;
    materialCode: string;
    materialName: string;
    sizeSpec: string;
    oldPrice: number;
    newPrice: number;
    confidence: 'exact' | 'high' | 'medium' | 'low';
    matchReason: string;
  }> | null>(null);

  const { data: materials, isLoading, refetch } = useQuery({
    queryKey: ['scaffold-materials'],
    queryFn: () => scaffoldConfigsApi.listMaterials(),
  });

  const seedMutation = useMutation({
    mutationFn: () => scaffoldConfigsApi.seedMaterials(),
    onSuccess: (data) => {
      if (data.created > 0) {
        refetch();
        alert(t('priceMaster', 'seedSuccess'));
      } else {
        alert(t('priceMaster', 'seedExists'));
      }
    },
  });

  const bulkUpdateMutation = useMutation({
    mutationFn: (updates: Array<{ id: string; rentalPriceMonthly: number }>) =>
      scaffoldConfigsApi.bulkUpdatePrices(updates),
    onSuccess: () => {
      setSaveStatus('saved');
      setEditedPrices({});
      refetch();
      setTimeout(() => setSaveStatus('idle'), 2000);
    },
  });

  const singleUpdateMutation = useMutation({
    mutationFn: ({ id, price }: { id: string; price: number }) =>
      scaffoldConfigsApi.updateMaterialPrice(id, { rentalPriceMonthly: price }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['scaffold-materials'] });
    },
  });

  const uploadPriceTableMutation = useMutation({
    mutationFn: (file: File) => scaffoldConfigsApi.uploadPriceTable(file),
    onSuccess: (data) => {
      setPriceMatches(data.matches);
      alert(`Parsed ${data.totalRows} rows. Matched ${data.matched} materials. ${data.unmatched} unmatched.`);
    },
    onError: (error: any) => {
      alert(`Upload failed: ${error.response?.data?.message || error.message}`);
    },
  });

  const applyPriceTableMutation = useMutation({
    mutationFn: (matches: Array<{ materialId: string; newPrice: number }>) =>
      scaffoldConfigsApi.applyPriceTable(matches),
    onSuccess: (data) => {
      alert(data.message);
      setPriceMatches(null);
      setUploadedFile(null);
      refetch();
    },
    onError: (error: any) => {
      alert(`Failed to apply prices: ${error.response?.data?.message || error.message}`);
    },
  });

  const onDrop = useCallback((acceptedFiles: File[]) => {
    const file = acceptedFiles[0];
    if (!file) return;

    const ext = file.name.split('.').pop()?.toLowerCase();
    if (!['xlsx', 'xls', 'xlsm'].includes(ext || '')) {
      alert('Only Excel files (.xlsx, .xls, .xlsm) are supported');
      return;
    }

    setUploadedFile(file);
    uploadPriceTableMutation.mutate(file);
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'],
      'application/vnd.ms-excel': ['.xls', '.xlsm'],
    },
    maxFiles: 1,
    disabled: uploadPriceTableMutation.isPending,
  });

  const handlePriceChange = (materialId: string, value: number) => {
    setEditedPrices(prev => ({ ...prev, [materialId]: value }));
  };

  const handleSaveAll = () => {
    const updates = Object.entries(editedPrices).map(([id, price]) => ({
      id,
      rentalPriceMonthly: price,
    }));
    if (updates.length === 0) return;
    setSaveStatus('saving');
    bulkUpdateMutation.mutate(updates);
  };

  const handleSaveSingle = (materialId: string) => {
    const price = editedPrices[materialId];
    if (price === undefined) return;
    singleUpdateMutation.mutate({ id: materialId, price });
    setEditedPrices(prev => {
      const next = { ...prev };
      delete next[materialId];
      return next;
    });
  };

  // Group materials by category
  const groupedMaterials = (materials || []).reduce<Record<string, ScaffoldMaterial[]>>(
    (acc, m) => {
      const cat = m.category || 'other';
      if (!acc[cat]) acc[cat] = [];
      acc[cat].push(m);
      return acc;
    },
    {},
  );

  const sortedCategories = CATEGORY_ORDER.filter(cat => groupedMaterials[cat]?.length > 0);

  // Format size spec: convert "500×1800mm" to "500×1800" or "L=600mm" to "600"
  const formatSizeSpec = (sizeSpec: string): string => {
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

  // Group materials by name within each category for display
  const groupMaterialsByName = (materials: ScaffoldMaterial[]) => {
    const grouped = materials.reduce((acc, material) => {
      const key = material.nameJp;
      if (!acc[key]) {
        acc[key] = [];
      }
      acc[key].push(material);
      return acc;
    }, {} as Record<string, ScaffoldMaterial[]>);

    // Flatten with display info
    return Object.entries(grouped).flatMap(([name, items]) =>
      items.map((item, idx) => ({
        ...item,
        displayName: idx === 0 ? name : '', // Only show name on first row
        formattedSize: formatSizeSpec(item.sizeSpec),
      }))
    );
  };

  // Stats
  const totalMaterials = materials?.length || 0;
  const pricedMaterials = materials?.filter(m => Number(m.rentalPriceMonthly) > 0).length || 0;
  const unpricedMaterials = totalMaterials - pricedMaterials;

  const hasChanges = Object.keys(editedPrices).length > 0;

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-gray-900">{t('priceMaster', 'title')}</h1>
          <p className="text-gray-500 mt-1">{t('priceMaster', 'subtitle')}</p>
        </div>

        {/* How It Works Banner */}
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6">
          <div className="flex items-start space-x-3">
            <Info className="h-5 w-5 text-blue-600 mt-0.5 flex-shrink-0" />
            <div>
              <h3 className="font-medium text-blue-800">{t('priceMaster', 'howItWorks')}</h3>
              <p className="text-sm text-blue-700 mt-1">{t('priceMaster', 'howItWorksDesc')}</p>
            </div>
          </div>
        </div>

        {/* Import Price Table Section */}
        <div className="bg-white rounded-lg shadow-sm border p-6 mb-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Import Price Table from Excel</h2>
          <p className="text-sm text-gray-600 mb-4">
            Upload your existing Excel price table. The system will automatically match materials and update prices.
          </p>

          {!uploadedFile && !priceMatches && (
            <div
              {...getRootProps()}
              className={`border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors ${
                isDragActive
                  ? 'border-blue-500 bg-blue-50'
                  : 'border-gray-300 hover:border-blue-400 hover:bg-gray-50'
              }`}
            >
              <input {...getInputProps()} />
              <Upload className="h-12 w-12 text-gray-400 mx-auto mb-4" />
              <p className="text-gray-600 mb-2">
                {isDragActive ? 'Drop the file here' : 'Drag & drop an Excel file here, or click to select'}
              </p>
              <p className="text-xs text-gray-500">Supports .xlsx, .xls, .xlsm files (max 10MB)</p>
            </div>
          )}

          {uploadPriceTableMutation.isPending && (
            <div className="flex items-center justify-center p-8">
              <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
              <span className="ml-3 text-gray-600">Parsing price table...</span>
            </div>
          )}

          {uploadedFile && !uploadPriceTableMutation.isPending && (
            <div className="space-y-4">
              <div className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                <div className="flex items-center space-x-3">
                  <Package className="h-5 w-5 text-gray-400" />
                  <span className="text-sm font-medium text-gray-900">{uploadedFile.name}</span>
                </div>
                <button
                  onClick={() => {
                    setUploadedFile(null);
                    setPriceMatches(null);
                  }}
                  className="text-gray-400 hover:text-gray-600"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              {priceMatches && priceMatches.length > 0 && (
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <p className="text-sm text-gray-600">
                      Found <strong>{priceMatches.length}</strong> matched prices
                    </p>
                    <button
                      onClick={() => {
                        const matches = priceMatches.map((m) => ({
                          materialId: m.materialId,
                          newPrice: m.newPrice,
                        }));
                        applyPriceTableMutation.mutate(matches);
                      }}
                      disabled={applyPriceTableMutation.isPending}
                      className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 flex items-center space-x-2"
                    >
                      {applyPriceTableMutation.isPending ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <CheckCircle className="h-4 w-4" />
                      )}
                      <span>Apply {priceMatches.length} Prices</span>
                    </button>
                  </div>

                  <div className="max-h-96 overflow-y-auto border rounded-lg">
                    <table className="min-w-full divide-y divide-gray-200">
                      <thead className="bg-gray-50 sticky top-0">
                        <tr>
                          <th className="px-4 py-2 text-left text-xs font-medium text-gray-600">Material</th>
                          <th className="px-4 py-2 text-left text-xs font-medium text-gray-600">Size</th>
                          <th className="px-4 py-2 text-right text-xs font-medium text-gray-600">Old Price</th>
                          <th className="px-4 py-2 text-right text-xs font-medium text-gray-600">New Price</th>
                          <th className="px-4 py-2 text-center text-xs font-medium text-gray-600">Match</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100 bg-white">
                        {priceMatches.map((match, idx) => (
                          <tr key={idx} className="hover:bg-gray-50">
                            <td className="px-4 py-2 text-sm text-gray-900">{match.materialName}</td>
                            <td className="px-4 py-2 text-sm text-gray-600">{match.sizeSpec}</td>
                            <td className="px-4 py-2 text-sm text-right text-gray-500">¥{match.oldPrice.toLocaleString()}</td>
                            <td className="px-4 py-2 text-sm text-right font-medium text-green-600">¥{match.newPrice.toLocaleString()}</td>
                            <td className="px-4 py-2 text-center">
                              <span
                                className={`px-2 py-1 rounded text-xs ${
                                  match.confidence === 'exact'
                                    ? 'bg-green-100 text-green-800'
                                    : match.confidence === 'high'
                                    ? 'bg-blue-100 text-blue-800'
                                    : match.confidence === 'medium'
                                    ? 'bg-yellow-100 text-yellow-800'
                                    : 'bg-gray-100 text-gray-800'
                                }`}
                                title={match.matchReason}
                              >
                                {match.confidence}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {priceMatches && priceMatches.length === 0 && (
                <div className="p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
                  <p className="text-sm text-yellow-800">
                    No materials matched. Please check that your Excel file contains material names or codes.
                  </p>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Stats + Actions */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center space-x-6">
            <div className="flex items-center space-x-2">
              <Package className="h-5 w-5 text-gray-400" />
              <span className="text-sm text-gray-600">
                {t('priceMaster', 'totalMaterials')}: <strong>{totalMaterials}</strong>
              </span>
            </div>
            <div className="flex items-center space-x-2">
              <CheckCircle className="h-5 w-5 text-green-500" />
              <span className="text-sm text-gray-600">
                {t('priceMaster', 'pricedMaterials')}: <strong>{pricedMaterials}</strong>
              </span>
            </div>
            {unpricedMaterials > 0 && (
              <div className="flex items-center space-x-2">
                <AlertCircle className="h-5 w-5 text-amber-500" />
                <span className="text-sm text-amber-600">
                  {t('priceMaster', 'unpricedMaterials')}: <strong>{unpricedMaterials}</strong>
                </span>
              </div>
            )}
          </div>
          <div className="flex items-center space-x-3">
            {totalMaterials === 0 && (
              <button
                onClick={() => seedMutation.mutate()}
                disabled={seedMutation.isPending}
                className="flex items-center space-x-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
              >
                {seedMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Download className="h-4 w-4" />
                )}
                <span>{t('priceMaster', 'seedBtn')}</span>
              </button>
            )}
            {hasChanges && (
              <button
                onClick={handleSaveAll}
                disabled={bulkUpdateMutation.isPending}
                className="flex items-center space-x-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50"
              >
                {saveStatus === 'saving' ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : saveStatus === 'saved' ? (
                  <CheckCircle className="h-4 w-4" />
                ) : (
                  <Save className="h-4 w-4" />
                )}
                <span>
                  {saveStatus === 'saving'
                    ? t('priceMaster', 'saving')
                    : saveStatus === 'saved'
                    ? t('priceMaster', 'saved')
                    : `${t('priceMaster', 'saveAll')} (${Object.keys(editedPrices).length})`}
                </span>
              </button>
            )}
          </div>
        </div>

        {/* No materials */}
        {totalMaterials === 0 && (
          <div className="bg-white rounded-lg shadow-sm border p-12 text-center">
            <Package className="h-12 w-12 text-gray-300 mx-auto mb-4" />
            <p className="text-gray-500">{t('priceMaster', 'noMaterials')}</p>
          </div>
        )}

        {/* Materials Table by Category */}
        {sortedCategories.map(category => {
          const catMaterials = groupedMaterials[category];
          const labelKey = CATEGORY_LABELS[category]?.key || category;

          return (
            <div key={category} className="bg-white rounded-lg shadow-sm border overflow-hidden mb-6">
              <div className="px-6 py-3 border-b bg-gray-50">
                <h2 className="text-md font-semibold text-gray-800">
                  {t('priceMaster', labelKey as any)}
                </h2>
              </div>
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-bold text-gray-600 uppercase w-36">
                        {t('priceMaster', 'colCode')}
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-bold text-gray-600 uppercase">
                        {t('priceMaster', 'colName')}
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-bold text-gray-600 uppercase">
                        {t('priceMaster', 'colSpec')}
                      </th>
                      <th className="px-4 py-3 text-center text-xs font-bold text-gray-600 uppercase w-16">
                        {t('priceMaster', 'colUnit')}
                      </th>
                      <th className="px-4 py-3 text-right text-xs font-bold text-gray-600 uppercase w-44">
                        {t('priceMaster', 'colRentalPrice')}
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {groupMaterialsByName(catMaterials).map((material: any) => {
                      const currentPrice =
                        editedPrices[material.id] !== undefined
                          ? editedPrices[material.id]
                          : Number(material.rentalPriceMonthly);
                      const isEdited = editedPrices[material.id] !== undefined;

                      return (
                        <tr
                          key={material.id}
                          className={`hover:bg-gray-50 ${isEdited ? 'bg-yellow-50' : ''}`}
                        >
                          <td className="px-4 py-3 text-xs text-gray-400 font-mono">
                            {material.code}
                          </td>
                          <td className="px-4 py-3 text-sm font-medium text-gray-900">
                            {material.displayName || <span className="text-gray-400">└</span>}
                          </td>
                          <td className="px-4 py-3 text-sm text-gray-600 font-mono">
                            {material.formattedSize}
                          </td>
                          <td className="px-4 py-3 text-sm text-center text-gray-500">
                            {material.unit}
                          </td>
                          <td className="px-4 py-3 text-sm text-right">
                            <div className="flex items-center justify-end space-x-2">
                              <span className="text-gray-400">¥</span>
                              <input
                                type="number"
                                value={currentPrice}
                                onChange={e =>
                                  handlePriceChange(material.id, Number(e.target.value))
                                }
                                onBlur={() => {
                                  if (isEdited) handleSaveSingle(material.id);
                                }}
                                onKeyDown={e => {
                                  if (e.key === 'Enter' && isEdited) {
                                    handleSaveSingle(material.id);
                                  }
                                }}
                                min={0}
                                className={`w-28 px-2 py-1 border rounded text-right text-sm font-mono focus:ring-blue-500 focus:border-blue-500 ${
                                  isEdited
                                    ? 'border-yellow-400 bg-yellow-50'
                                    : currentPrice === 0
                                    ? 'border-red-200 bg-red-50 text-red-400'
                                    : 'border-gray-200'
                                }`}
                              />
                              <span className="text-xs text-gray-400">/月</span>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
