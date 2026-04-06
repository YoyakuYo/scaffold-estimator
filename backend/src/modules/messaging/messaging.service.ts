import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { Conversation } from './conversation.entity';
import { Message } from './message.entity';
import { NotificationsService } from '../notifications/notifications.service';
import { MailerService } from '../mailer/mailer.service';
import { SupabaseService } from '../supabase/supabase.service';
import { mapRowToCamel, mapRowsToCamel, mapPayloadToSnake } from '../../common/utils/db-mapper';

/** PostgREST embeds related `users` under key `users`; clients expect `user` / `sender`. */
function embedUsersAs(row: Record<string, unknown>, targetKey: 'user' | 'sender'): void {
  const embedded = row.users;
  if (embedded != null && !Array.isArray(embedded) && row[targetKey] == null) {
    row[targetKey] = embedded;
    delete row.users;
  }
}

@Injectable()
export class MessagingService {
  constructor(
    private readonly supabase: SupabaseService,
    private notificationsService: NotificationsService,
    private mailerService: MailerService,
  ) {}

  async getOrCreateConversationForUser(userId: string): Promise<Conversation> {
    const { data: row } = await this.supabase.getClient().from('conversations').select('*').eq('user_id', userId).maybeSingle();
    if (row) return mapRowToCamel<Conversation>(row as Record<string, unknown>)!;
    const ins = mapPayloadToSnake({ userId });
    const { data: saved, error } = await this.supabase.getClient().from('conversations').insert(ins).select().single();
    if (error || !saved) throw new Error(error?.message || 'Failed to create conversation');
    return mapRowToCamel<Conversation>(saved as Record<string, unknown>)!;
  }

  async getMyConversation(userId: string): Promise<Conversation | null> {
    const { data: row } = await this.supabase.getClient().from('conversations').select('*, users(*)').eq('user_id', userId).maybeSingle();
    if (!row) return null;
    const mapped = mapRowToCamel<Conversation>(row as Record<string, unknown>)!;
    embedUsersAs(mapped as unknown as Record<string, unknown>, 'user');
    return mapped;
  }

  async getAllConversations(): Promise<(Conversation & { unreadCount?: number; lastMessage?: Message })[]> {
    const { data: convRows } = await this.supabase.getClient().from('conversations').select('*, users(*)').order('updated_at', { ascending: false });
    const convs = mapRowsToCamel<Conversation>(convRows || []);
    const result: (Conversation & { unreadCount?: number; lastMessage?: Message })[] = [];
    const client = this.supabase.getClient();
    for (const c of convs) {
      embedUsersAs(c as unknown as Record<string, unknown>, 'user');
      const { data: msgRows } = await client.from('messages').select('*, users!sender_id(*)').eq('conversation_id', c.id).order('created_at', { ascending: false }).limit(1);
      let lastMsg: Message | undefined;
      if (msgRows?.[0]) {
        lastMsg = mapRowToCamel<Message>(msgRows[0] as Record<string, unknown>)!;
        embedUsersAs(lastMsg as unknown as Record<string, unknown>, 'sender');
      }
      const { count } = await client.from('messages').select('*', { count: 'exact', head: true }).eq('conversation_id', c.id).is('read_at', null).neq('sender_id', c.userId);
      result.push({ ...c, unreadCount: count ?? 0, lastMessage: lastMsg ?? undefined });
    }
    return result;
  }

  async getMessages(conversationId: string, userId: string, isAdmin: boolean): Promise<Message[]> {
    const { data: convRow } = await this.supabase.getClient().from('conversations').select('*').eq('id', conversationId).maybeSingle();
    if (!convRow) throw new NotFoundException('Conversation not found');
    const conv = mapRowToCamel<Conversation>(convRow as Record<string, unknown>)!;
    if (!isAdmin && conv.userId !== userId) throw new ForbiddenException('Access denied');
    const { data: rows } = await this.supabase.getClient().from('messages').select('*, users!sender_id(*)').eq('conversation_id', conversationId).order('created_at', { ascending: true });
    const messages = mapRowsToCamel<Message>(rows || []);
    for (const m of messages) {
      embedUsersAs(m as unknown as Record<string, unknown>, 'sender');
    }
    return messages;
  }

