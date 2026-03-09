import { Injectable, NotFoundException } from '@nestjs/common';
import { Notification } from './notification.entity';
import { SupabaseService } from '../supabase/supabase.service';
import { mapRowToCamel, mapRowsToCamel, mapPayloadToSnake } from '../../common/utils/db-mapper';

export type NotificationType = 'approval' | 'rejection' | 'new_message' | 'system';

@Injectable()
export class NotificationsService {
  constructor(private readonly supabase: SupabaseService) {}

  async create(
    userId: string,
    type: NotificationType,
    title: string,
    options?: { body?: string; link?: string },
  ): Promise<Notification> {
    const ins = mapPayloadToSnake({
      userId,
      type,
      title,
      body: options?.body ?? null,
      link: options?.link ?? null,
    });
    const { data: saved, error } = await this.supabase.getClient().from('notifications').insert(ins).select().single();
    if (error || !saved) throw new Error(error?.message || 'Insert failed');
    return mapRowToCamel<Notification>(saved as Record<string, unknown>)!;
  }

  async listForUser(userId: string, limit = 50): Promise<Notification[]> {
    const { data: rows } = await this.supabase
      .getClient()
      .from('notifications')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(limit);
    return mapRowsToCamel<Notification>(rows || []);
  }

  async markAsRead(notificationId: string, userId: string): Promise<void> {
    const { data: row } = await this.supabase.getClient().from('notifications').select('id').eq('id', notificationId).eq('user_id', userId).maybeSingle();
    if (!row) throw new NotFoundException('Notification not found');
    await this.supabase.getClient().from('notifications').update(mapPayloadToSnake({ readAt: new Date() })).eq('id', notificationId);
  }

  async markAllAsRead(userId: string): Promise<void> {
    await this.supabase.getClient().from('notifications').update(mapPayloadToSnake({ readAt: new Date() })).eq('user_id', userId).is('read_at', null);
  }

  async getUnreadCount(userId: string): Promise<number> {
    const { count } = await this.supabase.getClient().from('notifications').select('*', { count: 'exact', head: true }).eq('user_id', userId).is('read_at', null);
    return count ?? 0;
  }
}
