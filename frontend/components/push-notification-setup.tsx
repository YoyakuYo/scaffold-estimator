'use client';

import { useEffect, useRef } from 'react';
import { ensureWebPushSubscription } from '@/lib/web-push-register';

/**
 * After login, registers Web Push so installed PWAs receive system notifications.
 * Safe no-op if VAPID is not configured, Push unsupported, or permission denied.
 */
export function PushNotificationSetup({ enabled }: { enabled: boolean }) {
  const ran = useRef(false);

  useEffect(() => {
    if (!enabled || ran.current) return;
    ran.current = true;

    const t = window.setTimeout(() => {
      void ensureWebPushSubscription();
    }, 1500);

    return () => window.clearTimeout(t);
  }, [enabled]);

  return null;
}
