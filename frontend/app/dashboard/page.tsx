'use client';

import { useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { scaffoldConfigsApi, ScaffoldConfiguration } from '@/lib/api/scaffold-configs';
import { usersApi, UserProfile } from '@/lib/api/users';
import { messagesApi, ConversationWithUser } from '@/lib/api/messages';
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
  UserCheck,
  UserX,
  AlertTriangle,
  Settings,
  BarChart3,
  Send,
  CheckCircle,
  XCircle,
  Zap,
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
  const isAdmin = currentUser?.role === 'admin';

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
  const { locale } = useI18n();
  const queryClient = useQueryClient();
  const t = (en: string, ja: string) => (locale === 'ja' ? ja : en);

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
  const recentUsers = allUsers
    ?.filter((u) => u.approvalStatus === 'approved')
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 5) ?? [];
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
    if (h < 12) return t(`Good morning, ${name}`, `おはようございます、${name}さん`);
    if (h < 18) return t(`Good afternoon, ${name}`, `こんにちは、${name}さん`);
    return t(`Good evening, ${name}`, `こんばんは、${name}さん`);
  };

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        {/* ── Header ── */}
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-slate-900">{greeting()}</h1>
          <p className="text-sm text-slate-500 mt-1">
            {t('Platform Administration Dashboard', 'プラットフォーム管理ダッシュボード')}
          </p>
        </div>

        {/* ── KPI Cards ── */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          <KpiCard
            icon={<Users className="h-5 w-5" />}
            label={t('Total Users', '総ユーザー数')}
            value={stats?.totalUsers ?? '—'}
            color="blue"
            loading={statsLoading}
          />
          <KpiCard
            icon={<Building2 className="h-5 w-5" />}
            label={t('Companies', '企業数')}
            value={stats?.totalCompanies ?? '—'}
            color="purple"
            loading={statsLoading}
          />
          <KpiCard
            icon={<Activity className="h-5 w-5" />}
            label={t('Online Now', 'オンライン')}
            value={stats?.onlineCount ?? '—'}
            color="green"
            loading={statsLoading}
            pulse={!!stats && stats.onlineCount > 0}
          />
          <KpiCard
            icon={<Calculator className="h-5 w-5" />}
            label={t('Total Calculations', '総計算数')}
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
                      {t('Pending Approvals', '承認待ち')} ({pendingUsers.length})
                    </h2>
                  </div>
                  <Link href="/users?filter=pending" className="text-sm text-amber-700 hover:underline">
                    {t('View all', 'すべて見る')} →
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
                          {t('Approve', '承認')}
                        </button>
                        <button
                          onClick={() => rejectMutation.mutate(u.id)}
                          disabled={rejectMutation.isPending}
                          className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium bg-white border border-red-300 text-red-600 rounded-lg hover:bg-red-50 transition-colors"
                        >
                          <XCircle className="h-3.5 w-3.5" />
                          {t('Reject', '拒否')}
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
                    {t('Support Messages', 'サポートメッセージ')}
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
                  {t('Open Inbox', '受信箱を開く')} →
                </Link>
              </div>
              <div className="divide-y divide-gray-100">
                {!conversations ? (
                  <div className="p-6 flex justify-center"><Loader2 className="h-5 w-5 animate-spin text-gray-400" /></div>
                ) : conversations.length === 0 ? (
                  <p className="p-6 text-sm text-gray-400 text-center">
                    {t('No conversations yet', 'まだ会話はありません')}
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
                            {new Date(c.updatedAt).toLocaleDateString(locale === 'ja' ? 'ja-JP' : 'en-US', { month: 'short', day: 'numeric' })}
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

            {/* Recent Calculations */}
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
              <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <BarChart3 className="h-5 w-5 text-indigo-600" />
                  <h2 className="font-semibold text-slate-900">
                    {t('Recent Calculations', '最近の計算')}
                  </h2>
                </div>
                <Link href="/scaffold" className="text-sm text-blue-600 hover:underline">
                  {t('New Calculation', '新規計算')} →
                </Link>
              </div>
              <div className="divide-y divide-gray-100">
                {!configs ? (
                  <div className="p-6 flex justify-center"><Loader2 className="h-5 w-5 animate-spin text-gray-400" /></div>
                ) : configs.length === 0 ? (
                  <p className="p-6 text-sm text-gray-400 text-center">{t('No calculations yet', 'まだ計算はありません')}</p>
                ) : (
                  configs.slice(0, 5).map((cfg) => {
                    const enabledWalls = cfg.walls?.filter((w) => w.enabled) || [];
                    return (
                      <button
                        key={cfg.id}
                        onClick={() => router.push(`/scaffold/${cfg.id}`)}
                        className="w-full px-5 py-3 flex items-center justify-between hover:bg-slate-50 transition-colors text-left"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className={`px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider ${
                              cfg.scaffoldType === 'kusabi' ? 'bg-blue-100 text-blue-700' : 'bg-purple-100 text-purple-700'
                            }`}>
                              {cfg.scaffoldType}
                            </span>
                            <span className="text-sm font-medium text-slate-900">
                              {cfg.buildingHeightMm.toLocaleString()}mm / {cfg.scaffoldWidthMm}mm
                            </span>
                          </div>
                          <p className="text-xs text-slate-500 mt-0.5">
                            {enabledWalls.length} {t('walls', '面')} · {new Date(cfg.createdAt).toLocaleDateString(locale === 'ja' ? 'ja-JP' : 'en-US')}
                          </p>
                        </div>
                        <div className={`px-2 py-0.5 rounded text-xs font-medium ${
                          cfg.status === 'reviewed' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'
                        }`}>
                          {cfg.status}
                        </div>
                      </button>
                    );
                  })
                )}
              </div>
            </div>
          </div>

          {/* ── Right Column (1/3) ── */}
          <div className="space-y-6">
            {/* Quick Actions */}
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
              <div className="px-5 py-4 border-b border-gray-100">
                <h2 className="font-semibold text-slate-900 flex items-center gap-2">
                  <Zap className="h-5 w-5 text-amber-500" />
                  {t('Quick Actions', 'クイックアクション')}
                </h2>
              </div>
              <div className="p-3 space-y-1">
                {[
                  { href: '/scaffold', icon: Calculator, label: t('New Calculation', '新規計算'), color: 'text-blue-600' },
                  { href: '/users', icon: Users, label: t('Manage Users', 'ユーザー管理'), color: 'text-purple-600' },
                  { href: '/admin/messages', icon: MessageSquare, label: t('Messages', 'メッセージ'), color: 'text-green-600', badge: totalUnread },
                  { href: '/company', icon: Building2, label: t('Company Settings', '会社設定'), color: 'text-indigo-600' },
                  { href: '/quotations', icon: Receipt, label: t('Quotations', '見積書'), color: 'text-amber-600' },
                  { href: '/ai', icon: ShieldCheck, label: t('AI Assistant', 'AIアシスタント'), color: 'text-rose-600' },
                  { href: '/settings', icon: Settings, label: t('Price Settings', '単価設定'), color: 'text-slate-600' },
                  { href: '/profile', icon: User, label: t('My Profile', 'プロフィール'), color: 'text-cyan-600' },
                ].map((item) => (
                  <button
                    key={item.href}
                    onClick={() => router.push(item.href)}
                    className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-slate-50 transition-colors text-left group"
                  >
                    <item.icon className={`h-4 w-4 ${item.color}`} />
                    <span className="text-sm text-slate-700 group-hover:text-slate-900 flex-1">{item.label}</span>
                    {item.badge ? (
                      <span className="h-5 min-w-[20px] px-1.5 rounded-full bg-red-500 text-white text-xs flex items-center justify-center">
                        {item.badge}
                      </span>
                    ) : (
                      <ArrowRight className="h-3.5 w-3.5 text-slate-300 group-hover:text-slate-500" />
                    )}
                  </button>
                ))}
              </div>
            </div>

            {/* Online Users */}
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
              <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
                <h2 className="font-semibold text-slate-900 flex items-center gap-2">
                  <Activity className="h-5 w-5 text-green-500" />
                  {t('Online Now', 'オンライン中')}
                </h2>
                <span className="text-xs text-slate-400">{t('Live', 'リアルタイム')}</span>
              </div>
              <div className="p-3">
                {!onlineUsers ? (
                  <div className="p-4 flex justify-center"><Loader2 className="h-5 w-5 animate-spin text-gray-400" /></div>
                ) : onlineUsers.length === 0 ? (
                  <p className="p-3 text-sm text-gray-400 text-center">{t('No one online', '誰もオンラインではありません')}</p>
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
                          u.role === 'admin' ? 'bg-red-100 text-red-700' :
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

            {/* Recent Users */}
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
              <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
                <h2 className="font-semibold text-slate-900 flex items-center gap-2">
                  <UserCheck className="h-5 w-5 text-blue-500" />
                  {t('Recent Users', '最近のユーザー')}
                </h2>
                <Link href="/users" className="text-sm text-blue-600 hover:underline">
                  {t('All', 'すべて')} →
                </Link>
              </div>
              <div className="divide-y divide-gray-100">
                {recentUsers.map((u) => (
                  <div key={u.id} className="px-5 py-2.5 flex items-center gap-2.5">
                    <span className="flex items-center justify-center h-7 w-7 rounded-full bg-slate-100 text-xs font-bold text-slate-600 flex-shrink-0">
                      {(u.firstName?.[0] || u.email[0]).toUpperCase()}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm text-slate-800 truncate">
                        {[u.lastName, u.firstName].filter(Boolean).join(' ') || u.email}
                      </p>
                      <p className="text-[10px] text-slate-400">
                        {new Date(u.createdAt).toLocaleDateString(locale === 'ja' ? 'ja-JP' : 'en-US')}
                      </p>
                    </div>
                  </div>
                ))}
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
  const menuRef = useRef<HTMLDivElement>(null);

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

  const handleDelete = async (configId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (window.confirm(t('dashboard', 'confirmDelete') || 'Delete this calculation?')) {
      try { await deleteMutation.mutateAsync(configId); } catch { /* handled */ }
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <p className="text-gray-600 mb-6">{t('dashboard', 'dashboardIntro')}</p>

        {/* Quick Start */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-8 mb-8">
          <div className="flex items-center justify-between flex-wrap gap-4">
            <div>
              <h2 className="text-2xl font-bold text-gray-900 mb-2">{t('dashboard', 'quickStartTitle')}</h2>
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

        {/* History */}
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
            {historyOpen ? <ChevronUp className="h-5 w-5 text-gray-400" /> : <ChevronDown className="h-5 w-5 text-gray-400" />}
          </button>

          {historyOpen && (
            <div className="border-t border-gray-200 p-6">
              {isLoading ? (
                <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-blue-500" /></div>
              ) : isError ? (
                <div className="text-center py-8">
                  <Calculator className="h-12 w-12 text-gray-300 mx-auto mb-3" />
                  <p className="text-gray-400 mb-2">{t('dashboard', 'backendDown')}</p>
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
                        className={`relative border rounded-lg transition-all ${hasResult ? 'border-gray-200 hover:border-blue-300 hover:shadow-md cursor-pointer' : 'border-gray-100 hover:bg-gray-50'}`}
                      >
                        <div onClick={() => hasResult && router.push(`/scaffold/${cfg.id}`)} className="flex items-center justify-between p-4">
                          <div className="flex items-center gap-4 flex-1 min-w-0">
                            <div className={`px-2.5 py-1 rounded-md text-xs font-semibold whitespace-nowrap ${cfg.status === 'calculated' ? 'bg-green-100 text-green-700' : cfg.status === 'reviewed' ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-600'}`}>
                              {cfg.status === 'calculated' ? t('dashboard', 'statusCalculated') : cfg.status === 'reviewed' ? t('dashboard', 'statusReviewed') : t('dashboard', 'statusConfigured')}
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="font-medium text-gray-800 truncate">
                                {t('dashboard', 'buildingHeight')}: {cfg.buildingHeightMm.toLocaleString()}mm | {t('dashboard', 'scaffoldWidth')}: {cfg.scaffoldWidthMm}mm
                              </div>
                              <div className="text-sm text-gray-500 truncate">
                                {wallNames || '—'} | {new Date(cfg.createdAt).toLocaleDateString(locale === 'ja' ? 'ja-JP' : 'en-US')}
                              </div>
                            </div>
                          </div>
                          <div className="flex items-center gap-2 ml-3 flex-shrink-0" onClick={(e) => e.stopPropagation()}>
                            {hasResult && (
                              <button onClick={() => router.push(`/scaffold/${cfg.id}`)} className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white text-sm rounded-md hover:bg-blue-700 transition-colors">
                                <Eye className="h-3.5 w-3.5" />
                                {t('dashboard', 'viewResult')}
                              </button>
                            )}
                            <div className="relative">
                              <button onClick={() => setOpenMenuId(isMenuOpen ? null : cfg.id)} className="flex items-center justify-center w-8 h-8 rounded-md border border-gray-200 hover:bg-gray-100 transition-colors text-gray-500">
                                <MoreHorizontal className="h-4 w-4" />
                              </button>
                              {isMenuOpen && (
                                <div className="absolute right-0 top-full mt-1 w-52 bg-white rounded-lg shadow-lg border border-gray-200 py-1 z-50">
                                  {hasResult && (
                                    <>
                                      <button onClick={() => { setOpenMenuId(null); router.push(`/scaffold/${cfg.id}`); }} className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50"><ExternalLink className="h-4 w-4 text-blue-500" />{t('dashboard', 'openResult')}</button>
                                      <button onClick={() => { setOpenMenuId(null); router.push(`/scaffold/${cfg.id}?tab=3d`); }} className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50"><Box className="h-4 w-4 text-purple-500" />{t('dashboard', 'view3D')}</button>
                                      <button onClick={() => { setOpenMenuId(null); router.push(`/scaffold/${cfg.id}?tab=2d`); }} className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50"><Layers className="h-4 w-4 text-indigo-500" />{t('dashboard', 'view2D')}</button>
                                      <div className="border-t border-gray-100 my-1" />
                                      <button onClick={() => { setOpenMenuId(null); router.push(`/quotations/create?configId=${cfg.id}&projectId=${cfg.projectId}`); }} className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50"><Receipt className="h-4 w-4 text-emerald-500" />{t('dashboard', 'createQuotation')}</button>
                                      <button
                                        onClick={async () => {
                                          setOpenMenuId(null);
                                          try {
                                            const blob = await scaffoldConfigsApi.exportExcel(cfg.id);
                                            const url = URL.createObjectURL(blob);
                                            const a = document.createElement('a');
                                            a.href = url; a.download = `scaffold_${cfg.id.slice(0, 8)}.xlsx`; a.click();
                                            URL.revokeObjectURL(url);
                                          } catch { alert(t('result', 'excelFailed') || 'Excel export failed'); }
                                        }}
                                        className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50"
                                      ><FileSpreadsheet className="h-4 w-4 text-green-500" />{t('dashboard', 'exportExcel')}</button>
                                    </>
                                  )}
                                  <div className="border-t border-gray-100 my-1" />
                                  <button onClick={() => { setOpenMenuId(null); router.push('/scaffold'); }} className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50"><Copy className="h-4 w-4 text-gray-400" />{t('dashboard', 'newCalculation')}</button>
                                  <div className="border-t border-gray-100 my-1" />
                                  <button onClick={(e) => { setOpenMenuId(null); handleDelete(cfg.id, e); }} disabled={deleteMutation.isPending} className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-red-600 hover:bg-red-50"><Trash2 className="h-4 w-4" />{t('dashboard', 'delete')}</button>
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
                  <button onClick={() => router.push('/scaffold')} className="text-blue-600 font-semibold hover:underline flex items-center gap-1 mx-auto">
                    {t('dashboard', 'firstCalc')} <ArrowRight className="h-4 w-4" />
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
