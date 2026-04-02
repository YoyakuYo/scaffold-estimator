'use client';

import { useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { scaffoldConfigsApi, ScaffoldConfiguration } from '@/lib/api/scaffold-configs';
import { usersApi, UserProfile } from '@/lib/api/users';
import { messagesApi, ConversationWithUser } from '@/lib/api/messages';
import { subscriptionsApi } from '@/lib/api/subscriptions';
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
  CreditCard,
  HardHat,
  Sparkles,
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

  const approveMutation = useMutation({
    mutationFn: usersApi.approveUser,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] });
      queryClient.invalidateQueries({ queryKey: ['platform-stats'] });
    },
  });
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
                    <div key={u.id} className="px-5 py-3 flex items-center justify-between">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-slate-900 truncate">
                          {[u.lastName, u.firstName].filter(Boolean).join(' ') || u.email}
                        </p>
                        <p className="text-xs text-slate-500">{u.email}</p>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <button
                          onClick={() => approveMutation.mutate(u.id)}
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

  const { data: subscription } = useQuery({
    queryKey: ['my-subscription'],
    queryFn: subscriptionsApi.getMine,
    retry: false,
    refetchInterval: 30000,
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

  const workflowSteps = [
    { n: 1, title: t('dashboard', 'quickStep1Title'), hint: t('dashboard', 'quickStep1Desc') },
    { n: 2, title: t('dashboard', 'quickStep2Title'), hint: t('dashboard', 'quickStep2Desc') },
    { n: 3, title: t('dashboard', 'quickStep3Title'), hint: t('dashboard', 'quickStep3Desc') },
  ];

  const subStatus = subscription?.status ?? '';
  const subAlert =
    !hasBillingAccess ||
    subStatus === 'past_due' ||
    subStatus === 'canceled' ||
    subStatus === 'expired';

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <div
        className="h-1.5 w-full bg-[repeating-linear-gradient(-45deg,#09090b,#09090b_8px,#f59e0b_8px,#f59e0b_16px)]"
        aria-hidden
      />

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 lg:py-10 space-y-8">
        {/* Hero — blueprint grid + site lighting */}
        <section className="relative overflow-hidden rounded-3xl border border-zinc-700/70 bg-zinc-900 shadow-2xl shadow-black/50">
          <div
            className="pointer-events-none absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.035)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.035)_1px,transparent_1px)] bg-[length:32px_32px]"
            aria-hidden
          />
          <div
            className="pointer-events-none absolute -right-20 -top-28 h-72 w-72 rounded-full bg-amber-500/[0.12] blur-3xl"
            aria-hidden
          />
          <div className="relative p-8 lg:p-10 lg:flex lg:items-start lg:justify-between lg:gap-12">
            <div className="max-w-xl">
              <span className="inline-flex items-center gap-2 rounded-full border border-amber-500/45 bg-amber-500/10 px-3.5 py-1.5 text-[11px] font-bold uppercase tracking-[0.2em] text-amber-200">
                <HardHat className="h-4 w-4 shrink-0 text-amber-400" aria-hidden />
                {t('dashboard', 'siteHubBadge')}
              </span>
              <h1 className="mt-5 text-3xl sm:text-4xl font-extrabold tracking-tight text-white leading-tight">
                {t('dashboard', 'title')}
              </h1>
              <p className="mt-4 text-base text-zinc-400 leading-relaxed">
                {t('dashboard', 'dashboardIntro')}
              </p>
              <div className="mt-6 flex flex-wrap gap-2">
                <span className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-600/80 bg-zinc-800/80 px-3 py-1.5 text-xs font-medium text-zinc-300">
                  <Box className="h-3.5 w-3.5 text-violet-400" aria-hidden />
                  2D / 3D
                </span>
                <span className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-600/80 bg-zinc-800/80 px-3 py-1.5 text-xs font-medium text-zinc-300">
                  <Receipt className="h-3.5 w-3.5 text-emerald-400" aria-hidden />
                  {t('nav', 'quotations')}
                </span>
                <span className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-600/80 bg-zinc-800/80 px-3 py-1.5 text-xs font-medium text-zinc-300">
                  <FileSpreadsheet className="h-3.5 w-3.5 text-sky-400" aria-hidden />
                  Excel
                </span>
              </div>
            </div>

            <div className="mt-10 w-full lg:mt-0 lg:max-w-md shrink-0">
              <p className="text-[11px] font-bold uppercase tracking-[0.25em] text-zinc-500 mb-4">
                {t('dashboard', 'workflow')}
              </p>
              <ol className="space-y-4">
                {workflowSteps.map((step) => (
                  <li key={step.n} className="flex gap-4">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-amber-500 text-sm font-black text-zinc-950 shadow-lg shadow-amber-500/25">
                      {step.n}
                    </span>
                    <div className="min-w-0 pt-0.5 flex-1 border-l border-zinc-700/80 pl-4">
                      <p className="text-sm font-semibold text-zinc-100 leading-snug">{step.title}</p>
                      <p className="mt-1 text-xs text-zinc-500 leading-relaxed line-clamp-2">{step.hint}</p>
                    </div>
                  </li>
                ))}
              </ol>
            </div>
          </div>
        </section>

        {subscription && (
          <div
            className={`rounded-2xl border p-5 sm:p-6 backdrop-blur-sm ${
              subAlert
                ? 'border-red-500/40 bg-red-950/40'
                : 'border-emerald-500/35 bg-emerald-950/30'
            }`}
          >
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
              <div className="flex items-start gap-4">
                <div
                  className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border ${
                    subAlert ? 'border-red-400/40 bg-red-500/10' : 'border-emerald-400/40 bg-emerald-500/10'
                  }`}
                >
                  <CreditCard
                    className={`h-6 w-6 ${subAlert ? 'text-red-300' : 'text-emerald-300'}`}
                    aria-hidden
                  />
                </div>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
                    {t('dashboard', 'subscription')}
                  </p>
                  <p className="mt-1 font-mono text-sm font-semibold text-white">
                    {subscription.plan} <span className="text-zinc-500">/</span> {subscription.status}
                  </p>
                  {subscription.status === 'trialing' && subscription.trialDaysRemaining != null && (
                    <p className="mt-2 text-sm text-amber-300/90">
                      {t('dashboard', 'trialRemaining').replace('{days}', String(subscription.trialDaysRemaining))}
                    </p>
                  )}
                </div>
              </div>
              <button
                type="button"
                onClick={() => router.push('/billing')}
                className="inline-flex items-center justify-center gap-2 rounded-xl border border-zinc-600 bg-zinc-900 px-5 py-2.5 text-sm font-semibold text-zinc-100 shadow-sm transition hover:border-amber-500/50 hover:bg-zinc-800"
              >
                <CreditCard className="h-4 w-4 text-amber-400" />
                {t('dashboard', 'manageBilling')}
              </button>
            </div>
            {!hasBillingAccess && (
              <p className="mt-4 text-sm text-red-300 border-t border-red-500/20 pt-4">
                {t('dashboard', 'trialEnded')}
              </p>
            )}
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 lg:gap-8">
          {/* Primary CTA */}
          <div className="lg:col-span-2 relative overflow-hidden rounded-3xl border border-amber-500/25 bg-gradient-to-br from-zinc-800 via-zinc-900 to-zinc-950 p-8 sm:p-10 shadow-xl shadow-amber-950/20 ring-1 ring-amber-500/10">
            <div
              className="pointer-events-none absolute inset-y-0 right-0 w-1/2 bg-[radial-gradient(ellipse_at_center,rgba(245,158,11,0.08),transparent_70%)]"
              aria-hidden
            />
            <div className="relative flex flex-col sm:flex-row sm:items-end sm:justify-between gap-8">
              <div>
                <div className="inline-flex items-center gap-2 text-amber-400/90 mb-3">
                  <Sparkles className="h-4 w-4" aria-hidden />
                  <span className="text-xs font-bold uppercase tracking-widest">{t('dashboard', 'quickStartTitle')}</span>
                </div>
                <h2 className="text-2xl sm:text-3xl font-bold text-white tracking-tight">
                  {t('nav', 'scaffold')}
                </h2>
                <p className="mt-3 text-zinc-400 max-w-lg leading-relaxed">{t('dashboard', 'quickStartDesc')}</p>
              </div>
              <button
                type="button"
                onClick={() => router.push('/scaffold')}
                disabled={!hasBillingAccess}
                className="inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-2xl bg-amber-500 px-8 py-4 text-base font-bold text-zinc-950 shadow-lg shadow-amber-500/30 transition hover:bg-amber-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-300 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-900 disabled:opacity-45 disabled:cursor-not-allowed disabled:shadow-none"
              >
                <Calculator className="h-6 w-6" aria-hidden />
                {t('dashboard', 'quickStartButton')}
                <ArrowRight className="h-5 w-5 opacity-80" aria-hidden />
              </button>
            </div>
          </div>

          {/* Quick access tiles */}
          <div className="space-y-3">
            <p className="text-[11px] font-bold uppercase tracking-[0.25em] text-zinc-500 px-1">
              {t('dashboard', 'quickAccess')}
            </p>
            <Link
              href="/quotations"
              className="group flex items-center gap-4 rounded-2xl border border-zinc-700/80 bg-zinc-900/90 p-4 transition hover:border-amber-500/40 hover:bg-zinc-800/90"
            >
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-emerald-500/15 text-emerald-400 ring-1 ring-emerald-500/25">
                <Receipt className="h-5 w-5" aria-hidden />
              </div>
              <div className="min-w-0 flex-1">
                <p className="font-semibold text-white group-hover:text-amber-100 transition-colors">
                  {t('nav', 'quotations')}
                </p>
                <p className="text-xs text-zinc-500 mt-0.5 line-clamp-2">{t('dashboard', 'shortcutQuotationsDesc')}</p>
              </div>
              <ArrowRight className="h-4 w-4 text-zinc-600 group-hover:text-amber-400 shrink-0 transition-colors" />
            </Link>
            <Link
              href="/scaffold"
              className="group flex items-center gap-4 rounded-2xl border border-zinc-700/80 bg-zinc-900/90 p-4 transition hover:border-amber-500/40 hover:bg-zinc-800/90"
            >
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-sky-500/15 text-sky-400 ring-1 ring-sky-500/25">
                <Calculator className="h-5 w-5" aria-hidden />
              </div>
              <div className="min-w-0 flex-1">
                <p className="font-semibold text-white group-hover:text-amber-100 transition-colors">
                  {t('nav', 'scaffold')}
                </p>
                <p className="text-xs text-zinc-500 mt-0.5 line-clamp-2">{t('dashboard', 'quickStartDesc')}</p>
              </div>
              <ArrowRight className="h-4 w-4 text-zinc-600 group-hover:text-amber-400 shrink-0 transition-colors" />
            </Link>
            <button
              type="button"
              onClick={() => router.push('/billing')}
              className="group flex w-full items-center gap-4 rounded-2xl border border-zinc-700/80 bg-zinc-900/90 p-4 text-left transition hover:border-amber-500/40 hover:bg-zinc-800/90"
            >
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-amber-500/15 text-amber-400 ring-1 ring-amber-500/25">
                <CreditCard className="h-5 w-5" aria-hidden />
              </div>
              <div className="min-w-0 flex-1">
                <p className="font-semibold text-white group-hover:text-amber-100 transition-colors">
                  {t('dashboard', 'manageBilling')}
                </p>
                <p className="text-xs text-zinc-500 mt-0.5 line-clamp-2">{t('dashboard', 'shortcutBillingDesc')}</p>
              </div>
              <ArrowRight className="h-4 w-4 text-zinc-600 group-hover:text-amber-400 shrink-0 transition-colors" />
            </button>
          </div>
        </div>

        {/* History */}
        <div className="overflow-hidden rounded-3xl border border-zinc-700/80 bg-zinc-900/60 shadow-xl shadow-black/30">
          <button
            type="button"
            onClick={() => setHistoryOpen(!historyOpen)}
            className="w-full px-6 py-5 sm:px-8 sm:py-6 flex items-center justify-between gap-4 bg-[repeating-linear-gradient(90deg,transparent,transparent_12px,rgba(245,158,11,0.07)_12px,rgba(245,158,11,0.07)_24px)] hover:bg-zinc-800/80 transition-colors text-left border-b border-zinc-700/60"
          >
            <div>
              <h2 className="text-lg font-bold text-white flex items-center gap-3">
                <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-zinc-800 border border-zinc-600">
                  <History className="h-5 w-5 text-amber-400" aria-hidden />
                </span>
                <span>
                  {t('dashboard', 'historyPanelTitle')}
                  {configs && configs.length > 0 && (
                    <span className="text-zinc-500 font-normal ml-2">({configs.length})</span>
                  )}
                </span>
              </h2>
              <p className="mt-1.5 text-sm text-zinc-500 pl-[3.25rem]">{t('dashboard', 'shortcutJobsDesc')}</p>
            </div>
            {historyOpen ? (
              <ChevronUp className="h-5 w-5 text-zinc-500 shrink-0" aria-hidden />
            ) : (
              <ChevronDown className="h-5 w-5 text-zinc-500 shrink-0" aria-hidden />
            )}
          </button>

          {historyOpen && (
            <div className="border-t border-zinc-700/60 p-6 sm:p-8 bg-zinc-950/40">
              {isLoading ? (
                <div className="flex justify-center py-12">
                  <Loader2 className="h-8 w-8 animate-spin text-amber-500" aria-hidden />
                </div>
              ) : isError ? (
                <div className="text-center py-12">
                  <Calculator className="h-14 w-14 text-zinc-700 mx-auto mb-4" aria-hidden />
                  <p className="text-zinc-500 mb-2">{t('dashboard', 'backendDown')}</p>
                </div>
              ) : configs && configs.length > 0 ? (
                <div className="space-y-3" ref={menuRef}>
                  <div className="flex flex-wrap items-center gap-3 pb-3 border-b border-zinc-800">
                    <label className="inline-flex items-center gap-2 text-sm text-zinc-300 cursor-pointer select-none">
                      <input
                        ref={selectAllRef}
                        type="checkbox"
                        checked={configs.length > 0 && selectedIds.size === configs.length}
                        onChange={(e) => (e.target.checked ? selectAll() : clearSelection())}
                        disabled={bulkDeleting || deleteMutation.isPending}
                        className="rounded border-zinc-600 bg-zinc-800 text-amber-500 focus:ring-amber-500 focus:ring-offset-zinc-950"
                      />
                      <span>{t('dashboard', 'historySelectAll')}</span>
                    </label>
                    {selectedIds.size > 0 && (
                      <>
                        <span className="text-sm text-zinc-500">
                          {(t('dashboard', 'historySelected') || '{n} selected').replace('{n}', String(selectedIds.size))}
                        </span>
                        <button
                          type="button"
                          onClick={clearSelection}
                          className="text-sm text-amber-400 hover:text-amber-300 hover:underline"
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
                        className={`relative border rounded-xl transition-all ${
                          hasResult
                            ? 'border-zinc-700 hover:border-amber-500/35 hover:shadow-lg hover:shadow-black/20 bg-zinc-900/50'
                            : 'border-zinc-800 hover:bg-zinc-900/80'
                        } ${isSelected ? 'ring-2 ring-amber-500/60 ring-offset-2 ring-offset-zinc-950' : ''}`}
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
                              className="rounded border-zinc-600 bg-zinc-800 text-amber-500 focus:ring-amber-500 focus:ring-offset-zinc-950"
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
                                    ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/25'
                                    : cfg.status === 'reviewed'
                                      ? 'bg-sky-500/15 text-sky-300 border border-sky-500/25'
                                      : 'bg-zinc-700/80 text-zinc-400 border border-zinc-600'
                                }`}
                              >
                                {cfg.status === 'calculated'
                                  ? t('dashboard', 'statusCalculated')
                                  : cfg.status === 'reviewed'
                                    ? t('dashboard', 'statusReviewed')
                                    : t('dashboard', 'statusConfigured')}
                              </div>
                              <div className="flex-1 min-w-0">
                                <div className="font-medium text-zinc-100 truncate">
                                  {t('dashboard', 'buildingHeight')}: {cfg.buildingHeightMm.toLocaleString()}mm |{' '}
                                  {t('dashboard', 'scaffoldWidth')}: {cfg.scaffoldWidthMm}mm
                                </div>
                                <div className="text-sm text-zinc-500 truncate">
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
                                  className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-500 text-zinc-950 text-sm font-semibold rounded-lg hover:bg-amber-400 transition-colors"
                                >
                                  <Eye className="h-3.5 w-3.5" aria-hidden />
                                  {t('dashboard', 'viewResult')}
                                </button>
                              )}
                              <div className="relative">
                                <button
                                  type="button"
                                  onClick={() => setOpenMenuId(isMenuOpen ? null : cfg.id)}
                                  className="flex items-center justify-center w-8 h-8 rounded-lg border border-zinc-600 bg-zinc-800 hover:bg-zinc-700 transition-colors text-zinc-400"
                                >
                                  <MoreHorizontal className="h-4 w-4" />
                                </button>
                                {isMenuOpen && (
                                  <div className="absolute right-0 top-full mt-1 w-52 bg-zinc-900 rounded-xl shadow-xl border border-zinc-600 py-1 z-50">
                                    {hasResult && (
                                      <>
                                        <button
                                          type="button"
                                          onClick={() => {
                                            setOpenMenuId(null);
                                            router.push(`/scaffold/${cfg.id}`);
                                          }}
                                          className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-zinc-200 hover:bg-zinc-800"
                                        >
                                          <ExternalLink className="h-4 w-4 text-sky-400" aria-hidden />
                                          {t('dashboard', 'openResult')}
                                        </button>
                                        <button
                                          type="button"
                                          onClick={() => {
                                            setOpenMenuId(null);
                                            router.push(`/scaffold/${cfg.id}?tab=3d`);
                                          }}
                                          className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-zinc-200 hover:bg-zinc-800"
                                        >
                                          <Box className="h-4 w-4 text-violet-400" aria-hidden />
                                          {t('dashboard', 'view3D')}
                                        </button>
                                        <button
                                          type="button"
                                          onClick={() => {
                                            setOpenMenuId(null);
                                            router.push(`/scaffold/${cfg.id}?tab=2d`);
                                          }}
                                          className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-zinc-200 hover:bg-zinc-800"
                                        >
                                          <Layers className="h-4 w-4 text-indigo-400" aria-hidden />
                                          {t('dashboard', 'view2D')}
                                        </button>
                                        <div className="border-t border-zinc-700 my-1" />
                                        <button
                                          type="button"
                                          onClick={() => {
                                            setOpenMenuId(null);
                                            router.push(
                                              `/scaffold/${cfg.id}/quote?step=1&projectId=${encodeURIComponent(cfg.projectId)}`,
                                            );
                                          }}
                                          className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-zinc-200 hover:bg-zinc-800"
                                        >
                                          <Receipt className="h-4 w-4 text-emerald-400" aria-hidden />
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
                                          className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-zinc-200 hover:bg-zinc-800"
                                        >
                                          <FileSpreadsheet className="h-4 w-4 text-green-400" aria-hidden />
                                          {t('dashboard', 'exportExcel')}
                                        </button>
                                      </>
                                    )}
                                    <div className="border-t border-zinc-700 my-1" />
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setOpenMenuId(null);
                                        router.push('/scaffold');
                                      }}
                                      className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-zinc-200 hover:bg-zinc-800"
                                    >
                                      <Copy className="h-4 w-4 text-zinc-500" aria-hidden />
                                      {t('dashboard', 'newCalculation')}
                                    </button>
                                    <div className="border-t border-zinc-700 my-1" />
                                    <button
                                      type="button"
                                      onClick={(e) => {
                                        setOpenMenuId(null);
                                        handleDelete(cfg.id, e);
                                      }}
                                      disabled={deleteMutation.isPending}
                                      className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-red-400 hover:bg-red-950/50"
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
                  <Calculator className="h-14 w-14 text-zinc-700 mx-auto mb-4" aria-hidden />
                  <p className="text-zinc-500 mb-3">{t('dashboard', 'noResults')}</p>
                  <button
                    type="button"
                    onClick={() => router.push('/scaffold')}
                    className="text-amber-400 font-semibold hover:text-amber-300 hover:underline inline-flex items-center gap-1.5"
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
