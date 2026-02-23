import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Notification } from './notification.entity';

export type NotificationType = 'approval' | 'rejection' | 'new_message' | 'system';

@Injectable()
export class NotificationsService {
  constructor(
    @InjectRepository(Notification)
    private notificationRepository: Repository<Notification>,
  ) {}

  create(
    userId: string,
    type: NotificationType,
    title: string,
    options?: { body?: string; link?: string },
  ): Promise<Notification> {
    const n = this.notificationRepository.create({
      userId,
      type,
      title,
      body: options?.body ?? null,
      link: options?.link ?? null,
    });
    return this.notificationRepository.save(n);
  }

  async listForUser(userId: string, limit = 50): Promise<Notification[]> {
    return this.notificationRepository.find({
      where: { userId },
      order: { createdAt: 'DESC' },
      take: limit,
    });
  }

  async markAsRead(notificationId: string, userId: string): Promise<void> {
    const n = await this.notificationRepository.findOne({
      where: { id: notificationId, userId },
    });
    if (!n) throw new NotFoundException('Notification not found');
    n.readAt = new Date();
    await this.notificationRepository.save(n);
  }

  async markAllAsRead(userId: string): Promise<void> {
    await this.notificationRepository
      .createQueryBuilder()
      .update(Notification)
      .set({ readAt: new Date() })
      .where('user_id = :userId', { userId })
      .andWhere('read_at IS NULL')
      .execute();
  }

  async getUnreadCount(userId: string): Promise<number> {
    return this.notificationRepository
      .createQueryBuilder('n')
      .where('n.user_id = :userId', { userId })
      .andWhere('n.read_at IS NULL')
      .getCount();
  }
}
