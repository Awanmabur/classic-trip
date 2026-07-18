self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (error) { data = { message: event.data ? event.data.text() : '' }; }
  const title = data.title || 'Classic Trip update';
  const options = {
    body: data.message || data.body || '',
    icon: '/images/classic-trip-icon.svg',
    badge: '/images/classic-trip-icon.svg',
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
