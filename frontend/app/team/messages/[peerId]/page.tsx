'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { usersApi } from '@/lib/api/users';
import { teamChatApi, TeamChatMessage } from '@/lib/api/team-chat';
import type { UserProfile } from '@/lib/api/users';
import { useI18n } from '@/lib/i18n';
import { ArrowLeft, Loader2, MessageSquare, Send } from 'lucide-react';

function displayName(u: { firstName?: string | null; lastName?: string | null; email: string }) {
  const n = [u.lastName, u.firstName].filter(Boolean).join(' ').trim();
  return n || u.email;
}

export default function TeamDmPage() {
  const params = useParams();
  const peerId = typeof params.peerId === 'string' ? params.peerId : '';
  const router = useRouter();
  const { locale, t } = useI18n();
  const queryClient = useQueryClient();
  const [body, setBody] = useState('');
  const endRef = useRef<HTMLDivElement>(null);

  const { data: profile } = useQuery({
    queryKey: ['profile'],
    queryFn: usersApi.getProfile,
    retry: false,
  });

  const { data: peerUser, isError: peerError } = useQuery({
    queryKey: ['team-dm-peer', peerId],
    queryFn: () => teamChatApi.getDmPeer(peerId),
    enabled: !!peerId && !!profile?.companyId && profile.role !== 'superadmin',
    retry: false,
  });

  useEffect(() => {
    if (profile && (profile.role === 'superadmin' || !profile.companyId)) {
      router.replace('/dashboard');
    }
  }, [profile, router]);

  useEffect(() => {
    if (profile?.id && peerId && profile.id === peerId) {
      router.replace('/team');
    }
  }, [profile?.id, peerId, router]);

  const { data, isLoading } = useQuery({
    queryKey: ['team-dm', peerId],
    queryFn: () => teamChatApi.listDmMessages(peerId, 100),
    enabled: !!peerId && !!profile?.companyId && profile.id !== peerId,
    refetchInterval: 10_000,
    staleTime: 4_000,
  });
  const messages = data?.messages ?? [];

  const sendMutation = useMutation({
    mutationFn: (text: string) => teamChatApi.sendDmMessage(peerId, text),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['team-dm', peerId] });
      setBody('');
    },
  });

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  if (!peerId || !profile?.companyId) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
      </div>
    );
  }

  if (peerError) {
    return (
      <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center px-4">
        <p className="text-gray-700 mb-4">{t('teamDmPage', 'peerUnavailable')}</p>
        <Link href="/users" className="text-blue-600 font-medium">
          {t('teamDmPage', 'backToMembers')}
        </Link>
      </div>
    );
  }

  const peerLabel = peerUser ? displayName(peerUser as UserProfile) : '…';

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="max-w-lg mx-auto px-4 py-6 flex flex-col min-h-screen">
        <div className="mb-4">
          <Link
            href={profile.isCompanyAdmin ? '/users' : '/team'}
            className="inline-flex items-center gap-1 text-sm font-medium text-blue-600 hover:text-blue-800"
          >
            <ArrowLeft className="h-4 w-4" />
            {t('teamDmPage', 'back')}
          </Link>
        </div>
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm flex flex-col flex-1 min-h-[420px] overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100 flex items-center gap-2 bg-slate-50/80">
            <MessageSquare className="h-5 w-5 text-blue-600 shrink-0" />
            <div className="min-w-0">
              <h1 className="text-base font-semibold text-slate-900 truncate">{peerLabel}</h1>
              {peerUser?.email ? <p className="text-xs text-slate-500 truncate">{peerUser.email}</p> : null}
            </div>
          </div>
          <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-white">
            {isLoading ? (
              <div className="flex justify-center py-12">
                <Loader2 className="h-8 w-8 animate-spin text-slate-300" />
              </div>
            ) : messages.length === 0 ? (
              <p className="text-sm text-slate-500 text-center py-8">{t('teamDmPage', 'empty')}</p>
            ) : (
              messages.map((m: TeamChatMessage) => {
                const mine = m.sender.id === profile.id;
                return (
                  <div key={m.id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
                    <div
                      className={`max-w-[88%] rounded-2xl px-3 py-2 text-sm ${
                        mine ? 'bg-blue-600 text-white rounded-br-md' : 'bg-slate-100 text-slate-900 rounded-bl-md'
                      }`}
                    >
                      <p className="whitespace-pre-wrap break-words">{m.body}</p>
                      <p className={`text-[10px] mt-1 ${mine ? 'text-blue-100' : 'text-slate-400'}`}>
                        {new Date(m.createdAt).toLocaleString(
                          locale === 'ja' ? 'ja-JP' : locale === 'fr' ? 'fr-FR' : 'en-US',
                          { hour: '2-digit', minute: '2-digit' },
                        )}
                      </p>
                    </div>
                  </div>
                );
              })
            )}
            <div ref={endRef} />
          </div>
          <form
            className="p-3 border-t border-slate-100 flex gap-2 bg-slate-50/50"
            onSubmit={(e) => {
              e.preventDefault();
              const text = body.trim();
              if (!text || sendMutation.isPending) return;
              sendMutation.mutate(text);
            }}
          >
            <input
              type="text"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder={t('teamDmPage', 'placeholder')}
              className="flex-1 px-3 py-2.5 border border-slate-200 rounded-xl text-sm bg-white"
              maxLength={5000}
            />
            <button
              type="submit"
              disabled={sendMutation.isPending || !body.trim()}
              className="inline-flex items-center justify-center w-11 h-11 rounded-xl bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 shrink-0"
              aria-label={t('teamPage', 'send')}
            >
              {sendMutation.isPending ? <Loader2 className="h-5 w-5 animate-spin" /> : <Send className="h-5 w-5" />}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
