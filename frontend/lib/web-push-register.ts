import apiClient from './api/client';

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

/**
 * Registers this browser/PWA for push notifications (requires VAPID keys on API).
 * Uses NEXT_PUBLIC_VAPID_PUBLIC_KEY if set; otherwise GET /notifications/push/vapid-public-key.
 */
export async function ensureWebPushSubscription(): Promise<boolean> {
  if (typeof window === 'undefined') return false;
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return false;

  let publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY?.trim();
  if (!publicKey) {
    try {
      const res = await apiClient.get<{ publicKey: string | null }>('/notifications/push/vapid-public-key');
      publicKey = res.data.publicKey?.trim() || '';
    } catch {
      return false;
    }
  }
  if (!publicKey) return false;

  const perm = Notification.permission;
  if (perm === 'denied') return false;
  if (perm === 'default') {
    const asked = await Notification.requestPermission();
    if (asked !== 'granted') return false;
  }

  const reg = await navigator.serviceWorker.ready;

  let sub = await reg.pushManager.getSubscription();
  try {
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey) as BufferSource,
      });
    }
  } catch (e) {
    console.warn('Web Push subscribe failed:', e);
    return false;
  }

  const json = sub.toJSON();
  if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) return false;

  try {
    await apiClient.post('/notifications/push/subscribe', {
      endpoint: json.endpoint,
      keys: { p256dh: json.keys.p256dh, auth: json.keys.auth },
      expirationTime: json.expirationTime ?? null,
    });
  } catch (e) {
    console.warn('Web Push register on server failed:', e);
    return false;
  }

  return true;
}
