'use client';

import { useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { scaffoldConfigsApi, ScaffoldConfiguration } from '@/lib/api/scaffold-configs';
import { usersApi, UserProfile } from '@/lib/api/users';
import { messagesApi, ConversationWithUser } from '@/lib/api/messages';
import { useI18n } from '@/lib/i18n';
import { formatMmAsMetersLabel } from '@/lib/dimension-meters';
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
  Building2,
  ShieldCheck,
  MessageSquare,
  Activity,
  UserX,
  AlertTriangle,
  Settings,
  Send,
  CheckCircle,
  XCircle,
  HardHat,
  Sparkles,
  ClipboardList,
  Table2,
  Shapes,
  FolderOutput,
  Info,
} from 'lucide-react';
import { useState, useRef, useEffect } from 'react';

export default function DashboardPage() {
  const router = useRouter();
  const { locale, t } = useI18n();
  const queryClient = useQueryClient();

  const { data: currentUser } = useQuery({
    queryKey: ['profile'],
    queryFn: usersApi.getProfile,
    retry: false,
    staleTime: 1000 * 60 * 5,
  });
  const isAdmin = currentUser?.role === 'superadmin';

  if (isAdmin) {
    return <AdminDashboard />;
  }
  return <UserDashboard />;
}

// ═══════════════════════════════════════════════════════════════
// ADMIN DASHBOARD — CEO / Platform Owner View
// ═══════════════════════════════════════════════════════════════

