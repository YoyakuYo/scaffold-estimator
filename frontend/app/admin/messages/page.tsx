'use client';

import { useState, useRef, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { messagesApi, Message, ConversationWithUser } from '@/lib/api/messages';
import { usersApi, UserProfile } from '@/lib/api/users';
import { useI18n } from '@/lib/i18n';
import { MessageSquare, Send, Loader2, ArrowLeft, Plus, Search, X, Users } from 'lucide-react';
import Link from 'next/link';

export default function AdminMessagesPage() {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null);
  const [replyBody, setReplyBody] = useState('');
  const [showNewMessage, setShowNewMessage] = useState(false);
  const [newMsgUserId, setNewMsgUserId] = useState<string | null>(null);
  const [newMsgBody, setNewMsgBody] = useState('');
  const [userSearch, setUserSearch] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);

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
    refetchInterval: 5000,
    staleTime: 3000,
  });

  const { data: messages, isLoading: msgLoading } = useQuery({
    queryKey: ['admin-conversation-messages', selectedConversationId],
    queryFn: () => messagesApi.getConversationMessages(selectedConversationId!),
    enabled: !!selectedConversationId && isAdmin,
    refetchInterval: 3000,
    staleTime: 2000,
  });

  const { data: allUsers } = useQuery<UserProfile[]>({
    queryKey: ['all-users-for-messaging'],
    queryFn: usersApi.listUsers,
    enabled: isAdmin && showNewMessage,
  });

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

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
    },
  });

  const newConvMutation = useMutation({
    mutationFn: ({ userId, body }: { userId: string; body: string }) =>
      messagesApi.adminCreateConversation(userId, body),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['admin-conversations'] });
      setShowNewMessage(false);
      setNewMsgUserId(null);
      setNewMsgBody('');
      setUserSearch('');
      if (data.conversation?.id) {
        setSelectedConversationId(data.conversation.id);
      }
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
    setShowNewMessage(false);
    markReadMutation.mutate(id);
  };

  const handleSendNewMessage = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newMsgUserId || !newMsgBody.trim() || newConvMutation.isPending) return;
    newConvMutation.mutate({ userId: newMsgUserId, body: newMsgBody.trim() });
  };

  const existingConvUserIds = new Set(conversations?.map((c) => c.userId) || []);

  const filteredUsers = (allUsers || []).filter((u) => {
    if (u.role === 'superadmin') return false;
    if (!userSearch.trim()) return true;
    const search = userSearch.toLowerCase();
    return (
      u.email.toLowerCase().includes(search) ||
      (u.firstName || '').toLowerCase().includes(search) ||
      (u.lastName || '').toLowerCase().includes(search)
    );
  });

  if (currentUser && !isAdmin) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-gray-500">{t('messaging', 'title')}</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-6xl mx-auto px-4 py-8">
        <div className="flex items-center gap-4 mb-6">
          <Link href="/admin" className="p-2 rounded-lg hover:bg-gray-200 text-gray-600">
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <MessageSquare className="h-7 w-7 text-blue-600" />
            {t('messaging', 'title')}
          </h1>
        </div>

        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden flex" style={{ minHeight: '500px' }}>
          {/* Conversation list */}
          <div className="w-80 border-r border-gray-200 flex flex-col">
            <div className="p-4 border-b border-gray-200 flex items-center justify-between">
              <span className="font-medium text-gray-700">{t('messaging', 'conversations')}</span>
              <button
                onClick={() => { setShowNewMessage(true); setSelectedConversationId(null); }}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors"
              >
                <Plus className="h-4 w-4" />
                {t('messaging', 'newMessage')}
              </button>
            </div>
            <div className="flex-1 overflow-y-auto">
              {convLoading ? (
                <div className="p-6 flex justify-center">
                  <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
                </div>
              ) : !conversations?.length ? (
                <p className="p-4 text-gray-500 text-sm">{t('messaging', 'noConversations')}</p>
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
                          {c.lastMessage && (
                            <p className="text-xs text-gray-400 truncate mt-0.5">{c.lastMessage.body}</p>
                          )}
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

          {/* Right panel */}
          <div className="flex-1 flex flex-col min-w-0">
            {showNewMessage ? (
              /* ═══ New Message Compose ═══ */
              <div className="flex-1 flex flex-col">
                <div className="p-4 border-b border-gray-200 bg-gray-50 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Users className="h-5 w-5 text-blue-600" />
                    <span className="font-medium text-gray-900">{t('messaging', 'newMessage')}</span>
                  </div>
                  <button
                    onClick={() => { setShowNewMessage(false); setNewMsgUserId(null); setNewMsgBody(''); setUserSearch(''); }}
                    className="p-1.5 text-gray-400 hover:text-gray-600 rounded"
                  >
                    <X className="h-5 w-5" />
                  </button>
                </div>

                {!newMsgUserId ? (
                  /* User picker */
                  <div className="flex-1 overflow-y-auto">
                    <div className="p-4 border-b border-gray-100">
                      <div className="relative">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                        <input
                          type="text"
                          value={userSearch}
                          onChange={(e) => setUserSearch(e.target.value)}
                          placeholder={t('messaging', 'searchUsers')}
                          className="w-full pl-10 pr-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500"
                          autoFocus
                        />
                      </div>
                    </div>
                    <div className="divide-y divide-gray-100">
                      {filteredUsers.length === 0 ? (
                        <p className="p-4 text-sm text-gray-400 text-center">{t('messaging', 'noConversations')}</p>
                      ) : (
                        filteredUsers.map((user) => {
                          const hasConv = existingConvUserIds.has(user.id);
                          return (
                            <button
                              key={user.id}
                              onClick={() => {
                                if (hasConv) {
                                  const conv = conversations?.find((c) => c.userId === user.id);
                                  if (conv) { handleSelectConversation(conv.id); }
                                } else {
                                  setNewMsgUserId(user.id);
                                }
                              }}
                              className="w-full text-left px-4 py-3 hover:bg-gray-50 flex items-center justify-between"
                            >
                              <div className="min-w-0 flex-1">
                                <p className="font-medium text-gray-900">
                                  {user.firstName || user.lastName
                                    ? [user.lastName, user.firstName].filter(Boolean).join(' ')
                                    : user.email}
                                </p>
                                <p className="text-sm text-gray-500">{user.email}</p>
                                <span className={`inline-block mt-1 px-2 py-0.5 rounded text-xs font-medium ${
                                  user.role === 'estimator' ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-600'
                                }`}>
                                  {user.role}
                                </span>
                              </div>
                              {hasConv ? (
                                <span className="text-xs text-green-600 font-medium">{t('messaging', 'existingConversation')}</span>
                              ) : (
                                <span className="text-xs text-blue-600 font-medium">{t('messaging', 'startConversation')}</span>
                              )}
                            </button>
                          );
                        })
                      )}
                    </div>
                  </div>
                ) : (
                  /* Compose message for selected user */
                  <div className="flex-1 flex flex-col">
                    <div className="p-4 bg-blue-50 border-b border-blue-100">
                      <div className="flex items-center justify-between">
                        <p className="text-sm text-blue-800">
                          <span className="font-medium">
                            {filteredUsers.find((u) => u.id === newMsgUserId)?.email || allUsers?.find((u) => u.id === newMsgUserId)?.email}
                          </span>
                        </p>
                        <button
                          onClick={() => setNewMsgUserId(null)}
                          className="text-xs text-blue-600 hover:underline"
                        >
                          {t('messaging', 'cancel')}
                        </button>
                      </div>
                    </div>
                    <div className="flex-1" />
                    <form onSubmit={handleSendNewMessage} className="p-4 border-t border-gray-200">
                      <div className="flex gap-2">
                        <input
                          type="text"
                          value={newMsgBody}
                          onChange={(e) => setNewMsgBody(e.target.value)}
                          placeholder={t('messaging', 'typeMessage')}
                          className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                          autoFocus
                          disabled={newConvMutation.isPending}
                        />
                        <button
                          type="submit"
                          disabled={!newMsgBody.trim() || newConvMutation.isPending}
                          className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2"
                        >
                          {newConvMutation.isPending ? (
                            <Loader2 className="h-5 w-5 animate-spin" />
                          ) : (
                            <Send className="h-5 w-5" />
                          )}
                          {t('messaging', 'sendFirst')}
                        </button>
                      </div>
                    </form>
                  </div>
                )}
              </div>
            ) : !selectedConversationId ? (
              <div className="flex-1 flex items-center justify-center text-gray-500">
                {t('messaging', 'selectConversation')}
              </div>
            ) : (
              /* ═══ Conversation Thread ═══ */
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
                        <div key={msg.id} className={`flex ${isAdminMsg ? 'justify-end' : 'justify-start'}`}>
                          <div className={`max-w-[80%] rounded-lg px-4 py-2 ${
                            isAdminMsg ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-900'
                          }`}>
                            <p className="text-sm font-medium opacity-80">
                              {isAdminMsg ? t('messaging', 'you') : (msg.sender?.firstName || msg.sender?.lastName || msg.sender?.email || 'User')}
                            </p>
                            <p className="whitespace-pre-wrap">{msg.body}</p>
                            <p className="text-xs opacity-70 mt-1">
                              {new Date(msg.createdAt).toLocaleString('ja-JP')}
                            </p>
                          </div>
                        </div>
                      );
                    })
                  )}
                  <div ref={messagesEndRef} />
                </div>
                <form onSubmit={handleReply} className="p-4 border-t border-gray-200">
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={replyBody}
                      onChange={(e) => setReplyBody(e.target.value)}
                      placeholder={t('messaging', 'typeMessage')}
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
                      {t('messaging', 'send')}
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
