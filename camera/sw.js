const CACHE_NAME = 'ipcam-v1';
self.addEventListener('install', (e) => {
  self.skipWaiting();
});
self.addEventListener('activate', (e) => {
  e.waitUntil(clients.claim());
});
self.addEventListener('fetch', (e) => {
  // Pass-through to network for real-time WebRTC and signaling
  e.respondWith(fetch(e.request).catch(() => caches.match(e.request)));
});
