'use client';

import { useState, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { messagesApi, Message } from '@/lib/api/messages';
import { usersApi } from '@/lib/api/users';
import { useI18n } from '@/lib/i18n';
import { MessageSquare, Send, Loader2 } from 'lucide-react';

export default function SupportPage() {
  const { locale } = useI18n();
  const queryClient = useQueryClient();
  const [body, setBody] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const { data: profile } = useQuery({
    queryKey: ['profile'],
    queryFn: usersApi.getProfile,
    retry: false,
  });

  const { data, isLoading } = useQuery({
    queryKey: ['messages-me'],
    queryFn: messagesApi.getMyConversation,
  });
  const messages = data?.messages ?? [];

  const sendMutation = useMutation({
    mutationFn: (text: string) => messagesApi.sendMessage(text),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['messages-me'] });
      queryClient.invalidateQueries({ queryKey: ['messages-unread'] });
      setBody('');
    },
  });

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const text = body.trim();
    if (!text || sendMutation.isPending) return;
    sendMutation.mutate(text);
  };

  const markReadMutation = useMutation({
    mutationFn: messagesApi.markRead,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['messages-unread'] });
    },
  });
  useEffect(() => {
    if (data?.conversation) markReadMutation.mutate();
  }, [data?.conversation?.id]);

  const t = (en: string, ja: string) => (locale === 'ja' ? ja : en);

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-3xl mx-auto px-4 py-8">
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2 mb-6">
          <MessageSquare className="h-7 w-7 text-blue-600" />
          {t('Contact Support', 'サポートに連絡')}
        </h1>
        <p className="text-gray-500 mb-6">
          {t('Send a message to the platform administrator. You will receive a reply here.', '管理者にメッセージを送信できます。返信はこの画面に表示されます。')}
        </p>

        <div className="bg-white rounded-xl shadow-sm border border-gray-200 flex flex-col" style={{ minHeight: '400px' }}>
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {isLoading ? (
              <div className="flex justify-center py-12">
                <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
              </div>
            ) : messages.length === 0 ? (
              <p className="text-center text-gray-500 py-12">
                {t('No messages yet. Send a message below.', 'まだメッセージはありません。下から送信してください。')}
              </p>
            ) : (
              messages.map((msg: Message) => {
                const isMe = msg.senderId === profile?.id;
                return (
                  <div
                    key={msg.id}
                    className={`flex ${isMe ? 'justify-end' : 'justify-start'}`}
                  >
                    <div
                      className={`max-w-[80%] rounded-lg px-4 py-2 ${
                        isMe
                          ? 'bg-blue-600 text-white'
                          : 'bg-gray-100 text-gray-900'
                      }`}
                    >
                      <p className="text-sm font-medium opacity-80">
                        {isMe ? t('You', 'あなた') : t('Support', 'サポート')}
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
            <div ref={messagesEndRef} />
          </div>
          <form onSubmit={handleSubmit} className="p-4 border-t border-gray-200">
            <div className="flex gap-2">
              <input
                type="text"
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder={t('Type your message...', 'メッセージを入力...')}
                className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                disabled={sendMutation.isPending}
              />
              <button
                type="submit"
                disabled={!body.trim() || sendMutation.isPending}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2"
              >
                {sendMutation.isPending ? (
                  <Loader2 className="h-5 w-5 animate-spin" />
                ) : (
                  <Send className="h-5 w-5" />
                )}
                {t('Send', '送信')}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
