// Jewber's service worker: makes the page installable (Home Screen on iPhone, install on
// Android Chrome) and shows ride notifications. Nothing is cached: rides only make sense live.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => {});

self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch {}
  e.waitUntil(self.registration.showNotification(d.title || 'Jewber', {
    body: d.body || '',
    tag: d.tag || 'jewber',
    renotify: true,
    icon: '/icons/icon-192.png',
    badge: '/icons/favicon.png',
    data: { url: d.url || '/' },
    requireInteraction: d.tag === 'request',
  }));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || '/';
  e.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of all) if ('focus' in c) return c.focus();
    return self.clients.openWindow(url);
  })());
});
