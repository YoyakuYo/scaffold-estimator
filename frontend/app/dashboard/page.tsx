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
  Building2,
  Eye,
  History,
  Trash2,
  ChevronDown,
  ChevronUp,
  MoreHorizontal,
  ExternalLink,
  Copy,
  Receipt,
  Bot,
  ShieldCheck,
  Users,
  User,
  Download as DownloadIcon,
  CheckCircle,
  TrendingUp,
  Clock,
  Target,
  Sparkles,
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
      {/* ─── Hero Section ───────────────────────────────────────────── */}
      <div className="bg-gradient-to-br from-blue-600 via-blue-700 to-indigo-800 text-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
          <div className="text-center">
            <h1 className="text-4xl md:text-5xl font-bold mb-4">
              {t('features', 'heroTitle')}
            </h1>
            <p className="text-xl md:text-2xl text-blue-100 mb-8 max-w-3xl mx-auto">
              {t('features', 'heroSubtitle')}
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <button
                onClick={() => router.push('/scaffold')}
                className="px-8 py-4 bg-white text-blue-600 rounded-xl font-semibold text-lg hover:bg-blue-50 transition-colors shadow-lg flex items-center justify-center gap-2"
              >
                <Calculator className="h-5 w-5" />
                {t('features', 'heroCta')}
              </button>
              <button
                onClick={() => window.scrollTo({ top: document.getElementById('features')?.offsetTop || 0, behavior: 'smooth' })}
                className="px-8 py-4 bg-blue-500/20 text-white border-2 border-white/30 rounded-xl font-semibold text-lg hover:bg-blue-500/30 transition-colors flex items-center justify-center gap-2"
              >
                {t('features', 'heroCtaSecondary')}
                <ArrowRight className="h-5 w-5" />
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
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

        {/* ─── Stats Section ────────────────────────────────────────── */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-12">
          {[
            { icon: Clock, label: t('features', 'stat1Label'), value: t('features', 'stat1Value'), iconColor: 'text-blue-600' },
            { icon: Target, label: t('features', 'stat2Label'), value: t('features', 'stat2Value'), iconColor: 'text-green-600' },
            { icon: Building2, label: t('features', 'stat3Label'), value: t('features', 'stat3Value'), iconColor: 'text-purple-600' },
            { icon: DownloadIcon, label: t('features', 'stat4Label'), value: t('features', 'stat4Value'), iconColor: 'text-amber-600' },
          ].map((stat, i) => (
            <div key={i} className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 text-center">
              <stat.icon className={`h-8 w-8 ${stat.iconColor} mx-auto mb-2`} />
              <div className="text-3xl font-bold text-gray-900 mb-1">{stat.value}</div>
              <div className="text-sm text-gray-500">{stat.label}</div>
            </div>
          ))}
        </div>

        {/* ─── AI Features Section ──────────────────────────────────── */}
        <div id="features" className="mb-16">
          <div className="text-center mb-8">
            <div className="inline-flex items-center gap-2 px-4 py-2 bg-purple-100 text-purple-700 rounded-full text-sm font-semibold mb-3">
              <Sparkles className="h-4 w-4" />
              {t('features', 'aiTitle')}
            </div>
            <h2 className="text-3xl font-bold text-gray-900 mb-2">{t('features', 'aiTitle')}</h2>
            <p className="text-gray-600">{t('features', 'aiSubtitle')}</p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {[
              {
                icon: Eye,
                title: t('features', 'aiVisionTitle'),
                desc: t('features', 'aiVisionDesc'),
                bgColor: 'bg-purple-100',
                hoverBg: 'group-hover:bg-purple-200',
                iconColor: 'text-purple-600',
                borderHover: 'hover:border-purple-400',
                textColor: 'text-purple-600',
                action: () => router.push('/ai?tab=vision'),
              },
              {
                icon: Bot,
                title: t('features', 'aiChatTitle'),
                desc: t('features', 'aiChatDesc'),
                bgColor: 'bg-blue-100',
                hoverBg: 'group-hover:bg-blue-200',
                iconColor: 'text-blue-600',
                borderHover: 'hover:border-blue-400',
                textColor: 'text-blue-600',
                action: () => router.push('/ai?tab=chat'),
              },
              {
                icon: ShieldCheck,
                title: t('features', 'aiAnomalyTitle'),
                desc: t('features', 'aiAnomalyDesc'),
                bgColor: 'bg-green-100',
                hoverBg: 'group-hover:bg-green-200',
                iconColor: 'text-green-600',
                borderHover: 'hover:border-green-400',
                textColor: 'text-green-600',
                action: () => router.push('/ai?tab=anomaly'),
              },
            ].map((feature, i) => (
              <div
                key={i}
                onClick={feature.action}
                className={`bg-white rounded-xl shadow-sm border-2 border-gray-200 ${feature.borderHover} hover:shadow-lg transition-all p-6 cursor-pointer group`}
              >
                <div className={`w-12 h-12 rounded-xl ${feature.bgColor} flex items-center justify-center mb-4 ${feature.hoverBg} transition-colors`}>
                  <feature.icon className={`h-6 w-6 ${feature.iconColor}`} />
                </div>
                <h3 className="text-lg font-semibold text-gray-900 mb-2">{feature.title}</h3>
                <p className="text-sm text-gray-600 mb-4">{feature.desc}</p>
                <div className={`flex items-center gap-2 ${feature.textColor} text-sm font-medium`}>
                  {locale === 'ja' ? '詳細を見る' : 'Learn More'}
                  <ArrowRight className="h-4 w-4" />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* ─── Core Features Section ───────────────────────────────── */}
        <div className="mb-16">
          <div className="text-center mb-8">
            <h2 className="text-3xl font-bold text-gray-900 mb-2">{t('features', 'coreTitle')}</h2>
            <p className="text-gray-600">{t('features', 'coreSubtitle')}</p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {[
              {
                icon: Calculator,
                title: t('features', 'coreCalcTitle'),
                desc: t('features', 'coreCalcDesc'),
                bgColor: 'bg-blue-100',
                iconColor: 'text-blue-600',
              },
              {
                icon: Receipt,
                title: t('features', 'coreQuotationTitle'),
                desc: t('features', 'coreQuotationDesc'),
                bgColor: 'bg-green-100',
                iconColor: 'text-green-600',
              },
              {
                icon: Box,
                title: t('features', 'coreVisualizationTitle'),
                desc: t('features', 'coreVisualizationDesc'),
                bgColor: 'bg-purple-100',
                iconColor: 'text-purple-600',
              },
            ].map((feature, i) => (
              <div key={i} className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
                <div className={`w-12 h-12 rounded-xl ${feature.bgColor} flex items-center justify-center mb-4`}>
                  <feature.icon className={`h-6 w-6 ${feature.iconColor}`} />
                </div>
                <h3 className="text-lg font-semibold text-gray-900 mb-2">{feature.title}</h3>
                <p className="text-sm text-gray-600">{feature.desc}</p>
              </div>
            ))}
          </div>
        </div>

        {/* ─── Team Management Section (Admin Only) ─────────────────────────────── */}
        {isAdmin && (
          <div className="mb-16">
            <div className="text-center mb-8">
              <h2 className="text-3xl font-bold text-gray-900 mb-2">{t('features', 'teamTitle')}</h2>
              <p className="text-gray-600">{t('features', 'teamSubtitle')}</p>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {[
                {
                  icon: Users,
                  title: t('features', 'teamUsersTitle'),
                  desc: t('features', 'teamUsersDesc'),
                  action: () => router.push('/users'),
                },
                {
                  icon: User,
                  title: t('features', 'teamProfileTitle'),
                  desc: t('features', 'teamProfileDesc'),
                  action: () => router.push('/profile'),
                },
              ].map((feature, i) => (
              <div
                key={i}
                onClick={feature.action}
                className="bg-white rounded-xl shadow-sm border-2 border-gray-200 hover:border-blue-400 hover:shadow-lg transition-all p-6 cursor-pointer group"
              >
                <div className="w-12 h-12 rounded-xl bg-blue-100 flex items-center justify-center mb-4 group-hover:bg-blue-200 transition-colors">
                  <feature.icon className="h-6 w-6 text-blue-600" />
                </div>
                <h3 className="text-lg font-semibold text-gray-900 mb-2">{feature.title}</h3>
                <p className="text-sm text-gray-600 mb-4">{feature.desc}</p>
                <div className="flex items-center gap-2 text-blue-600 text-sm font-medium">
                  {locale === 'ja' ? '管理画面へ' : 'Go to Management'}
                  <ArrowRight className="h-4 w-4" />
                </div>
              </div>
              ))}
            </div>
          </div>
        )}

        {/* ─── PWA / Desktop App Section ────────────────────────────── */}
        <div className="mb-16">
          <div className="bg-gradient-to-r from-indigo-50 to-purple-50 rounded-2xl p-8 border border-indigo-200">
            <div className="flex flex-col md:flex-row items-center gap-6">
              <div className="flex-1">
                <div className="inline-flex items-center gap-2 px-3 py-1 bg-indigo-100 text-indigo-700 rounded-full text-xs font-semibold mb-3">
                  <DownloadIcon className="h-3 w-3" />
                  {t('features', 'pwaTitle')}
                </div>
                <h2 className="text-2xl font-bold text-gray-900 mb-2">{t('features', 'pwaTitle')}</h2>
                <p className="text-gray-600 mb-4">{t('features', 'pwaSubtitle')}</p>
                <div className="space-y-3">
                  <div className="flex items-start gap-3">
                    <CheckCircle className="h-5 w-5 text-green-600 mt-0.5 flex-shrink-0" />
                    <div>
                      <p className="font-medium text-gray-900">{t('features', 'pwaInstallTitle')}</p>
                      <p className="text-sm text-gray-600">{t('features', 'pwaInstallDesc')}</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <CheckCircle className="h-5 w-5 text-green-600 mt-0.5 flex-shrink-0" />
                    <div>
                      <p className="font-medium text-gray-900">{t('features', 'pwaOfflineTitle')}</p>
                      <p className="text-sm text-gray-600">{t('features', 'pwaOfflineDesc')}</p>
                    </div>
                  </div>
                </div>
              </div>
              <div className="flex-shrink-0">
                <div className="w-32 h-32 bg-white rounded-2xl shadow-lg flex items-center justify-center">
                  <DownloadIcon className="h-16 w-16 text-indigo-600" />
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* ─── Benefits Section ─────────────────────────────────────── */}
        <div className="mb-16">
          <div className="text-center mb-8">
            <h2 className="text-3xl font-bold text-gray-900 mb-2">{t('features', 'benefitsTitle')}</h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            {[
              { icon: TrendingUp, title: t('features', 'benefit1Title'), desc: t('features', 'benefit1Desc'), bgColor: 'bg-blue-100', iconColor: 'text-blue-600' },
              { icon: Target, title: t('features', 'benefit2Title'), desc: t('features', 'benefit2Desc'), bgColor: 'bg-green-100', iconColor: 'text-green-600' },
              { icon: Users, title: t('features', 'benefit3Title'), desc: t('features', 'benefit3Desc'), bgColor: 'bg-purple-100', iconColor: 'text-purple-600' },
              { icon: CheckCircle, title: t('features', 'benefit4Title'), desc: t('features', 'benefit4Desc'), bgColor: 'bg-amber-100', iconColor: 'text-amber-600' },
            ].map((benefit, i) => (
              <div key={i} className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
                <div className={`w-10 h-10 rounded-lg ${benefit.bgColor} flex items-center justify-center mb-4`}>
                  <benefit.icon className={`h-5 w-5 ${benefit.iconColor}`} />
                </div>
                <h3 className="text-lg font-semibold text-gray-900 mb-2">{benefit.title}</h3>
                <p className="text-sm text-gray-600">{benefit.desc}</p>
              </div>
            ))}
          </div>
        </div>

        {/* ─── Quick Start Section ──────────────────────────────────── */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-8 mb-12">
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

        {/* ─── History Section (Collapsible) ───────────────────────── */}
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
      </div>
    </div>
  );
}
