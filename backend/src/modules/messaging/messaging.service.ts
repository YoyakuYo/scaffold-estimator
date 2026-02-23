import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Conversation } from './conversation.entity';
import { Message } from './message.entity';
import { User } from '../auth/user.entity';
import { NotificationsService } from '../notifications/notifications.service';
import { MailerService } from '../mailer/mailer.service';

@Injectable()
export class MessagingService {
  constructor(
    @InjectRepository(Conversation)
    private conversationRepository: Repository<Conversation>,
    @InjectRepository(Message)
    private messageRepository: Repository<Message>,
    @InjectRepository(User)
    private userRepository: Repository<User>,
    private notificationsService: NotificationsService,
    private mailerService: MailerService,
  ) {}

  /** Get or create the conversation for a user (each user has one conversation with admin). */
  async getOrCreateConversationForUser(userId: string): Promise<Conversation> {
    let conv = await this.conversationRepository.findOne({ where: { userId } });
    if (!conv) {
      conv = this.conversationRepository.create({ userId });
      conv = await this.conversationRepository.save(conv);
    }
    return conv;
  }

  /** Get conversation for the current user (for /messages page). */
  async getMyConversation(userId: string): Promise<Conversation | null> {
    return this.conversationRepository.findOne({
      where: { userId },
      relations: ['user'],
    });
  }

  /** List all conversations (admin). */
  async getAllConversations(): Promise<(Conversation & { unreadCount?: number; lastMessage?: Message })[]> {
    const convs = await this.conversationRepository.find({
      relations: ['user'],
      order: { updatedAt: 'DESC' },
    });
    const result = [];
    for (const c of convs) {
      const lastMsg = await this.messageRepository.findOne({
        where: { conversationId: c.id },
        order: { createdAt: 'DESC' },
        relations: ['sender'],
      });
      // Unread for admin = messages sent by user (not admin) that are unread
      const unreadFromUser = await this.messageRepository
        .createQueryBuilder('m')
        .innerJoin('users', 'u', 'u.id = m.sender_id')
        .where('m.conversation_id = :cid', { cid: c.id })
        .andWhere('m.read_at IS NULL')
        .andWhere('u.role NOT IN (:...adminRoles)', { adminRoles: ['admin', 'superadmin'] })
        .getCount();
      result.push({
        ...c,
        unreadCount: unreadFromUser,
        lastMessage: lastMsg || undefined,
      });
    }
    return result;
  }

  /** Get messages in a conversation. */
  async getMessages(conversationId: string, userId: string, isAdmin: boolean): Promise<Message[]> {
    const conv = await this.conversationRepository.findOne({
      where: { id: conversationId },
      relations: ['user'],
    });
    if (!conv) throw new NotFoundException('Conversation not found');
    if (!isAdmin && conv.userId !== userId) throw new ForbiddenException('Access denied');
    return this.messageRepository.find({
      where: { conversationId },
      relations: ['sender'],
      order: { createdAt: 'ASC' },
    });
  }

  /** Send a message. */
  async sendMessage(
    conversationId: string,
    senderId: string,
    body: string,
  ): Promise<Message> {
    const conv = await this.conversationRepository.findOne({ where: { id: conversationId } });
    if (!conv) throw new NotFoundException('Conversation not found');
    const msg = this.messageRepository.create({
      conversationId,
      senderId,
      body: body.trim(),
    });
    const saved = await this.messageRepository.save(msg);
    conv.updatedAt = new Date();
    await this.conversationRepository.save(conv);
    const sender = await this.userRepository.findOne({ where: { id: senderId } });
    if (sender?.role === 'admin' || sender?.role === 'superadmin') {
      await this.notificationsService
        .create(conv.userId, 'new_message', 'New message from support', {
          body: body.trim().slice(0, 100) + (body.length > 100 ? '…' : ''),
          link: '/support',
        })
        .catch(() => {});
      const recipient = await this.userRepository.findOne({ where: { id: conv.userId } });
      if (recipient?.email) {
        await this.mailerService
          .sendNewMessageFromSupportEmail(recipient.email, body.trim())
          .catch(() => {});
      }
    }
    return this.messageRepository.findOne({
      where: { id: saved.id },
      relations: ['sender'],
    }) as Promise<Message>;
  }

  /** User or admin sends message in their conversation. User: use getOrCreateConversation. */
  async sendMessageByUser(userId: string, body: string): Promise<Message> {
    const conv = await this.getOrCreateConversationForUser(userId);
    return this.sendMessage(conv.id, userId, body);
  }

  /** Mark messages in a conversation as read (by the reader, i.e. messages not sent by them). */
  async markAsRead(conversationId: string, readerId: string): Promise<void> {
    await this.messageRepository
      .createQueryBuilder()
      .update(Message)
      .set({ readAt: new Date() })
      .where('conversation_id = :cid', { cid: conversationId })
      .andWhere('sender_id != :readerId', { readerId })
      .andWhere('read_at IS NULL')
      .execute();
  }

  /** Unread count for a user: messages in their conversation that they didn't send and aren't read. */
  async getUnreadCountForUser(userId: string): Promise<number> {
    const conv = await this.conversationRepository.findOne({ where: { userId } });
    if (!conv) return 0;
    return this.messageRepository
      .createQueryBuilder('m')
      .where('m.conversation_id = :cid', { cid: conv.id })
      .andWhere('m.sender_id != :uid', { uid: userId })
      .andWhere('m.read_at IS NULL')
      .getCount();
  }
}
