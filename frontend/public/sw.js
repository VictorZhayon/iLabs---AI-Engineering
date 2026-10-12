const CACHE_NAME = 'codesense-cache-v2';
const PRECACHE_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/favicon.svg',
  '/icon-192x192.jpg',
  '/icon-512x512.jpg'
];

// Install: precache core shell assets
self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return cache.addAll(PRECACHE_ASSETS).catch(err => {
        console.warn('Pre-caching some assets failed:', err);
      });
    })
  );
});

// Activate: clean up obsolete caches and claim clients immediately
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (cacheName !== CACHE_NAME) {
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// Fetch: only intercept GET requests for http/https
self.addEventListener('fetch', event => {
  const request = event.request;

  // Never intercept non-GET requests (Cache API does NOT support POST/PUT/DELETE)
  if (request.method !== 'GET') {
    return;
  }

  const url = new URL(request.url);

  // Bypass API endpoints, auth endpoints, Vite dev server endpoints, and extensions
  if (
    url.pathname.startsWith('/api') ||
    url.hostname.includes('identitytoolkit.googleapis.com') ||
    url.hostname.includes('securetoken.googleapis.com') ||
    url.hostname.includes('firebase') ||
    url.hostname.includes('googleapis.com') ||
    url.pathname.includes('/@vite/') ||
    url.pathname.includes('/@fs/') ||
    request.url.startsWith('chrome-extension')
  ) {
    return;
  }

  // Network-first for HTML pages to ensure updates are fetched immediately
  if (request.mode === 'navigate' || (request.headers.get('accept') && request.headers.get('accept').includes('text/html'))) {
    event.respondWith(
      fetch(request)
        .then(response => {
          if (response && response.status === 200) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => caches.match(request).then(cached => cached || caches.match('/index.html')))
    );
    return;
  }

  // Cache-first for static assets (images, icons, fonts)
  event.respondWith(
    caches.match(request).then(cachedResponse => {
      if (cachedResponse) {
        return cachedResponse;
      }
      return fetch(request).then(networkResponse => {
        if (!networkResponse || networkResponse.status !== 200 || networkResponse.type !== 'basic') {
          return networkResponse;
        }
        const responseToCache = networkResponse.clone();
        caches.open(CACHE_NAME).then(cache => {
          cache.put(request, responseToCache);
        });
        return networkResponse;
      });
    })
  );
});