function AdminDashboard() {
  const router = useRouter();
  const { locale, t } = useI18n();
  const queryClient = useQueryClient();

  const { data: profile } = useQuery({
    queryKey: ['profile'],
    queryFn: usersApi.getProfile,
  });

  const { data: stats, isLoading: statsLoading } = useQuery({
    queryKey: ['platform-stats'],
    queryFn: usersApi.getPlatformStats,
    refetchInterval: 30000,
  });

  const { data: allUsers } = useQuery({
    queryKey: ['users'],
    queryFn: usersApi.listUsers,
    staleTime: 1000 * 60 * 2,
  });

  const { data: onlineUsers } = useQuery({
    queryKey: ['online-users'],
    queryFn: usersApi.getOnlineUsers,
    refetchInterval: 15000,
  });

  const { data: conversations } = useQuery({
    queryKey: ['admin-conversations'],
    queryFn: messagesApi.listConversations,
  });

  const { data: configs } = useQuery<ScaffoldConfiguration[]>({
    queryKey: ['scaffold-configs'],
    queryFn: () => scaffoldConfigsApi.list(),
    staleTime: 1000 * 60 * 5,
  });

  const pendingUsers = allUsers?.filter((u) => u.approvalStatus === 'pending') ?? [];
  const unreadConvs = conversations?.filter((c) => (c.unreadCount ?? 0) > 0) ?? [];
  const totalUnread = unreadConvs.reduce((s, c) => s + (c.unreadCount ?? 0), 0);

  const [approvalModeByUser, setApprovalModeByUser] = useState<Record<string, string>>({});

  const approveMutation = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload?: import('@/lib/api/users').ApproveUserPayload }) =>
      usersApi.approveUser(id, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] });
      queryClient.invalidateQueries({ queryKey: ['platform-stats'] });
    },
  });

  const runApprove = (u: UserProfile) => {
    const mode = approvalModeByUser[u.id] ?? 'trial';
    if (mode === 'trial') {
      approveMutation.mutate({ id: u.id, payload: {} });
      return;
    }
    const tier = mode.replace('bank_', '') as 'basic' | 'medium' | 'premium';
    const planWord =
      tier === 'basic'
        ? t('billing', 'planTierBasic')
        : tier === 'medium'
          ? t('billing', 'planTierMedium')
          : t('billing', 'planTierPremium');
    const msg = t('adminDashboard', 'confirmApproveBank').replace('{email}', u.email).replace('{plan}', planWord);
    if (!window.confirm(msg)) return;
    approveMutation.mutate({ id: u.id, payload: { paymentActivation: 'bank_transfer', planTier: tier } });
  };
  const rejectMutation = useMutation({
    mutationFn: usersApi.rejectUser,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] });
      queryClient.invalidateQueries({ queryKey: ['platform-stats'] });
    },
  });

  const greeting = () => {
    const h = new Date().getHours();
    const name = profile?.firstName || 'Admin';
    if (h < 12) return t('adminDashboard', 'greetingMorning').replace('{name}', name);
    if (h < 18) return t('adminDashboard', 'greetingAfternoon').replace('{name}', name);
    return t('adminDashboard', 'greetingEvening').replace('{name}', name);
  };

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        {/* ── Header ── */}
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-slate-900">{greeting()}</h1>
          <p className="text-sm text-slate-500 mt-1">
            {t('adminDashboard', 'platformSubtitle')}
          </p>
        </div>

        {/* ── KPI Cards ── */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          <KpiCard
            icon={<Users className="h-5 w-5" />}
            label={t('adminDashboard', 'totalUsers')}
            value={stats?.totalUsers ?? '—'}
            color="blue"
            loading={statsLoading}
          />
          <KpiCard
            icon={<Building2 className="h-5 w-5" />}
            label={t('adminDashboard', 'companies')}
            value={stats?.totalCompanies ?? '—'}
            color="purple"
            loading={statsLoading}
          />
          <KpiCard
            icon={<Activity className="h-5 w-5" />}
            label={t('adminDashboard', 'onlineNow')}
            value={stats?.onlineCount ?? '—'}
            color="green"
            loading={statsLoading}
            pulse={!!stats && stats.onlineCount > 0}
          />
          <KpiCard
            icon={<Calculator className="h-5 w-5" />}
            label={t('adminDashboard', 'totalCalculations')}
            value={configs?.length ?? '—'}
            color="amber"
            loading={!configs}
          />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* ── Left Column (2/3) ── */}
          <div className="lg:col-span-2 space-y-6">
            {/* Pending Approvals */}
            {pendingUsers.length > 0 && (
              <div className="bg-white rounded-xl border border-amber-200 shadow-sm">
                <div className="px-5 py-4 border-b border-amber-100 bg-amber-50/50 rounded-t-xl flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <AlertTriangle className="h-5 w-5 text-amber-600" />
                    <h2 className="font-semibold text-amber-900">
                      {t('adminDashboard', 'pendingApprovals')} ({pendingUsers.length})
                    </h2>
                  </div>
                  <Link href="/users?filter=pending" className="text-sm text-amber-700 hover:underline">
                    {t('adminDashboard', 'viewAll')} →
                  </Link>
                </div>
                <div className="divide-y divide-gray-100">
                  {pendingUsers.slice(0, 5).map((u) => (
                    <div key={u.id} className="px-5 py-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-slate-900 truncate">
                          {[u.lastName, u.firstName].filter(Boolean).join(' ') || u.email}
                        </p>
                        <p className="text-xs text-slate-500">{u.email}</p>
                        <label className="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-600">
                          <span className="shrink-0">{t('adminDashboard', 'approvalModeLabel')}</span>
                          <select
                            value={approvalModeByUser[u.id] ?? 'trial'}
                            onChange={(e) =>
                              setApprovalModeByUser((m) => ({ ...m, [u.id]: e.target.value }))
                            }
                            className="border border-slate-200 rounded-md px-2 py-1 text-slate-800 max-w-[200px] text-xs"
                          >
                            <option value="trial">{t('adminDashboard', 'approvalModeTrial')}</option>
                            <option value="bank_basic">{t('adminDashboard', 'approvalModeBankBasic')}</option>
                            <option value="bank_medium">{t('adminDashboard', 'approvalModeBankMedium')}</option>
                            <option value="bank_premium">{t('adminDashboard', 'approvalModeBankPremium')}</option>
                          </select>
                        </label>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <button
                          onClick={() => runApprove(u)}
                          disabled={approveMutation.isPending}
                          className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors"
                        >
                          <CheckCircle className="h-3.5 w-3.5" />
                          {t('adminDashboard', 'approve')}
                        </button>
                        <button
                          onClick={() => rejectMutation.mutate(u.id)}
                          disabled={rejectMutation.isPending}
                          className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium bg-white border border-red-300 text-red-600 rounded-lg hover:bg-red-50 transition-colors"
                        >
                          <XCircle className="h-3.5 w-3.5" />
                          {t('adminDashboard', 'reject')}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Messages Inbox */}
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
              <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <MessageSquare className="h-5 w-5 text-blue-600" />
                  <h2 className="font-semibold text-slate-900">
                    {t('adminDashboard', 'supportMessages')}
                  </h2>
                  {totalUnread > 0 && (
                    <span className="h-5 min-w-[20px] px-1.5 rounded-full bg-red-500 text-white text-xs flex items-center justify-center">
                      {totalUnread}
                    </span>
                  )}
                </div>
                <Link
                  href="/admin/messages"
                  className="text-sm text-blue-600 hover:underline flex items-center gap-1"
                >
                  {t('adminDashboard', 'openInbox')} →
                </Link>
              </div>
              <div className="divide-y divide-gray-100">
                {!conversations ? (
                  <div className="p-6 flex justify-center"><Loader2 className="h-5 w-5 animate-spin text-gray-400" /></div>
                ) : conversations.length === 0 ? (
                  <p className="p-6 text-sm text-gray-400 text-center">
                    {t('adminDashboard', 'noConversations')}
                  </p>
                ) : (
                  conversations.slice(0, 5).map((c) => (
                    <button
                      key={c.id}
                      onClick={() => router.push('/admin/messages')}
                      className="w-full px-5 py-3 flex items-center gap-3 hover:bg-slate-50 transition-colors text-left"
                    >
                      <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold ${
                        (c.unreadCount ?? 0) > 0 ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-500'
                      }`}>
                        {(c.user?.firstName?.[0] || c.user?.email?.[0] || '?').toUpperCase()}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between">
                          <p className={`text-sm truncate ${(c.unreadCount ?? 0) > 0 ? 'font-semibold text-slate-900' : 'text-slate-700'}`}>
                            {c.user?.firstName || c.user?.lastName
                              ? [c.user.lastName, c.user.firstName].filter(Boolean).join(' ')
                              : c.user?.email}
                          </p>
                          <span className="text-xs text-slate-400 flex-shrink-0 ml-2">
                            {new Date(c.updatedAt).toLocaleDateString(locale === 'ja' ? 'ja-JP' : locale === 'fr' ? 'fr-FR' : 'en-US', { month: 'short', day: 'numeric' })}
                          </span>
                        </div>
                        {c.lastMessage && (
                          <p className="text-xs text-slate-500 truncate mt-0.5">{c.lastMessage.body}</p>
                        )}
                      </div>
                      {(c.unreadCount ?? 0) > 0 && (
                        <span className="flex-shrink-0 h-2 w-2 rounded-full bg-blue-500" />
                      )}
                    </button>
                  ))
                )}
              </div>
            </div>

          </div>

          {/* ── Right Column (1/3) ── */}
            <div className="space-y-6">
            {/* Online Users */}
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
              <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
                <h2 className="font-semibold text-slate-900 flex items-center gap-2">
                  <Activity className="h-5 w-5 text-green-500" />
                  {t('adminDashboard', 'onlineNowLive')}
                </h2>
                <span className="text-xs text-slate-400">{t('adminDashboard', 'live')}</span>
              </div>
              <div className="p-3">
                {!onlineUsers ? (
                  <div className="p-4 flex justify-center"><Loader2 className="h-5 w-5 animate-spin text-gray-400" /></div>
                ) : onlineUsers.length === 0 ? (
                  <p className="p-3 text-sm text-gray-400 text-center">{t('adminDashboard', 'noOneOnline')}</p>
                ) : (
                  <div className="space-y-1">
                    {onlineUsers.slice(0, 8).map((u) => (
                      <div key={u.id} className="flex items-center gap-2.5 px-3 py-2 rounded-lg">
                        <span className="relative flex-shrink-0">
                          <span className="h-2 w-2 rounded-full bg-green-500 absolute -top-0.5 -right-0.5 ring-2 ring-white" />
                          <span className="flex items-center justify-center h-7 w-7 rounded-full bg-slate-100 text-xs font-bold text-slate-600">
                            {(u.firstName?.[0] || u.email[0]).toUpperCase()}
                          </span>
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm text-slate-800 truncate">
                            {[u.lastName, u.firstName].filter(Boolean).join(' ') || u.email}
                          </p>
                        </div>
                        <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${
                          u.role === 'superadmin' ? 'bg-amber-100 text-amber-700' :
                          u.role === 'estimator' ? 'bg-blue-100 text-blue-700' :
                          'bg-gray-100 text-gray-600'
                        }`}>
                          {u.role}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// KPI CARD
// ═══════════════════════════════════════════════════════════════

function KpiCard({
  icon,
  label,
  value,
  color,
  loading,
  pulse,
}: {
  icon: React.ReactNode;
  label: string;
  value: number | string;
  color: 'blue' | 'purple' | 'green' | 'amber';
  loading?: boolean;
  pulse?: boolean;
}) {
  const bg = { blue: 'bg-blue-50', purple: 'bg-purple-50', green: 'bg-green-50', amber: 'bg-amber-50' }[color];
  const iconColor = { blue: 'text-blue-600', purple: 'text-purple-600', green: 'text-green-600', amber: 'text-amber-600' }[color];
  const borderColor = { blue: 'border-blue-100', purple: 'border-purple-100', green: 'border-green-100', amber: 'border-amber-100' }[color];

  return (
    <div className={`bg-white rounded-xl border ${borderColor} shadow-sm p-5`}>
      <div className="flex items-center justify-between mb-3">
        <div className={`p-2 rounded-lg ${bg}`}>
          <span className={iconColor}>{icon}</span>
        </div>
        {pulse && <span className="h-2.5 w-2.5 rounded-full bg-green-500 animate-pulse" />}
      </div>
      {loading ? (
        <Loader2 className="h-5 w-5 animate-spin text-gray-300" />
      ) : (
        <div className="text-2xl font-bold text-slate-900">{value}</div>
      )}
      <p className="text-xs text-slate-500 mt-1">{label}</p>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// USER DASHBOARD — Regular users (estimator / viewer)
// ═══════════════════════════════════════════════════════════════

function UserDashboard() {
  const router = useRouter();
  const { locale, t } = useI18n();
  const queryClient = useQueryClient();
  const [historyOpen, setHistoryOpen] = useState(false);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const selectAllRef = useRef<HTMLInputElement>(null);

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

  const { data: configs, isLoading, isError } = useQuery<ScaffoldConfiguration[]>({
    queryKey: ['scaffold-configs'],
    queryFn: () => scaffoldConfigsApi.list(),
    retry: false,
    staleTime: 1000 * 60 * 5,
  });

  const deleteMutation = useMutation({
    mutationFn: (configId: string) => scaffoldConfigsApi.delete(configId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['scaffold-configs'] });
    },
  });

  useEffect(() => {
    if (!configs) return;
    const valid = new Set(configs.map((c) => c.id));
    setSelectedIds((prev) => {
      const next = new Set([...prev].filter((id) => valid.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [configs]);

  useEffect(() => {
    const el = selectAllRef.current;
    if (!el || !configs?.length) return;
    el.indeterminate = selectedIds.size > 0 && selectedIds.size < configs.length;
  }, [selectedIds, configs?.length]);

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAll = () => {
    if (!configs?.length) return;
    setSelectedIds(new Set(configs.map((c) => c.id)));
  };

  const clearSelection = () => setSelectedIds(new Set());

  const handleBulkDelete = async () => {
    const ids = [...selectedIds];
    if (ids.length === 0) return;
    const msg = (t('dashboard', 'confirmDeleteMany') || 'Delete {n} selected?').replace('{n}', String(ids.length));
    if (!window.confirm(msg)) return;
    setBulkDeleting(true);
    setOpenMenuId(null);
    try {
      await Promise.all(ids.map((id) => scaffoldConfigsApi.delete(id)));
      queryClient.invalidateQueries({ queryKey: ['scaffold-configs'] });
      setSelectedIds(new Set());
    } catch {
      alert(t('dashboard', 'deleteFailed'));
    } finally {
      setBulkDeleting(false);
    }
  };

  const handleDelete = async (configId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (window.confirm(t('dashboard', 'confirmDelete') || 'Delete this calculation?')) {
      try {
        await deleteMutation.mutateAsync(configId);
        setSelectedIds((prev) => {
          const next = new Set(prev);
          next.delete(configId);
          return next;
        });
      } catch { /* handled */ }
    }
  };

  // Subscription check disabled until work is complete — always allow access
  const hasBillingAccess = true;

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <div
        className="h-1 w-full bg-gradient-to-r from-slate-300 via-blue-500 to-slate-300 opacity-90"
        aria-hidden
      />

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 lg:py-10 space-y-10">
        {/* ── Hero ── */}
        <header className="text-center sm:text-left max-w-3xl mx-auto sm:mx-0">
          <span className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3.5 py-1.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-600 shadow-sm">
            <HardHat className="h-4 w-4 shrink-0 text-slate-500" aria-hidden />
            {t('dashboard', 'siteHubBadge')}
          </span>
          <h1 className="mt-4 text-3xl sm:text-4xl font-extrabold tracking-tight text-slate-900 leading-tight">
            {t('dashboard', 'title')}
          </h1>
          <p className="mt-3 text-base text-slate-600 leading-relaxed">{t('dashboard', 'dashboardIntro')}</p>
          <p className="mt-2 text-sm text-slate-500">{t('dashboard', 'subtitle')}</p>
        </header>

        {/* ── End-to-end flow ── */}
        <section
          className="relative overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm"
          aria-labelledby="dashboard-flow-heading"
        >
          <div
            className="pointer-events-none absolute inset-0 bg-[linear-gradient(rgba(148,163,184,0.08)_1px,transparent_1px),linear-gradient(90deg,rgba(148,163,184,0.08)_1px,transparent_1px)] bg-[length:32px_32px]"
            aria-hidden
          />
          <div className="relative p-6 sm:p-8 lg:p-10">
            <h2 id="dashboard-flow-heading" className="text-lg sm:text-xl font-bold text-slate-900">
              {t('dashboard', 'flowTitle')}
            </h2>
            <p className="mt-2 text-sm text-slate-600 max-w-3xl">{t('dashboard', 'flowSubtitle')}</p>
            <ol className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-5 list-none p-0 m-0">
              {(
                [
                  { icon: ClipboardList, titleKey: 'flowStep1Title' as const, bodyKey: 'flowStep1Body' as const },
                  { icon: Table2, titleKey: 'flowStep2Title' as const, bodyKey: 'flowStep2Body' as const },
                  { icon: Shapes, titleKey: 'flowStep3Title' as const, bodyKey: 'flowStep3Body' as const },
                  { icon: Calculator, titleKey: 'flowStep4Title' as const, bodyKey: 'flowStep4Body' as const },
                  { icon: FolderOutput, titleKey: 'flowStep5Title' as const, bodyKey: 'flowStep5Body' as const },
                ] as const
              ).map((step, i) => {
                const Icon = step.icon;
                return (
                  <li
                    key={step.titleKey}
                    className="relative flex flex-col rounded-2xl border border-slate-200/90 bg-slate-50/80 p-4 sm:p-5 min-h-[140px]"
                  >
                    <span
                      className="absolute top-3 right-3 flex h-7 w-7 items-center justify-center rounded-full bg-blue-600 text-xs font-bold text-white"
                      aria-hidden
                    >
                      {i + 1}
                    </span>
                    <Icon className="h-5 w-5 text-blue-600 mb-3 shrink-0" aria-hidden />
                    <p className="text-sm font-semibold text-slate-900 pr-8 leading-snug">{t('dashboard', step.titleKey)}</p>
                    <p className="mt-2 text-xs text-slate-600 leading-relaxed flex-1">{t('dashboard', step.bodyKey)}</p>
                  </li>
                );
              })}
            </ol>
          </div>
        </section>

        {/* ── Manual tips + C/R legend ── */}
        <div className="grid gap-6 lg:grid-cols-2 lg:items-stretch">
          <section
            className="rounded-3xl border border-slate-200 bg-white p-6 sm:p-8 shadow-sm flex flex-col"
            aria-labelledby="manual-guide-heading"
          >
            <h2 id="manual-guide-heading" className="text-base font-bold text-slate-900">
              {t('dashboard', 'manualGuideTitle')}
            </h2>
            <p className="mt-2 text-sm text-slate-600 leading-relaxed">{t('dashboard', 'manualGuideIntro')}</p>
            <ul className="mt-6 space-y-4 text-sm text-slate-700">
              <li className="flex gap-3">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-sm font-bold text-slate-800">
                  1
                </span>
                <span className="leading-snug pt-1">{t('dashboard', 'manualGuideStepWall')}</span>
              </li>
              <li className="flex gap-3">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-sm font-bold text-slate-800">
                  2
                </span>
                <span className="leading-snug pt-1">{t('dashboard', 'manualGuideStepXy')}</span>
              </li>
            </ul>
          </section>

          <section
            className="rounded-3xl border border-indigo-200/80 bg-gradient-to-br from-indigo-50/90 to-white p-6 sm:p-8 shadow-sm flex flex-col"
            aria-labelledby="corner-legend-heading"
          >
            <div className="flex items-start gap-2">
              <Info className="h-5 w-5 text-indigo-600 shrink-0 mt-0.5" aria-hidden />
              <div>
                <p className="text-[11px] font-bold uppercase tracking-wider text-indigo-700/90">
                  {t('dashboard', 'cornerLegendBadge')}
                </p>
                <h2 id="corner-legend-heading" className="mt-1 text-base font-bold text-slate-900">
                  {t('dashboard', 'manualGuideCfTitle')}
                </h2>
              </div>
            </div>
            <p className="mt-3 text-sm font-medium text-indigo-950/90 rounded-xl bg-white/80 border border-indigo-100 px-3 py-2.5">
              {t('dashboard', 'cornerLegendNoF')}
            </p>
            <div className="mt-5 grid gap-4 sm:grid-cols-2 flex-1">
              <div className="rounded-2xl border border-slate-200 bg-white p-4">
                <p className="text-xs font-bold text-emerald-800 tracking-wide">{t('dashboard', 'cornerCName')}</p>
                <p className="mt-2 text-xs text-slate-600 leading-relaxed">{t('dashboard', 'cornerCExplain')}</p>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-white p-4">
                <p className="text-xs font-bold text-violet-900 tracking-wide">{t('dashboard', 'cornerRName')}</p>
                <p className="mt-2 text-xs text-slate-600 leading-relaxed">{t('dashboard', 'cornerRExplain')}</p>
              </div>
            </div>
            <div className="mt-4 rounded-2xl border border-dashed border-slate-300 bg-slate-50/80 p-4">
              <p className="text-xs font-semibold text-slate-800">{t('dashboard', 'cornerWhenTitle')}</p>
              <p className="mt-1.5 text-xs text-slate-600 leading-relaxed">{t('dashboard', 'cornerWhenBody')}</p>
            </div>
            <p className="mt-4 text-xs text-slate-500 leading-relaxed border-t border-slate-200/80 pt-4">
              {t('dashboard', 'manualGuideCfBody')}
            </p>
          </section>
        </div>

        <div className="relative overflow-hidden rounded-3xl border border-slate-200 bg-gradient-to-br from-white to-slate-50 p-8 sm:p-10 shadow-sm">
          <div
            className="pointer-events-none absolute inset-y-0 right-0 w-1/2 bg-[radial-gradient(ellipse_at_center,rgba(59,130,246,0.06),transparent_65%)]"
            aria-hidden
          />
          <div className="relative flex flex-col sm:flex-row sm:items-end sm:justify-between gap-8">
            <div>
              <div className="inline-flex items-center gap-2 text-blue-600 mb-3">
                <Sparkles className="h-4 w-4" aria-hidden />
                <span className="text-xs font-bold uppercase tracking-widest">{t('dashboard', 'quickStartTitle')}</span>
              </div>
              <h2 className="text-2xl sm:text-3xl font-bold text-slate-900 tracking-tight">
                {t('nav', 'scaffold')}
              </h2>
              <p className="mt-3 text-slate-600 max-w-lg leading-relaxed">{t('dashboard', 'quickStartDesc')}</p>
            </div>
            <button
              type="button"
              onClick={() => router.push('/scaffold')}
              disabled={!hasBillingAccess}
              className="inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-2xl bg-blue-600 px-8 py-4 text-base font-semibold text-white shadow-md shadow-blue-600/20 transition hover:bg-blue-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 focus-visible:ring-offset-white disabled:opacity-45 disabled:cursor-not-allowed disabled:shadow-none"
            >
              <Calculator className="h-6 w-6" aria-hidden />
              {t('dashboard', 'quickStartButton')}
              <ArrowRight className="h-5 w-5 opacity-90" aria-hidden />
            </button>
          </div>
        </div>

        <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
          <button
            type="button"
            onClick={() => setHistoryOpen(!historyOpen)}
            className="w-full px-6 py-5 sm:px-8 sm:py-6 flex items-center justify-between gap-4 bg-slate-50/90 hover:bg-slate-100/90 transition-colors text-left border-b border-slate-100"
          >
            <div>
              <h2 className="text-lg font-bold text-slate-900 flex items-center gap-3">
                <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-50 border border-blue-100">
                  <History className="h-5 w-5 text-blue-600" aria-hidden />
                </span>
                <span>
                  {t('dashboard', 'historyPanelTitle')}
                  {configs && configs.length > 0 && (
                    <span className="text-slate-500 font-normal ml-2">({configs.length})</span>
                  )}
                </span>
              </h2>
              <p className="mt-1.5 text-sm text-slate-500 pl-[3.25rem]">{t('dashboard', 'shortcutJobsDesc')}</p>
            </div>
            {historyOpen ? (
              <ChevronUp className="h-5 w-5 text-slate-400 shrink-0" aria-hidden />
            ) : (
              <ChevronDown className="h-5 w-5 text-slate-400 shrink-0" aria-hidden />
            )}
          </button>

          {historyOpen && (
            <div className="border-t border-slate-100 p-6 sm:p-8 bg-slate-50/40">
              {isLoading ? (
                <div className="flex justify-center py-12">
                  <Loader2 className="h-8 w-8 animate-spin text-blue-600" aria-hidden />
                </div>
              ) : isError ? (
                <div className="text-center py-12">
                  <Calculator className="h-14 w-14 text-slate-300 mx-auto mb-4" aria-hidden />
                  <p className="text-slate-500 mb-2">{t('dashboard', 'backendDown')}</p>
                </div>
              ) : configs && configs.length > 0 ? (
                <div className="space-y-3" ref={menuRef}>
                  <div className="flex flex-wrap items-center gap-3 pb-3 border-b border-slate-200">
                    <label className="inline-flex items-center gap-2 text-sm text-slate-700 cursor-pointer select-none">
                      <input
                        ref={selectAllRef}
                        type="checkbox"
                        checked={configs.length > 0 && selectedIds.size === configs.length}
                        onChange={(e) => (e.target.checked ? selectAll() : clearSelection())}
                        disabled={bulkDeleting || deleteMutation.isPending}
                        className="rounded border-slate-300 text-blue-600 focus:ring-blue-500 focus:ring-offset-slate-50"
                      />
                      <span>{t('dashboard', 'historySelectAll')}</span>
                    </label>
                    {selectedIds.size > 0 && (
                      <>
                        <span className="text-sm text-slate-500">
                          {(t('dashboard', 'historySelected') || '{n} selected').replace('{n}', String(selectedIds.size))}
                        </span>
                        <button
                          type="button"
                          onClick={clearSelection}
                          className="text-sm text-blue-600 hover:text-blue-800 hover:underline"
                        >
                          {t('dashboard', 'historyClearSelection')}
                        </button>
                        <button
                          type="button"
                          onClick={handleBulkDelete}
                          disabled={bulkDeleting || deleteMutation.isPending}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-white bg-red-600 rounded-lg hover:bg-red-500 disabled:opacity-50"
                        >
                          {bulkDeleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                          {t('dashboard', 'historyDeleteSelected')}
                        </button>
                      </>
                    )}
                  </div>
                  {configs.map((cfg) => {
                    const enabledWalls = cfg.walls?.filter((w) => w.enabled) || [];
                    const wallNames = enabledWalls.map((w) => SIDE_LABELS[w.side] || w.side).join('・');
                    const hasResult = cfg.status === 'calculated' || cfg.status === 'reviewed';
                    const isMenuOpen = openMenuId === cfg.id;
                    const isSelected = selectedIds.has(cfg.id);
                    return (
                      <div
                        key={cfg.id}
                        className={`relative border rounded-xl transition-all bg-white ${
                          hasResult
                            ? 'border-slate-200 hover:border-blue-200 hover:shadow-md'
                            : 'border-slate-100 hover:bg-slate-50'
                        } ${isSelected ? 'ring-2 ring-blue-400 ring-offset-2 ring-offset-slate-50' : ''}`}
                      >
                        <div className="flex items-stretch">
                          <div
                            className="flex items-center pl-3 pr-1 py-4"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={() => toggleSelect(cfg.id)}
                              disabled={bulkDeleting || deleteMutation.isPending}
                              className="rounded border-slate-300 text-blue-600 focus:ring-blue-500 focus:ring-offset-white"
                              aria-label={t('dashboard', 'historySelectRow')}
                            />
                          </div>
                          <div
                            onClick={() => hasResult && router.push(`/scaffold/${cfg.id}`)}
                            className={`flex flex-1 items-center justify-between p-4 pl-2 min-w-0 ${hasResult ? 'cursor-pointer' : ''}`}
                          >
                            <div className="flex items-center gap-4 flex-1 min-w-0">
                              <div
                                className={`px-2.5 py-1 rounded-md text-xs font-semibold whitespace-nowrap ${
                                  cfg.status === 'calculated'
                                    ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                                    : cfg.status === 'reviewed'
                                      ? 'bg-sky-50 text-sky-800 border border-sky-200'
                                      : 'bg-slate-100 text-slate-600 border border-slate-200'
                                }`}
                              >
                                {cfg.status === 'calculated'
                                  ? t('dashboard', 'statusCalculated')
                                  : cfg.status === 'reviewed'
                                    ? t('dashboard', 'statusReviewed')
                                    : t('dashboard', 'statusConfigured')}
                              </div>
                              <div className="flex-1 min-w-0">
                                <div className="font-medium text-slate-800 truncate">
                                  {t('dashboard', 'buildingHeight')}: {formatMmAsMetersLabel(cfg.buildingHeightMm)} |{' '}
                                  {t('dashboard', 'scaffoldWidth')}: {formatMmAsMetersLabel(cfg.scaffoldWidthMm)}
                                </div>
                                <div className="text-sm text-slate-500 truncate">
                                  {wallNames || '—'} |{' '}
                                  {new Date(cfg.createdAt).toLocaleDateString(
                                    locale === 'ja' ? 'ja-JP' : locale === 'fr' ? 'fr-FR' : 'en-US',
                                  )}
                                </div>
                              </div>
                            </div>
                            <div className="flex items-center gap-2 ml-3 flex-shrink-0" onClick={(e) => e.stopPropagation()}>
                              {hasResult && (
                                <button
                                  type="button"
                                  onClick={() => router.push(`/scaffold/${cfg.id}`)}
                                  className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white text-sm font-semibold rounded-lg hover:bg-blue-700 transition-colors"
                                >
                                  <Eye className="h-3.5 w-3.5" aria-hidden />
                                  {t('dashboard', 'viewResult')}
                                </button>
                              )}
                              <div className="relative">
                                <button
                                  type="button"
                                  onClick={() => setOpenMenuId(isMenuOpen ? null : cfg.id)}
                                  className="flex items-center justify-center w-8 h-8 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 transition-colors text-slate-500"
                                >
                                  <MoreHorizontal className="h-4 w-4" />
                                </button>
                                {isMenuOpen && (
                                  <div className="absolute right-0 top-full mt-1 w-52 bg-white rounded-xl shadow-lg border border-slate-200 py-1 z-50">
                                    {hasResult && (
                                      <>
                                        <button
                                          type="button"
                                          onClick={() => {
                                            setOpenMenuId(null);
                                            router.push(`/scaffold/${cfg.id}`);
                                          }}
                                          className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-slate-700 hover:bg-slate-50"
                                        >
                                          <ExternalLink className="h-4 w-4 text-blue-500" aria-hidden />
                                          {t('dashboard', 'openResult')}
                                        </button>
                                        <button
                                          type="button"
                                          onClick={() => {
                                            setOpenMenuId(null);
                                            router.push(`/scaffold/${cfg.id}?tab=3d`);
                                          }}
                                          className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-slate-700 hover:bg-slate-50"
                                        >
                                          <Box className="h-4 w-4 text-violet-500" aria-hidden />
                                          {t('dashboard', 'view3D')}
                                        </button>
                                        <button
                                          type="button"
                                          onClick={() => {
                                            setOpenMenuId(null);
                                            router.push(`/scaffold/${cfg.id}?tab=2d`);
                                          }}
                                          className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-slate-700 hover:bg-slate-50"
                                        >
                                          <Layers className="h-4 w-4 text-indigo-500" aria-hidden />
                                          {t('dashboard', 'view2D')}
                                        </button>
                                        <div className="border-t border-slate-100 my-1" />
                                        <button
                                          type="button"
                                          onClick={() => {
                                            setOpenMenuId(null);
                                            router.push(
                                              `/scaffold/${cfg.id}/quote?step=1&projectId=${encodeURIComponent(cfg.projectId)}`,
                                            );
                                          }}
                                          className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-slate-700 hover:bg-slate-50"
                                        >
                                          <Receipt className="h-4 w-4 text-emerald-600" aria-hidden />
                                          {t('dashboard', 'createQuotation')}
                                        </button>
                                        <button
                                          type="button"
                                          onClick={async () => {
                                            setOpenMenuId(null);
                                            try {
                                              const blob = await scaffoldConfigsApi.exportExcel(cfg.id, locale);
                                              const url = URL.createObjectURL(blob);
                                              const a = document.createElement('a');
                                              a.href = url;
                                              a.download = `scaffold_${cfg.id.slice(0, 8)}.xlsx`;
                                              a.click();
                                              URL.revokeObjectURL(url);
                                            } catch {
                                              alert(t('result', 'excelFailed') || 'Excel export failed');
                                            }
                                          }}
                                          className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-slate-700 hover:bg-slate-50"
                                        >
                                          <FileSpreadsheet className="h-4 w-4 text-green-600" aria-hidden />
                                          {t('dashboard', 'exportExcel')}
                                        </button>
                                      </>
                                    )}
                                    <div className="border-t border-slate-100 my-1" />
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setOpenMenuId(null);
                                        router.push('/scaffold');
                                      }}
                                      className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-slate-700 hover:bg-slate-50"
                                    >
                                      <Copy className="h-4 w-4 text-slate-400" aria-hidden />
                                      {t('dashboard', 'newCalculation')}
                                    </button>
                                    <div className="border-t border-slate-100 my-1" />
                                    <button
                                      type="button"
                                      onClick={(e) => {
                                        setOpenMenuId(null);
                                        handleDelete(cfg.id, e);
                                      }}
                                      disabled={deleteMutation.isPending}
                                      className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-red-600 hover:bg-red-50"
                                    >
                                      <Trash2 className="h-4 w-4" aria-hidden />
                                      {t('dashboard', 'delete')}
                                    </button>
                                  </div>
                                )}
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="text-center py-12">
                  <Calculator className="h-14 w-14 text-slate-300 mx-auto mb-4" aria-hidden />
                  <p className="text-slate-500 mb-3">{t('dashboard', 'noResults')}</p>
                  <button
                    type="button"
                    onClick={() => router.push('/scaffold')}
                    className="text-blue-600 font-semibold hover:text-blue-800 hover:underline inline-flex items-center gap-1.5"
                  >
                    {t('dashboard', 'firstCalc')} <ArrowRight className="h-4 w-4" aria-hidden />
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
