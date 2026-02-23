'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useI18n } from '@/lib/i18n';
import { subscriptionsApi, SubscriberRow } from '@/lib/api/subscriptions';
import { usersApi } from '@/lib/api/users';
import { Loader2, CreditCard, CalendarClock, CheckCircle2, Ban } from 'lucide-react';

export default function SuperadminSubscribersPage() {
  const { locale } = useI18n();
  const queryClient = useQueryClient();
  const t = (en: string, ja: string) => (locale === 'ja' ? ja : en);

  const { data: currentUser } = useQuery({
    queryKey: ['profile'],
    queryFn: usersApi.getProfile,
    retry: false,
  });
  const isSuperAdmin = currentUser?.role === 'superadmin';

  const { data: subscribers, isLoading } = useQuery<SubscriberRow[]>({
    queryKey: ['subscribers'],
    queryFn: subscriptionsApi.listSubscribers,
    enabled: isSuperAdmin,
    refetchInterval: 30000,
  });

  const extendTrialMutation = useMutation({
    mutationFn: ({ userId, days }: { userId: string; days: number }) =>
      subscriptionsApi.extendTrial(userId, days),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['subscribers'] }),
  });

  const setAccessMutation = useMutation({
    mutationFn: ({ userId, access }: { userId: string; access: 'active' | 'canceled' | 'expired' }) =>
      subscriptionsApi.setAccess(userId, access),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['subscribers'] }),
  });

  if (!isSuperAdmin) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-6">
          <h1 className="text-3xl font-bold text-gray-900 flex items-center gap-2">
            <CreditCard className="h-8 w-8 text-indigo-600" />
            {t('Subscribers', '購読者管理')}
          </h1>
          <p className="text-gray-500 mt-1">
            {t('View and control all subscriptions and trial access', '全ユーザーの契約・トライアルを管理')}
          </p>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          {isLoading ? (
            <div className="p-10 flex justify-center">
              <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
            </div>
          ) : !subscribers?.length ? (
            <div className="p-10 text-center text-gray-500">
              {t('No subscribers found', '購読データがありません')}
            </div>
          ) : (
            <table className="w-full">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">User</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Plan</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Status</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Trial</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {subscribers.map((sub) => (
                  <tr key={sub.id}>
                    <td className="px-4 py-3">
                      <p className="font-medium text-gray-900">
                        {[sub.user?.lastName, sub.user?.firstName].filter(Boolean).join(' ') ||
                          sub.user?.email ||
                          sub.userId}
                      </p>
                      <p className="text-sm text-gray-500">{sub.user?.email || sub.userId}</p>
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-700">{sub.plan}</td>
                    <td className="px-4 py-3">
                      <span
                        className={`px-2 py-1 rounded-full text-xs font-medium ${
                          sub.status === 'active'
                            ? 'bg-green-100 text-green-700'
                            : sub.status === 'trialing'
                            ? 'bg-amber-100 text-amber-700'
                            : 'bg-gray-100 text-gray-600'
                        }`}
                      >
                        {sub.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-700">
                      {sub.status === 'trialing' ? (
                        <span className="inline-flex items-center gap-1">
                          <CalendarClock className="h-4 w-4 text-amber-600" />
                          {t(`${sub.trialDaysRemaining} days left`, `残り${sub.trialDaysRemaining}日`)}
                        </span>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-2">
                        <button
                          onClick={() => extendTrialMutation.mutate({ userId: sub.userId, days: 14 })}
                          className="px-2.5 py-1.5 text-xs bg-amber-50 border border-amber-300 text-amber-700 rounded hover:bg-amber-100"
                        >
                          +14d Trial
                        </button>
                        <button
                          onClick={() => setAccessMutation.mutate({ userId: sub.userId, access: 'active' })}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs bg-green-50 border border-green-300 text-green-700 rounded hover:bg-green-100"
                        >
                          <CheckCircle2 className="h-3.5 w-3.5" />
                          Active
                        </button>
                        <button
                          onClick={() => setAccessMutation.mutate({ userId: sub.userId, access: 'canceled' })}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs bg-red-50 border border-red-300 text-red-700 rounded hover:bg-red-100"
                        >
                          <Ban className="h-3.5 w-3.5" />
                          Cancel
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
