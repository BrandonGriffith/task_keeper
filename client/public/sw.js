self.addEventListener('push', (event) => {
  if (!event.data) return;
  let payload;
  try {
    payload = event.data.json();
  } catch (error) {
    console.error('Invalid push notification payload', error);
    return;
  }
  if (!payload || typeof payload.title !== 'string') return;
  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      data: { url: payload.url || '/' },
      icon: '/icon.svg',
      badge: '/icon.svg',
      ...(payload.tag ? { tag: payload.tag } : {}),
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.url || '/';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
      const current = windows.find((window) => window.url.startsWith(self.location.origin));
      return current ? current.focus() : clients.openWindow(url);
    }),
  );
});
