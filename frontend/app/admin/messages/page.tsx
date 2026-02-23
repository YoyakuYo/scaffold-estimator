'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { messagesApi, Message, ConversationWithUser } from '@/lib/api/messages';
import { usersApi } from '@/lib/api/users';
import { useI18n } from '@/lib/i18n';
import { MessageSquare, Send, Loader2, ArrowLeft } from 'lucide-react';
import Link from 'next/link';

export default function AdminMessagesPage() {
  const { locale } = useI18n();
  const queryClient = useQueryClient();
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null);
  const [replyBody, setReplyBody] = useState('');

  const { data: currentUser } = useQuery({
    queryKey: ['profile'],
    queryFn: usersApi.getProfile,
    retry: false,
  });
  const isAdmin = currentUser?.role === 'superadmin';

  const { data: conversations, isLoading: convLoading } = useQuery({
    queryKey: ['admin-conversations'],
    queryFn: messagesApi.listConversations,
    enabled: isAdmin,
  });

  const { data: messages, isLoading: msgLoading } = useQuery({
    queryKey: ['admin-conversation-messages', selectedConversationId],
    queryFn: () => messagesApi.getConversationMessages(selectedConversationId!),
    enabled: !!selectedConversationId && isAdmin,
  });

  const replyMutation = useMutation({
    mutationFn: ({ id, body }: { id: string; body: string }) =>
      messagesApi.adminReply(id, body),
    onSuccess: (_, { id }) => {
      queryClient.invalidateQueries({ queryKey: ['admin-conversation-messages', id] });
      queryClient.invalidateQueries({ queryKey: ['admin-conversations'] });
      setReplyBody('');
    },
  });

  const markReadMutation = useMutation({
    mutationFn: (conversationId: string) => messagesApi.adminMarkRead(conversationId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-conversations'] });
      queryClient.invalidateQueries({ queryKey: ['admin-conversation-messages', selectedConversationId!] });
    },
  });

  const selectedConv = conversations?.find((c) => c.id === selectedConversationId);

  const handleReply = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedConversationId || !replyBody.trim() || replyMutation.isPending) return;
    replyMutation.mutate({ id: selectedConversationId, body: replyBody.trim() });
  };

  const handleSelectConversation = (id: string) => {
    setSelectedConversationId(id);
    markReadMutation.mutate(id);
  };

  const t = (en: string, ja: string) => (locale === 'ja' ? ja : en);

  if (currentUser && !isAdmin) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-gray-500">{t('Admin only', '管理者のみ利用できます')}</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-6xl mx-auto px-4 py-8">
        <div className="flex items-center gap-4 mb-6">
          <Link
            href="/admin"
            className="p-2 rounded-lg hover:bg-gray-200 text-gray-600"
          >
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <MessageSquare className="h-7 w-7 text-blue-600" />
            {t('Support Messages', 'サポートメッセージ')}
          </h1>
        </div>

        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden flex" style={{ minHeight: '500px' }}>
          {/* Conversation list */}
          <div className="w-80 border-r border-gray-200 flex flex-col">
            <div className="p-4 border-b border-gray-200 font-medium text-gray-700">
              {t('Conversations', '会話一覧')}
            </div>
            <div className="flex-1 overflow-y-auto">
              {convLoading ? (
                <div className="p-6 flex justify-center">
                  <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
                </div>
              ) : !conversations?.length ? (
                <p className="p-4 text-gray-500 text-sm">{t('No conversations', '会話はありません')}</p>
              ) : (
                <ul>
                  {conversations.map((c: ConversationWithUser) => (
                    <li key={c.id}>
                      <button
                        onClick={() => handleSelectConversation(c.id)}
                        className={`w-full text-left px-4 py-3 border-b border-gray-100 hover:bg-gray-50 flex items-center justify-between ${
                          selectedConversationId === c.id ? 'bg-blue-50 border-l-4 border-l-blue-600' : ''
                        }`}
                      >
                        <div className="min-w-0 flex-1">
                          <p className="font-medium text-gray-900 truncate">
                            {c.user?.firstName || c.user?.lastName
                              ? [c.user.lastName, c.user.firstName].filter(Boolean).join(' ')
                              : c.user?.email ?? c.userId}
                          </p>
                          <p className="text-sm text-gray-500 truncate">{c.user?.email}</p>
                        </div>
                        {c.unreadCount ? (
                          <span className="flex-shrink-0 h-5 min-w-[20px] px-1.5 rounded-full bg-red-500 text-white text-xs flex items-center justify-center">
                            {c.unreadCount}
                          </span>
                        ) : null}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          {/* Message thread */}
          <div className="flex-1 flex flex-col min-w-0">
            {!selectedConversationId ? (
              <div className="flex-1 flex items-center justify-center text-gray-500">
                {t('Select a conversation', '会話を選択してください')}
              </div>
            ) : (
              <>
                <div className="p-4 border-b border-gray-200 bg-gray-50">
                  <p className="font-medium text-gray-900">
                    {selectedConv?.user?.firstName || selectedConv?.user?.lastName
                      ? [selectedConv?.user?.lastName, selectedConv?.user?.firstName].filter(Boolean).join(' ')
                      : selectedConv?.user?.email}
                  </p>
                  <p className="text-sm text-gray-500">{selectedConv?.user?.email}</p>
                </div>
                <div className="flex-1 overflow-y-auto p-4 space-y-4">
                  {msgLoading ? (
                    <div className="flex justify-center py-8">
                      <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
                    </div>
                  ) : (
                    messages?.map((msg: Message) => {
                      const isAdminMsg = msg.sender?.role === 'superadmin';
                      return (
                        <div
                          key={msg.id}
                          className={`flex ${isAdminMsg ? 'justify-end' : 'justify-start'}`}
                        >
                          <div
                            className={`max-w-[80%] rounded-lg px-4 py-2 ${
                              isAdminMsg ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-900'
                            }`}
                          >
                            <p className="text-sm font-medium opacity-80">
                              {isAdminMsg ? t('You', 'あなた') : (msg.sender?.firstName || msg.sender?.lastName || msg.sender?.email || 'User')}
                            </p>
                            <p className="whitespace-pre-wrap">{msg.body}</p>
                            <p className="text-xs opacity-70 mt-1">
                              {new Date(msg.createdAt).toLocaleString(locale === 'ja' ? 'ja-JP' : 'en-US')}
                            </p>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
                <form onSubmit={handleReply} className="p-4 border-t border-gray-200">
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={replyBody}
                      onChange={(e) => setReplyBody(e.target.value)}
                      placeholder={t('Type your reply...', '返信を入力...')}
                      className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                      disabled={replyMutation.isPending}
                    />
                    <button
                      type="submit"
                      disabled={!replyBody.trim() || replyMutation.isPending}
                      className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2"
                    >
                      {replyMutation.isPending ? (
                        <Loader2 className="h-5 w-5 animate-spin" />
                      ) : (
                        <Send className="h-5 w-5" />
                      )}
                      {t('Send', '送信')}
                    </button>
                  </div>
                </form>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
