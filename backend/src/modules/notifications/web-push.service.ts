import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as webpush from 'web-push';
import { SupabaseService } from '../supabase/supabase.service';
import { mapPayloadToSnake } from '../../common/utils/db-mapper';
import { PushSubscribeDto } from './dto/push-subscribe.dto';

@Injectable()
export class WebPushService implements OnModuleInit {
  private readonly logger = new Logger(WebPushService.name);
  private enabled = false;

  constructor(
    private readonly configService: ConfigService,
    private readonly supabase: SupabaseService,
  ) {}

  onModuleInit() {
    const publicKey = this.configService.get<string>('VAPID_PUBLIC_KEY')?.trim();
    const privateKey = this.configService.get<string>('VAPID_PRIVATE_KEY')?.trim();
    const subject =
      this.configService.get<string>('VAPID_SUBJECT')?.trim() || 'mailto:noreply@localhost';

    if (!publicKey || !privateKey) {
      this.logger.warn(
        'Web Push disabled: set VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY (generate with: npx web-push generate-vapid-keys)',
      );
      return;
    }

    webpush.setVapidDetails(subject, publicKey, privateKey);
    this.enabled = true;
    this.logger.log('Web Push (VAPID) configured');
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  /** Safe to expose; paired with private VAPID key on the server. */
  getPublicKey(): string | null {
    const publicKey = this.configService.get<string>('VAPID_PUBLIC_KEY')?.trim();
    return publicKey || null;
  }

  async saveSubscription(userId: string, dto: PushSubscribeDto, userAgent?: string): Promise<void> {
    const client = this.supabase.getClient();
    const row = mapPayloadToSnake({
      userId,
      endpoint: dto.endpoint,
      p256dh: dto.keys.p256dh,
      auth: dto.keys.auth,
      userAgent: userAgent?.slice(0, 512) ?? null,
      updatedAt: new Date(),
    });
    const { error } = await client.from('push_subscriptions').upsert(row, { onConflict: 'endpoint' });
    if (error) {
      this.logger.error(`push_subscriptions upsert: ${error.message}`);
      throw new Error(error.message);
    }
  }

  /** Fire-and-forget safe: logs errors, removes dead subscriptions. */
  async notifyUser(userId: string, payload: { title: string; body?: string; link?: string }): Promise<void> {
    if (!this.enabled) return;

    const client = this.supabase.getClient();
    const { data: rows, error } = await client.from('push_subscriptions').select('*').eq('user_id', userId);
    if (error || !rows?.length) {
      if (error) this.logger.warn(`notifyUser load subs: ${error.message}`);
      return;
    }

    const data = JSON.stringify({
      title: payload.title,
      body: payload.body ?? '',
      url: payload.link || '/',
    });

    for (const row of rows) {
      const r = row as Record<string, unknown>;
      const subscription = {
        endpoint: r.endpoint as string,
        keys: {
          p256dh: r.p256dh as string,
          auth: r.auth as string,
        },
      };
      try {
        await webpush.sendNotification(subscription, data, { TTL: 86_400 });
      } catch (err: unknown) {
        const statusCode = err && typeof err === 'object' && 'statusCode' in err ? (err as { statusCode: number }).statusCode : 0;
        if (statusCode === 404 || statusCode === 410) {
          await client.from('push_subscriptions').delete().eq('endpoint', subscription.endpoint);
          this.logger.log(`Removed stale push subscription (endpoint gone)`);
        } else {
          this.logger.warn(`sendNotification failed: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    }
  }
}
