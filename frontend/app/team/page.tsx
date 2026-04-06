'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { usersApi, UserProfile } from '@/lib/api/users';
import { teamChatApi, TeamChatMessage } from '@/lib/api/team-chat';
import { teamInvitesApi } from '@/lib/api/team-invites';
import { companyApi } from '@/lib/api/company';
import { subscriptionsApi } from '@/lib/api/subscriptions';
import { useI18n } from '@/lib/i18n';
import { effectiveSeatCap, isUnlimitedSeatCap } from '@/lib/billing/effective-seat-cap';
import {
  MessageSquare,
  Send,
  Loader2,
  Users,
  UserPlus,
  Copy,
  Shield,
  ArrowLeft,
} from 'lucide-react';

function displayName(u: { firstName?: string | null; lastName?: string | null; email: string }) {
  const n = [u.lastName, u.firstName].filter(Boolean).join(' ').trim();
  return n || u.email;
}

export default function TeamPage() {
  const { locale, t } = useI18n();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [body, setBody] = useState('');
  const [chatTab, setChatTab] = useState<'group' | 'direct'>('group');
  const messagesScrollRef = useRef<HTMLDivElement>(null);

  const { data: profile, isLoading: profileLoading } = useQuery({
    queryKey: ['profile'],
    queryFn: usersApi.getProfile,
    retry: false,
  });

  const { data: subscription } = useQuery({
    queryKey: ['my-subscription'],
    queryFn: subscriptionsApi.getMine,
    enabled: !!profile && profile.role !== 'superadmin',
    retry: false,
  });

  useEffect(() => {
    if (!profileLoading && profile) {
      if (profile.role === 'superadmin' || !profile.companyId) {
        router.replace('/dashboard');
      }
    }
  }, [profile, profileLoading, router]);

  const isCompanyAdmin = profile?.isCompanyAdmin === true;

  const { data: messagesData, isLoading: messagesLoading } = useQuery({
    queryKey: ['team-chat-messages'],
    queryFn: () => teamChatApi.listMessages(100),
    enabled: !!profile?.companyId,
    refetchInterval: 10_000,
    staleTime: 5_000,
  });
  const messages = messagesData?.messages ?? [];

  const { data: peersData, isLoading: peersLoading } = useQuery({
    queryKey: ['team-chat-peers'],
    queryFn: teamChatApi.listPeers,
    enabled: !!profile?.companyId,
    staleTime: 30_000,
  });
  const peers = peersData?.peers ?? [];

  const { data: members, isLoading: membersLoading } = useQuery({
    queryKey: ['users'],
    queryFn: usersApi.listUsers,
    enabled: !!profile?.companyId && isCompanyAdmin,
    retry: false,
  });

  const { data: branchOptions = [] } = useQuery({
    queryKey: ['company-branches-team'],
    queryFn: companyApi.listBranches,
    enabled: !!profile?.companyId && isCompanyAdmin,
  });

  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteBranchId, setInviteBranchId] = useState('');
  const [inviteRole, setInviteRole] = useState<'viewer' | 'estimator'>('viewer');
  const [lastJoinUrl, setLastJoinUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!branchOptions.length) {
      setInviteBranchId('');
      return;
    }
    if (!inviteBranchId || !branchOptions.some((b) => b.id === inviteBranchId)) {
      const hq = branchOptions.find((b) => b.isHeadquarters);
      setInviteBranchId((hq || branchOptions[0]).id);
    }
  }, [branchOptions, inviteBranchId]);

  const { data: teamInvites } = useQuery({
    queryKey: ['team-invites', profile?.companyId],
    queryFn: () => teamInvitesApi.list(),
    enabled: !!profile?.companyId && isCompanyAdmin,
  });

  const sendMutation = useMutation({
    mutationFn: (text: string) => teamChatApi.sendMessage(text),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['team-chat-messages'] });
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
      queryClient.invalidateQueries({ queryKey: ['notifications-unread'] });
      setBody('');
    },
  });

  const createInviteMutation = useMutation({
    mutationFn: () =>
      teamInvitesApi.create({
        email: inviteEmail.trim(),
        branchId: inviteBranchId,
        role: inviteRole,
      }),
    onMutate: () => setLastJoinUrl(null),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['team-invites'] });
      setInviteEmail('');
      setLastJoinUrl(data.joinUrl || null);
    },
  });

  const revokeInviteMutation = useMutation({
    mutationFn: (inviteId: string) => teamInvitesApi.revoke(inviteId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['team-invites'] });
    },
  });

  const transferMutation = useMutation({
    mutationFn: (targetUserId: string) => usersApi.transferCompanyAdmin({ targetUserId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['profile'] });
      queryClient.invalidateQueries({ queryKey: ['users'] });
      queryClient.invalidateQueries({ queryKey: ['my-subscription'] });
    },
  });

  useEffect(() => {
    if (chatTab !== 'group') return;
    const el = messagesScrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  }, [messages, chatTab]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const text = body.trim();
    if (!text || sendMutation.isPending) return;
    sendMutation.mutate(text);
  };

  if (profileLoading || !profile?.companyId || profile.role === 'superadmin') {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-6">
          <Link
            href="/dashboard"
            className="inline-flex items-center gap-1 text-sm font-medium text-blue-600 hover:text-blue-800 mb-3"
          >
            <ArrowLeft className="h-4 w-4" />
            {t('teamPage', 'backDashboard')}
          </Link>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Users className="h-7 w-7 text-blue-600" />
            {t('teamPage', 'title')}
          </h1>
          <p className="text-gray-500 mt-1">{t('teamPage', 'subtitle')}</p>
        </div>

        <div className="flex gap-1 mb-4 border-b border-gray-200">
          <button
            type="button"
            onClick={() => setChatTab('group')}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              chatTab === 'group'
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {t('teamPage', 'tabGroup')}
          </button>
          <button
            type="button"
            onClick={() => setChatTab('direct')}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              chatTab === 'direct'
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {t('teamPage', 'tabDirect')}
          </button>
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 flex flex-col min-h-0" style={{ minHeight: 420 }}>
            {chatTab === 'group' ? (
              <>
                <div className="px-4 py-3 border-b border-gray-200 flex items-center gap-2 shrink-0">
                  <MessageSquare className="h-5 w-5 text-blue-600" />
                  <h2 className="text-lg font-semibold text-gray-900">{t('teamPage', 'chatTitle')}</h2>
                </div>
                <div ref={messagesScrollRef} className="flex-1 overflow-y-auto p-4 space-y-3 min-h-0">
                  {messagesLoading ? (
                    <div className="flex justify-center py-12">
                      <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
                    </div>
                  ) : messages.length === 0 ? (
                    <p className="text-sm text-gray-500 text-center py-8">{t('teamPage', 'noMessages')}</p>
                  ) : (
                    messages.map((m: TeamChatMessage) => {
                      const mine = m.sender.id === profile.id;
                      return (
                        <div key={m.id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
                          <div
                            className={`max-w-[85%] rounded-lg px-3 py-2 text-sm ${
                              mine ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-900'
                            }`}
                          >
                            {!mine && (
                              <p className="text-xs font-semibold opacity-80 mb-1">{displayName(m.sender)}</p>
                            )}
                            <p className="whitespace-pre-wrap break-words">{m.body}</p>
                            <p className={`text-[10px] mt-1 ${mine ? 'text-blue-100' : 'text-gray-400'}`}>
                              {new Date(m.createdAt).toLocaleString(
                                locale === 'ja' ? 'ja-JP' : locale === 'fr' ? 'fr-FR' : 'en-US',
                              )}
                            </p>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
                <form onSubmit={handleSubmit} className="p-3 border-t border-gray-200 flex gap-2 shrink-0">
                  <input
                    type="text"
                    value={body}
                    onChange={(e) => setBody(e.target.value)}
                    placeholder={t('teamPage', 'messagePlaceholder')}
                    className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm"
                    maxLength={5000}
                  />
                  <button
                    type="submit"
                    disabled={sendMutation.isPending || !body.trim()}
                    className="inline-flex items-center gap-1 px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
                  >
                    {sendMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                    {t('teamPage', 'send')}
                  </button>
                </form>
                {sendMutation.isError && (
                  <p className="px-3 pb-2 text-xs text-red-600 shrink-0">
                    {(sendMutation.error as { response?: { data?: { message?: string } } })?.response?.data?.message ||
                      (sendMutation.error instanceof Error ? sendMutation.error.message : '')}
                  </p>
                )}
              </>
            ) : (
              <>
                <div className="px-4 py-3 border-b border-gray-200 flex items-center gap-2 shrink-0">
                  <MessageSquare className="h-5 w-5 text-blue-600" />
                  <h2 className="text-lg font-semibold text-gray-900">{t('teamPage', 'tabDirect')}</h2>
                </div>
                <div className="flex-1 overflow-y-auto p-4 min-h-0">
                  {peersLoading ? (
                    <div className="flex justify-center py-12">
                      <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
                    </div>
                  ) : peers.length === 0 ? (
                    <p className="text-sm text-gray-500 text-center py-8">{t('teamPage', 'directEmpty')}</p>
                  ) : (
                    <ul className="space-y-2">
                      {peers.map((p) => (
                        <li key={p.id}>
                          <Link
                            href={`/team/messages/${p.id}`}
                            className="flex items-center justify-between gap-3 rounded-lg border border-gray-100 px-3 py-2.5 text-sm hover:bg-gray-50 transition-colors"
                          >
                            <span className="font-medium text-gray-900 truncate">{displayName(p)}</span>
                            <MessageSquare className="h-4 w-4 text-blue-600 shrink-0" />
                          </Link>
                        </li>
                      ))}
                    </ul>
                  )}
                  <p className="text-xs text-gray-500 mt-4">{t('teamPage', 'directHelp')}</p>
                </div>
              </>
            )}
          </div>

          {isCompanyAdmin ? (
            <div className="space-y-6">
              <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
                <div className="px-4 py-3 border-b border-gray-200 flex items-center gap-2">
                  <Shield className="h-5 w-5 text-amber-600" />
                  <h2 className="text-lg font-semibold text-gray-900">{t('teamPage', 'seatsTitle')}</h2>
                </div>
                <div className="p-4">
                  {subscription?.seatUsage && effectiveSeatCap(subscription) > 0 && (
                    <p className="text-sm text-gray-700 mb-3">
                      {t('profile', 'seatUsageLine')
                        .replace('{{used}}', String(subscription.seatUsage.used))
                        .replace(
                          '{{limit}}',
                          isUnlimitedSeatCap(effectiveSeatCap(subscription))
                            ? t('profile', 'seatUnlimited')
                            : String(effectiveSeatCap(subscription)),
                        )}
                    </p>
                  )}
                  {membersLoading ? (
                    <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
                  ) : (
                    <ul className="divide-y divide-gray-100">
                      {(members || []).map((u: UserProfile) => (
                        <li key={u.id} className="py-3 flex flex-wrap items-center justify-between gap-2 text-sm">
                          <div>
                            <span className="font-medium text-gray-900">{displayName(u)}</span>
                            <span className="text-gray-500 ml-2">{u.email}</span>
                            <div className="flex flex-wrap gap-1.5 mt-1">
                              {u.isCompanyAdmin ? (
                                <span className="text-xs px-2 py-0.5 rounded-full bg-amber-100 text-amber-800">
                                  {t('teamPage', 'badgeAdmin')}
                                </span>
                              ) : null}
                              {u.isCompanySeat ? (
                                <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-700">
                                  {t('teamPage', 'badgeSeat')}
                                </span>
                              ) : null}
                            </div>
                          </div>
                          <div className="flex flex-wrap items-center gap-2">
                            {u.id !== profile.id && u.approvalStatus === 'approved' && u.isActive ? (
                              <Link
                                href={`/team/messages/${u.id}`}
                                className="inline-flex items-center gap-1 text-xs font-semibold text-slate-700 hover:text-blue-700 px-2 py-1 rounded-lg bg-slate-100 hover:bg-slate-200"
                              >
                                <MessageSquare className="h-3.5 w-3.5" />
                                {t('usersAdmin', 'message')}
                              </Link>
                            ) : null}
                            {u.id !== profile.id && u.isCompanyAdmin !== true && u.approvalStatus === 'approved' && u.isActive ? (
                              <button
                                type="button"
                                onClick={() => {
                                  const msg = t('teamPage', 'confirmTransfer').replace('{name}', displayName(u));
                                  if (window.confirm(msg)) transferMutation.mutate(u.id);
                                }}
                                disabled={transferMutation.isPending}
                                className="text-xs font-semibold text-blue-600 hover:text-blue-800 disabled:opacity-50"
                              >
                                {t('teamPage', 'makeAdmin')}
                              </button>
                            ) : null}
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>

              <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
                <div className="px-4 py-3 border-b border-gray-200 flex items-center gap-2">
                  <UserPlus className="h-5 w-5 text-blue-600" />
                  <h2 className="text-lg font-semibold text-gray-900">{t('teamPage', 'invitesTitle')}</h2>
                </div>
                <div className="p-4 space-y-4">
                  <p className="text-sm text-gray-600">{t('usersAdmin', 'teamInvitesHint')}</p>
                  <form
                    className="flex flex-wrap gap-3 items-end"
                    onSubmit={(e) => {
                      e.preventDefault();
                      if (!inviteBranchId) return;
                      createInviteMutation.mutate();
                    }}
                  >
                    <div className="flex-1 min-w-[180px]">
                      <label className="block text-xs font-medium text-gray-700 mb-1">{t('usersAdmin', 'inviteEmail')}</label>
                      <input
                        type="email"
                        required
                        value={inviteEmail}
                        onChange={(e) => setInviteEmail(e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                        placeholder="name@company.com"
                      />
                    </div>
                    <div className="min-w-[140px]">
                      <label className="block text-xs font-medium text-gray-700 mb-1">{t('usersAdmin', 'inviteBranch')}</label>
                      <select
                        value={inviteBranchId}
                        onChange={(e) => setInviteBranchId(e.target.value)}
                        required
                        disabled={!branchOptions.length}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                      >
                        {!branchOptions.length ? (
                          <option value="">{t('usersAdmin', 'noBranches')}</option>
                        ) : (
                          branchOptions.map((b) => (
                            <option key={b.id} value={b.id}>
                              {b.name}
                              {b.isHeadquarters ? ` (${t('usersAdmin', 'headquarters')})` : ''}
                            </option>
                          ))
                        )}
                      </select>
                    </div>
                    <div className="min-w-[120px]">
                      <label className="block text-xs font-medium text-gray-700 mb-1">{t('usersAdmin', 'inviteRole')}</label>
                      <select
                        value={inviteRole}
                        onChange={(e) => setInviteRole(e.target.value as 'viewer' | 'estimator')}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                      >
                        <option value="viewer">{t('usersAdmin', 'viewer')}</option>
                        <option value="estimator">{t('usersAdmin', 'estimator')}</option>
                      </select>
                    </div>
                    <button
                      type="submit"
                      disabled={createInviteMutation.isPending || !inviteBranchId}
                      className="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
                    >
                      {createInviteMutation.isPending ? '…' : t('usersAdmin', 'sendInvite')}
                    </button>
                  </form>
                  {createInviteMutation.isSuccess && lastJoinUrl && (
                    <div className="text-sm space-y-2">
                      <p className="text-green-700">{t('usersAdmin', 'inviteSent')}</p>
                      <div className="flex flex-wrap gap-2 items-center">
                        <input readOnly value={lastJoinUrl} className="flex-1 min-w-[200px] px-2 py-1.5 text-xs border rounded bg-gray-50" />
                        <button
                          type="button"
                          onClick={() => void navigator.clipboard?.writeText(lastJoinUrl)}
                          className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium bg-gray-100 rounded-lg hover:bg-gray-200"
                        >
                          <Copy className="h-3.5 w-3.5" />
                          {t('usersAdmin', 'copyLink')}
                        </button>
                      </div>
                    </div>
                  )}
                  {teamInvites && teamInvites.filter((i) => i.status === 'pending').length > 0 && (
                    <div className="pt-3 border-t border-gray-100">
                      <h3 className="text-sm font-semibold text-gray-800 mb-2">{t('usersAdmin', 'pendingInvites')}</h3>
                      <ul className="space-y-2">
                        {teamInvites
                          .filter((i) => i.status === 'pending')
                          .map((i) => (
                            <li key={i.id} className="flex flex-wrap justify-between gap-2 text-sm">
                              <span className="text-gray-700">
                                {i.email} · {i.role}
                              </span>
                              <button
                                type="button"
                                onClick={() => revokeInviteMutation.mutate(i.id)}
                                className="text-red-600 hover:text-red-800"
                              >
                                {t('usersAdmin', 'revokeInvite')}
                              </button>
                            </li>
                          ))}
                      </ul>
                    </div>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
              <h2 className="text-lg font-semibold text-gray-900 mb-2">{t('teamPage', 'memberAsideTitle')}</h2>
              <p className="text-sm text-gray-600">{t('teamPage', 'memberAsideBody')}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
