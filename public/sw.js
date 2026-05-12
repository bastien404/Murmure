// Service worker for Murmure — Web Push notifications

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = { title: 'Murmure', body: event.data ? event.data.text() : '' }; }

  const title = data.title || 'Murmure';
  const options = {
    body: data.body || 'Nouvelle activité',
    icon: '/android-chrome-192x192.png',
    badge: '/favicon-32x32.png',
    tag: data.type === 'call' ? 'murmure-call' : 'murmure',
    renotify: true,
    requireInteraction: data.type === 'call',
    vibrate: data.type === 'call' ? [200, 100, 200, 100, 200] : [80],
    data: { url: data.url || '/' }
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of all) {
      try {
        if (c.url.includes(target) || c.url.endsWith('/chat.html')) {
          await c.focus();
          return;
        }
      } catch {}
    }
    if (all.length) {
      try { await all[0].focus(); return; } catch {}
    }
    await self.clients.openWindow(target);
  })());
});
