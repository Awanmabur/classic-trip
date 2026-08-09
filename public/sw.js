const STATIC_CACHE = 'classic-trip-static-v1.6.33';
const STATIC_ASSETS = [
  '/site.webmanifest',
  '/images/favicon-48.png',
  '/images/logo-symbol-128.png',
  '/images/logo-symbol-192.png',
  '/images/logo-symbol-512.png',
  '/images/launch-lockup-192.png',
  '/images/launch-lockup-512.png',
  '/images/apple-touch-icon.png',
  '/css/base.css',
  '/css/components.css',
  '/css/pages/home.css',
  '/css/four-service-ui.css',
  '/css/completion-fixes.css',
  '/css/marketing-responsive.css',
  '/css/accessibility-safe.css',
  '/css/pwa.css',
  '/js/main.js',
  '/js/home.js',
  '/js/site-header.js',
  '/js/home-service-search.js',
  '/js/auth-page.js',
  '/js/mobile-navigation.js',
  '/js/pwa.js'
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(STATIC_CACHE).then((cache) => cache.addAll(STATIC_ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key.startsWith('classic-trip-static-') && key !== STATIC_CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  const isStatic = ['/css/', '/js/', '/images/'].some((prefix) => url.pathname.startsWith(prefix)) || url.pathname === '/site.webmanifest';
  if (!isStatic) return;

  event.respondWith(
    caches.match(request).then((cached) => {
      const network = fetch(request).then((response) => {
        if (response && response.ok) {
          const copy = response.clone();
          caches.open(STATIC_CACHE).then((cache) => cache.put(request, copy));
        }
        return response;
      }).catch(() => cached || Response.error());
      return cached || network;
    })
  );
});

self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (error) { data = { message: event.data ? event.data.text() : '' }; }
  const title = data.title || 'Classic Trip update';
  const options = {
    body: data.message || data.body || '',
    icon: '/images/logo-symbol-192.png',
    badge: '/images/logo-symbol-192.png',
    data: { url: data.url || '/account' },
    tag: data.referenceId || 'classic-trip-notification',
    renotify: false,
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = event.notification.data && event.notification.data.url ? event.notification.data.url : '/account';
  event.waitUntil(clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
    for (const client of clientList) {
      if ('focus' in client) {
        client.navigate(targetUrl);
        return client.focus();
      }
    }
    return clients.openWindow(targetUrl);
  }));
});
