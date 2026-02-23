'use client';

import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { scaffoldConfigsApi, ScaffoldConfiguration } from '@/lib/api/scaffold-configs';
import { usersApi } from '@/lib/api/users';
import { useI18n } from '@/lib/i18n';
import Link from 'next/link';
import {
  Calculator,
  ArrowRight,
  Loader2,
  FileSpreadsheet,
  Box,
  Eye,
  History,
  Trash2,
  ChevronDown,
  ChevronUp,
  MoreHorizontal,
  ExternalLink,
  Copy,
  Receipt,
  Users,
  User,
  Clock,
  Layers,
} from 'lucide-react';
import { useState, useRef, useEffect } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';

export default function DashboardPage() {
  const router = useRouter();
  const { locale, t } = useI18n();
  const queryClient = useQueryClient();
  const [historyOpen, setHistoryOpen] = useState(false);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // Check if current user is admin (for conditional rendering)
  const { data: currentUser } = useQuery({
    queryKey: ['profile'],
    queryFn: usersApi.getProfile,
    retry: false,
    staleTime: 1000 * 60 * 5,
  });
  const isAdmin = currentUser?.role === 'admin';

  // Get pending users count (admin only)
  const { data: pendingCount } = useQuery({
    queryKey: ['pending-count'],
    queryFn: usersApi.getPendingCount,
    retry: false,
    enabled: isAdmin,
    refetchInterval: 30000, // Refresh every 30 seconds
  });

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpenMenuId(null);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const SIDE_LABELS: Record<string, string> = {
    north: t('sides', 'north'),
    south: t('sides', 'south'),
    east: t('sides', 'east'),
    west: t('sides', 'west'),
  };

  // Fetch recent scaffold configs
  const { data: configs, isLoading, isError } = useQuery<ScaffoldConfiguration[]>({
    queryKey: ['scaffold-configs'],
    queryFn: () => scaffoldConfigsApi.list(),
    retry: false,
    staleTime: 1000 * 60 * 5,
  });

  // Delete mutation
  const deleteMutation = useMutation({
    mutationFn: (configId: string) => scaffoldConfigsApi.delete(configId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['scaffold-configs'] });
    },
  });

  const handleDelete = async (configId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const confirmMessage = t('dashboard', 'confirmDelete') || 'Are you sure you want to delete this calculation?';
    if (window.confirm(confirmMessage)) {
      try {
        await deleteMutation.mutateAsync(configId);
      } catch (error) {
        const errorMessage = t('dashboard', 'deleteFailed') || 'Failed to delete calculation';
        alert(errorMessage);
      }
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* ─── Intro (usage, not marketing) ─────────────────────────── */}
        <p className="text-gray-600 mb-6">
          {t('dashboard', 'dashboardIntro')}
        </p>
        {/* ─── Pending Users Alert (Admin Only) ──────────────────────── */}
        {isAdmin && pendingCount && pendingCount.count > 0 && (
          <div className="mb-6 bg-amber-50 border-2 border-amber-300 rounded-xl p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Clock className="h-6 w-6 text-amber-600" />
                <div>
                  <p className="font-semibold text-amber-900">
                    {locale === 'ja'
                      ? `${pendingCount.count}件の承認待ちユーザーがあります`
                      : `${pendingCount.count} user(s) pending approval`}
                  </p>
                  <p className="text-sm text-amber-700">
                    {locale === 'ja'
                      ? 'ユーザー管理ページで承認または拒否してください'
                      : 'Please approve or reject them in the User Management page'}
                  </p>
                </div>
              </div>
              <Link
                href="/users?filter=pending"
                className="px-4 py-2 bg-amber-600 text-white rounded-lg hover:bg-amber-700 transition-colors font-medium text-sm flex items-center gap-2"
              >
                {locale === 'ja' ? '承認する' : 'Review'}
                <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
          </div>
        )}

        {/* ─── Quick Start ────────────────────────────────────────── */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-8 mb-8">
          <div className="flex items-center justify-between flex-wrap gap-4">
            <div>
              <h2 className="text-2xl font-bold text-gray-900 mb-2">
                {t('dashboard', 'quickStartTitle')}
              </h2>
              <p className="text-gray-600">{t('dashboard', 'quickStartDesc')}</p>
            </div>
            <button
              onClick={() => router.push('/scaffold')}
              className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-semibold flex items-center gap-2"
            >
              <Calculator className="h-5 w-5" />
              {t('dashboard', 'quickStartButton')}
            </button>
          </div>
        </div>

        {/* ─── History ────────────────────────────────────────────── */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
          <button
            onClick={() => setHistoryOpen(!historyOpen)}
            className="w-full p-6 flex items-center justify-between hover:bg-gray-50 transition-colors"
          >
            <h2 className="text-lg font-semibold text-gray-800 flex items-center gap-2">
              <History className="h-5 w-5 text-gray-400" />
              {t('dashboard', 'history')}
              {configs && configs.length > 0 && (
                <span className="text-sm font-normal text-gray-500 ml-2">({configs.length})</span>
              )}
            </h2>
            {historyOpen ? (
              <ChevronUp className="h-5 w-5 text-gray-400" />
            ) : (
              <ChevronDown className="h-5 w-5 text-gray-400" />
            )}
          </button>

          {historyOpen && (
            <div className="border-t border-gray-200 p-6">
              {isLoading ? (
                <div className="flex justify-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin text-blue-500" />
                </div>
              ) : isError ? (
                <div className="text-center py-8">
                  <Calculator className="h-12 w-12 text-gray-300 mx-auto mb-3" />
                  <p className="text-gray-400 mb-2">{t('dashboard', 'backendDown')}</p>
                  <p className="text-xs text-gray-400">{t('dashboard', 'backendDownHint')}</p>
                </div>
              ) : configs && configs.length > 0 ? (
                <div className="space-y-2" ref={menuRef}>
                  {configs.map((cfg) => {
                    const enabledWalls = cfg.walls?.filter((w) => w.enabled) || [];
                    const wallNames = enabledWalls.map((w) => SIDE_LABELS[w.side] || w.side).join('・');
                    const hasResult = cfg.status === 'calculated' || cfg.status === 'reviewed';
                    const isMenuOpen = openMenuId === cfg.id;

                    return (
                      <div
                        key={cfg.id}
                        className={`relative border rounded-lg transition-all ${
                          hasResult
                            ? 'border-gray-200 hover:border-blue-300 hover:shadow-md cursor-pointer'
                            : 'border-gray-100 hover:bg-gray-50'
                        }`}
                      >
                        <div
                          onClick={() => hasResult && router.push(`/scaffold/${cfg.id}`)}
                          className="flex items-center justify-between p-4"
                        >
                          <div className="flex items-center gap-4 flex-1 min-w-0">
                            <div
                              className={`px-2.5 py-1 rounded-md text-xs font-semibold whitespace-nowrap ${
                                cfg.status === 'calculated'
                                  ? 'bg-green-100 text-green-700'
                                  : cfg.status === 'reviewed'
                                  ? 'bg-blue-100 text-blue-700'
                                  : 'bg-gray-100 text-gray-600'
                              }`}
                            >
                              {cfg.status === 'calculated'
                                ? t('dashboard', 'statusCalculated')
                                : cfg.status === 'reviewed'
                                ? t('dashboard', 'statusReviewed')
                                : t('dashboard', 'statusConfigured')}
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="font-medium text-gray-800 truncate">
                                {t('dashboard', 'buildingHeight')}: {cfg.buildingHeightMm.toLocaleString()}mm | {t('dashboard', 'scaffoldWidth')}: {cfg.scaffoldWidthMm}mm
                              </div>
                              <div className="text-sm text-gray-500 truncate">
                                {wallNames || '—'} |{' '}
                                {new Date(cfg.createdAt).toLocaleDateString(locale === 'ja' ? 'ja-JP' : 'en-US')}
                              </div>
                            </div>
                          </div>

                          <div className="flex items-center gap-2 ml-3 flex-shrink-0" onClick={(e) => e.stopPropagation()}>
                            {hasResult && (
                              <button
                                onClick={() => router.push(`/scaffold/${cfg.id}`)}
                                className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white text-sm rounded-md hover:bg-blue-700 transition-colors"
                              >
                                <Eye className="h-3.5 w-3.5" />
                                {t('dashboard', 'viewResult')}
                              </button>
                            )}

                            <div className="relative">
                              <button
                                onClick={() => setOpenMenuId(isMenuOpen ? null : cfg.id)}
                                className="flex items-center justify-center w-8 h-8 rounded-md border border-gray-200 hover:bg-gray-100 transition-colors text-gray-500 hover:text-gray-700"
                              >
                                <MoreHorizontal className="h-4 w-4" />
                              </button>

                              {isMenuOpen && (
                                <div className="absolute right-0 top-full mt-1 w-52 bg-white rounded-lg shadow-lg border border-gray-200 py-1 z-50">
                                  {hasResult && (
                                    <>
                                      <button
                                        onClick={() => { setOpenMenuId(null); router.push(`/scaffold/${cfg.id}`); }}
                                        className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50"
                                      >
                                        <ExternalLink className="h-4 w-4 text-blue-500" />
                                        {t('dashboard', 'openResult')}
                                      </button>
                                      <button
                                        onClick={() => { setOpenMenuId(null); router.push(`/scaffold/${cfg.id}?tab=3d`); }}
                                        className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50"
                                      >
                                        <Box className="h-4 w-4 text-purple-500" />
                                        {t('dashboard', 'view3D')}
                                      </button>
                                      <button
                                        onClick={() => { setOpenMenuId(null); router.push(`/scaffold/${cfg.id}?tab=2d`); }}
                                        className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50"
                                      >
                                        <Layers className="h-4 w-4 text-indigo-500" />
                                        {t('dashboard', 'view2D')}
                                      </button>
                                      <div className="border-t border-gray-100 my-1" />
                                      <button
                                        onClick={() => { setOpenMenuId(null); router.push(`/quotations/create?configId=${cfg.id}&projectId=${cfg.projectId}`); }}
                                        className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50"
                                      >
                                        <Receipt className="h-4 w-4 text-emerald-500" />
                                        {t('dashboard', 'createQuotation')}
                                      </button>
                                      <button
                                        onClick={async () => {
                                          setOpenMenuId(null);
                                          try {
                                            const blob = await scaffoldConfigsApi.exportExcel(cfg.id);
                                            const url = URL.createObjectURL(blob);
                                            const a = document.createElement('a');
                                            a.href = url;
                                            a.download = `scaffold_${cfg.id.slice(0, 8)}.xlsx`;
                                            a.click();
                                            URL.revokeObjectURL(url);
                                          } catch { alert(t('result', 'excelFailed') || 'Excel export failed'); }
                                        }}
                                        className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50"
                                      >
                                        <FileSpreadsheet className="h-4 w-4 text-green-500" />
                                        {t('dashboard', 'exportExcel')}
                                      </button>
                                    </>
                                  )}
                                  <div className="border-t border-gray-100 my-1" />
                                  <button
                                    onClick={() => {
                                      setOpenMenuId(null);
                                      router.push('/scaffold');
                                    }}
                                    className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50"
                                  >
                                    <Copy className="h-4 w-4 text-gray-400" />
                                    {t('dashboard', 'newCalculation')}
                                  </button>
                                  <div className="border-t border-gray-100 my-1" />
                                  <button
                                    onClick={(e) => { setOpenMenuId(null); handleDelete(cfg.id, e); }}
                                    disabled={deleteMutation.isPending}
                                    className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-red-600 hover:bg-red-50"
                                  >
                                    <Trash2 className="h-4 w-4" />
                                    {t('dashboard', 'delete')}
                                  </button>
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="text-center py-8">
                  <Calculator className="h-12 w-12 text-gray-300 mx-auto mb-3" />
                  <p className="text-gray-500 mb-2">{t('dashboard', 'noResults')}</p>
                  <button
                    onClick={() => router.push('/scaffold')}
                    className="text-blue-600 font-semibold hover:underline flex items-center gap-1 mx-auto"
                  >
                    {t('dashboard', 'firstCalc')}
                    <ArrowRight className="h-4 w-4" />
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        {/* ─── Admin (Admin Only) ─────────────────────────────────── */}
        {isAdmin && (
          <div className="mt-8">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">{t('features', 'teamTitle')}</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <button
                onClick={() => router.push('/users')}
                className="bg-white rounded-xl border border-gray-200 p-5 text-left hover:border-blue-300 hover:shadow-md transition-all flex items-center gap-4"
              >
                <div className="w-10 h-10 rounded-lg bg-blue-100 flex items-center justify-center">
                  <Users className="h-5 w-5 text-blue-600" />
                </div>
                <div>
                  <div className="font-medium text-gray-900">{t('features', 'teamUsersTitle')}</div>
                  <div className="text-sm text-gray-500">{t('features', 'teamUsersDesc')}</div>
                </div>
                <ArrowRight className="h-4 w-4 text-gray-400 ml-auto" />
              </button>
              <button
                onClick={() => router.push('/profile')}
                className="bg-white rounded-xl border border-gray-200 p-5 text-left hover:border-blue-300 hover:shadow-md transition-all flex items-center gap-4"
              >
                <div className="w-10 h-10 rounded-lg bg-blue-100 flex items-center justify-center">
                  <User className="h-5 w-5 text-blue-600" />
                </div>
                <div>
                  <div className="font-medium text-gray-900">{t('features', 'teamProfileTitle')}</div>
                  <div className="text-sm text-gray-500">{t('features', 'teamProfileDesc')}</div>
                </div>
                <ArrowRight className="h-4 w-4 text-gray-400 ml-auto" />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
