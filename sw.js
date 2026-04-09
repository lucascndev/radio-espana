const CACHE_NAME = 'radio-espana-v2';
const ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/icon-152.png',
  '/icon-180.png',
  '/icon-192.png',
  '/icon-512.png',
  '/logos/cadena_ser.png',
  '/logos/cope.png',
  '/logos/marca.png',
  '/logos/ondacero.svg',
  '/logos/los40.png',
  '/logos/RNE_2026.svg.png',
  'https://cdn.jsdelivr.net/npm/hls.js@latest'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keyList) => {
      return Promise.all(keyList.map((key) => {
        if (key !== CACHE_NAME) {
          return caches.delete(key);
        }
      }));
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  // Discard stream requests from cache
  if (e.request.url.includes('.mp3') || e.request.url.includes('.m3u8') || e.request.url.includes('.aac') || e.request.url.includes('stream')) {
    return;
  }

  e.respondWith(
    caches.match(e.request).then((response) => {
      // Return cached version or fetch from network
      return response || fetch(e.request).catch(() => {
        // Fallback for offline if it fails
      });
    })
  );
});