  async sendMessage(conversationId: string, senderId: string, body: string): Promise<Message> {
    const client = this.supabase.getClient();
    const { data: convRow } = await client.from('conversations').select('*').eq('id', conversationId).maybeSingle();
    if (!convRow) throw new NotFoundException('Conversation not found');
    const conv = mapRowToCamel<Conversation>(convRow as Record<string, unknown>)!;
    const ins = mapPayloadToSnake({ conversationId, senderId, body: body.trim() });
    const { data: saved, error } = await client.from('messages').insert(ins).select().single();
    if (error || !saved) throw new Error(error?.message || 'Failed to send message');
    await client.from('conversations').update(mapPayloadToSnake({ updatedAt: new Date() })).eq('id', conversationId);
    const { data: senderRow } = await client.from('users').select('role').eq('id', senderId).maybeSingle();
    const senderRole = (senderRow as { role?: string } | null)?.role;
    const trimmed = body.trim();
    if (senderRole === 'superadmin') {
      await this.notificationsService
        .create(conv.userId, 'new_message', 'New message from support', {
          body: trimmed.slice(0, 100) + (trimmed.length > 100 ? '…' : ''),
          link: '/support',
        })
        .catch(() => {});
      const { data: recipientRow } = await client.from('users').select('email').eq('id', conv.userId).maybeSingle();
      const email = (recipientRow as { email?: string } | null)?.email;
      if (email) {
        await this.mailerService.sendNewMessageFromSupportEmail(email, trimmed).catch(() => {});
      }
    } else if (senderRole) {
      const { data: admins } = await client.from('users').select('id').eq('role', 'superadmin');
      const preview = trimmed.slice(0, 120) + (trimmed.length > 120 ? '…' : '');
      for (const row of admins || []) {
        const aid = (row as { id: string }).id;
        await this.notificationsService
          .create(aid, 'new_message', 'New support message from user', { body: preview, link: '/admin/messages' })
          .catch(() => {});
      }
    }
    const msg = mapRowToCamel<Message>(saved as Record<string, unknown>)!;
    return msg;
  }

  async sendMessageByUser(userId: string, body: string): Promise<Message> {
    const conv = await this.getOrCreateConversationForUser(userId);
    return this.sendMessage(conv.id, userId, body);
  }

  async markAsRead(conversationId: string, readerId: string): Promise<void> {
    const client = this.supabase.getClient();
    const { data: rows } = await client.from('messages').select('id').eq('conversation_id', conversationId).neq('sender_id', readerId).is('read_at', null);
    if (rows?.length) {
      for (const r of rows) {
        await client.from('messages').update(mapPayloadToSnake({ readAt: new Date() })).eq('id', (r as any).id);
      }
    }
  }

  async createConversationAndSend(adminId: string, targetUserId: string, body: string): Promise<{ conversation: Conversation; message: Message }> {
    const { data: userRow } = await this.supabase.getClient().from('users').select('id').eq('id', targetUserId).maybeSingle();
    if (!userRow) throw new NotFoundException('User not found');
    const conversation = await this.getOrCreateConversationForUser(targetUserId);
    const message = await this.sendMessage(conversation.id, adminId, body);
    return { conversation, message };
  }

  async getUnreadCountForUser(userId: string): Promise<number> {
    const { data: convRow } = await this.supabase.getClient().from('conversations').select('id').eq('user_id', userId).maybeSingle();
    if (!convRow) return 0;
    const cid = (convRow as any).id;
    const { count } = await this.supabase.getClient().from('messages').select('*', { count: 'exact', head: true }).eq('conversation_id', cid).neq('sender_id', userId).is('read_at', null);
    return count ?? 0;
  }
}
