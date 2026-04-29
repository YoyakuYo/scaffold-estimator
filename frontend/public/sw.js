/// Service Worker for PWA — 仮設材積算システム
const CACHE_NAME = 'scaffold-estimator-v8';
const STATIC_ASSETS = [
  '/',
  '/dashboard',
  '/scaffold',
  '/manifest.json',
  '/icons/icon-32x32.png',
  '/icons/icon-192x192.png',
  '/icons/icon-512x512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS).catch((err) => {
        console.warn('SW: Some assets failed to cache:', err);
      });
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('push', (event) => {
  let payload = { title: '仮設材積算', body: '', url: '/' };
  try {
    if (event.data) {
      const json = event.data.json();
      if (json.title) payload.title = String(json.title);
      if (json.body != null) payload.body = String(json.body);
      if (json.url) payload.url = String(json.url);
    }
  } catch (_) {
    try {
      const text = event.data && event.data.text();
      if (text) payload.body = text;
    } catch (_) {}
  }

  const url = payload.url.startsWith('http') ? payload.url : new URL(payload.url, self.location.origin).href;

  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body || undefined,
      icon: '/icons/icon-192x192.png',
      badge: '/icons/icon-72x72.png',
      tag: 'zoomen-notification',
      renotify: true,
      data: { url },
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const raw = event.notification.data && event.notification.data.url;
  const url = typeof raw === 'string' && raw.startsWith('http') ? raw : new URL(raw || '/', self.location.origin).href;
  let targetPath = '/';
  try {
    targetPath = new URL(url).pathname || '/';
  } catch (_) {}

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        try {
          if (new URL(client.url).pathname === targetPath && 'focus' in client) {
            return client.focus();
          }
        } catch (_) {}
      }
      for (const client of clientList) {
        if ('focus' in client) return client.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow(url);
    })
  );
});

self.addEventListener('fetch', (event) => {
  const reqUrl = new URL(event.request.url);

  if (event.request.method !== 'GET') return;
  if (reqUrl.pathname.startsWith('/api/')) return;

  // Do not cache HTML navigations. Caching + cache miss used to resolve to `undefined`
  // (when `/` was not in cache), which breaks refresh with a generic "page couldn't load".
  // Next.js App Router documents must always come from the network.
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request).catch(() => {
        return new Response(
          '<!DOCTYPE html><html><head><meta charset="utf-8"><title>Offline</title></head><body><p>Network error. Check your connection and reload.</p></body></html>',
          { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } },
        );
      }),
    );
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).then((response) => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return response;
      });
    })
  );
});
