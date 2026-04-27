import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  Logger,
  InternalServerErrorException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { promises as fs } from 'fs';
import * as path from 'path';
import { Conversation } from './conversation.entity';
import { Message } from './message.entity';
import { NotificationsService } from '../notifications/notifications.service';
import { MailerService } from '../mailer/mailer.service';
import { SupabaseService } from '../supabase/supabase.service';
import { mapRowToCamel, mapRowsToCamel, mapPayloadToSnake } from '../../common/utils/db-mapper';
import { LANDING_CONTACT_USER_EMAIL } from '../../common/constants/system-users';

@Injectable()
export class MessagingService {
  private readonly logger = new Logger(MessagingService.name);

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
    const { data: row, error } = await this.supabase
      .getClient()
      .from('conversations')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle();
    if (error) {
      this.logger.error(`getMyConversation Supabase: ${error.message}`);
      throw new InternalServerErrorException('Failed to load conversation');
    }
    if (!row) return null;
    return mapRowToCamel<Conversation>(row as Record<string, unknown>)!;
  }

  async getAllConversations(): Promise<(Conversation & { unreadCount?: number; lastMessage?: Message; user?: Record<string, unknown> })[]> {
    const client = this.supabase.getClient();
    const { data: convRows, error: convErr } = await client
      .from('conversations')
      .select('*')
      .order('updated_at', { ascending: false });
    if (convErr) {
      this.logger.error(`getAllConversations list: ${convErr.message}`);
      throw new InternalServerErrorException('Failed to load conversations');
    }
    const convs = mapRowsToCamel<Conversation>(convRows || []);
    const userIds = [...new Set(convs.map((c) => c.userId).filter(Boolean))];
    const userById = new Map<string, Record<string, unknown>>();
    if (userIds.length > 0) {
      const { data: userRows, error: usersErr } = await client
        .from('users')
        .select('id, email, first_name, last_name, role')
        .in('id', userIds);
      if (usersErr) {
        this.logger.error(`getAllConversations users: ${usersErr.message}`);
        throw new InternalServerErrorException('Failed to load conversation users');
      }
      for (const u of userRows || []) {
        const camel = mapRowToCamel(u as Record<string, unknown>);
        if (!camel) continue;
        const id = (camel as { id?: string }).id;
        if (id) userById.set(id, camel as Record<string, unknown>);
      }
    }
    const result: (Conversation & { unreadCount?: number; lastMessage?: Message; user?: Record<string, unknown> })[] = [];
    for (const c of convs) {
      const user = userById.get(c.userId);
      const { data: msgRows, error: msgErr } = await client
        .from('messages')
        .select('*')
        .eq('conversation_id', c.id)
        .order('created_at', { ascending: false })
        .limit(1);
      if (msgErr) {
        this.logger.error(`getAllConversations lastMessage: ${msgErr.message}`);
        throw new InternalServerErrorException('Failed to load messages');
      }
      let lastMsg: Message | undefined;
      if (msgRows?.[0]) {
        lastMsg = mapRowToCamel<Message>(msgRows[0] as Record<string, unknown>)!;
      }
      // Admin "unread" = inbound from the account owner (not own outgoing messages).
      const { count } = await client
        .from('messages')
        .select('*', { count: 'exact', head: true })
        .eq('conversation_id', c.id)
        .eq('sender_id', c.userId)
        .is('read_at', null);
      result.push({
        ...c,
        user,
        unreadCount: count ?? 0,
        lastMessage: lastMsg ?? undefined,
      } as Conversation & {
        unreadCount?: number;
        lastMessage?: Message;
        user?: Record<string, unknown>;
      });
    }
    return result;
  }

  async getMessages(conversationId: string, userId: string, isAdmin: boolean): Promise<Message[]> {
    const { data: convRow } = await this.supabase.getClient().from('conversations').select('*').eq('id', conversationId).maybeSingle();
    if (!convRow) throw new NotFoundException('Conversation not found');
    const conv = mapRowToCamel<Conversation>(convRow as Record<string, unknown>)!;
    if (!isAdmin && conv.userId !== userId) throw new ForbiddenException('Access denied');
    const { data: rows, error } = await this.supabase
      .getClient()
      .from('messages')
      .select('*')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: true });
    if (error) {
      this.logger.error(`getMessages Supabase: ${error.message}`);
      throw new InternalServerErrorException('Failed to load messages');
    }
    return mapRowsToCamel<Message>(rows || []);
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

  /** Synthetic inbox user for marketing-site contact form (not for login). */
  private async getLandingContactUserId(): Promise<string | null> {
    const { data } = await this.supabase
      .getClient()
      .from('users')
      .select('id')
      .eq('email', LANDING_CONTACT_USER_EMAIL)
      .maybeSingle();
    return ((data as { id?: string } | null)?.id ?? null) || null;
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

  /**
   * Public marketing-site contact: emails superadmin addresses and creates in-app notifications
   * (visible in the superadmin notification bell; full text also in email).
   * Fails the request if nothing could be delivered (misconfiguration or DB error).
   */
  async submitPublicContact(
    name: string,
    email: string,
    message: string,
    honeypot?: string,
    file?: Express.Multer.File,
  ): Promise<{ ok: boolean; inAppDelivered: boolean; emailSent: boolean }> {
    if (honeypot?.trim()) {
      this.logger.warn(
        'Public contact rejected: honeypot field was filled (often accidental if the field was named `company` in browser autofill).',
      );
      return { ok: true, inAppDelivered: false, emailSent: false };
    }
    const trimmedName = name.trim();
    const trimmedEmail = email.trim();
    const trimmedMessage = message.trim();

    let mailAttachment: { filename: string; content: Buffer } | undefined;
    let inboxMessageBody = trimmedMessage;
    if (file?.buffer?.length) {
      const ext = path.extname(file.originalname || '').slice(0, 12) || '.bin';
      const safe = `${randomUUID()}${ext}`;
      const dir = path.join(process.cwd(), 'uploads', 'landing-contact');
      await fs.mkdir(dir, { recursive: true });
      const fullPath = path.join(dir, safe);
      await fs.writeFile(fullPath, file.buffer);
      mailAttachment = {
        filename: (file.originalname || safe).slice(0, 200),
        content: file.buffer,
      };
      inboxMessageBody = [
        trimmedMessage,
        '',
        `[Uploaded plan file: ${file.originalname || safe}]`,
        `[File ID: ${safe} — superadmin download: GET /api/v1/messages/admin/landing-contact-files/${safe}]`,
      ].join('\n');
    }
    const client = this.supabase.getClient();
    const { data: admins, error } = await client.from('users').select('id, email').eq('role', 'superadmin');
    if (error) {
      this.logger.error(`submitPublicContact list superadmins: ${error.message}`);
      throw new InternalServerErrorException('Could not deliver message');
    }
    if (!admins?.length) {
      this.logger.error(
        'submitPublicContact: no users with role superadmin — landing contact cannot be delivered. Add one in the database.',
      );
      throw new ServiceUnavailableException(
        'Contact is temporarily unavailable. Please try again later or reach us by email.',
      );
    }
    const preview = inboxMessageBody.slice(0, 200) + (inboxMessageBody.length > 200 ? '…' : '');
    const emailed = new Set<string>();
    let inAppDelivered = 0;
    let emailSent = false;

    const landingUserId = await this.getLandingContactUserId();
    if (landingUserId) {
      try {
        const conv = await this.getOrCreateConversationForUser(landingUserId);
        const inboxBody = [
          '[Landing page contact]',
          `Name: ${trimmedName}`,
          `Email: ${trimmedEmail}`,
          '',
          inboxMessageBody,
        ].join('\n');
        await this.sendMessage(conv.id, landingUserId, inboxBody);
        inAppDelivered = 1;
      } catch (e) {
        this.logger.error(`submitPublicContact inbox message: ${(e as Error)?.message}`);
      }
    } else {
      this.logger.warn(
        `submitPublicContact: no user ${LANDING_CONTACT_USER_EMAIL} — run migration 131_landing_contact_inbox_user.sql; using notification bell only.`,
      );
    }

    if (inAppDelivered === 0) {
      for (const row of admins) {
        const aid = (row as { id: string }).id;
        try {
          await this.notificationsService.create(aid, 'system', 'Landing page contact', {
            body: `${trimmedName} · ${trimmedEmail}: ${preview}`,
            link: '/admin/messages',
          });
          inAppDelivered += 1;
        } catch (e) {
          this.logger.error(`submitPublicContact notification for ${aid}: ${(e as Error)?.message}`);
        }
      }
    }

    for (const row of admins) {
      const adminEmail = ((row as { email?: string }).email || '').trim();
      if (adminEmail && !emailed.has(adminEmail.toLowerCase())) {
        emailed.add(adminEmail.toLowerCase());
        const sent = await this.mailerService.sendLandingContactEmail(
          adminEmail,
          trimmedName,
          trimmedEmail,
          trimmedMessage,
          mailAttachment,
        );
        if (sent) emailSent = true;
      }
    }

    if (inAppDelivered === 0 && !emailSent) {
      this.logger.error(
        'submitPublicContact: no in-app notifications and no email — check notifications table and email env (BREVO_API_KEY + SMTP_FROM, etc.).',
      );
      throw new ServiceUnavailableException(
        'Could not deliver your message. Please try again later or contact us directly by email.',
      );
    }

    this.logger.log(
      `Public contact delivered: inApp=${inAppDelivered} emailSent=${emailSent} admins=${admins.length}`,
    );
    return { ok: true, inAppDelivered: inAppDelivered > 0, emailSent };
  }
}
