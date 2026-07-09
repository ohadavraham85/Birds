/* sw.js — service worker: מטמון קבצי האפליקציה לעבודה מלאה ללא רשת בשטח.
 * אסטרטגיה: cache-first לקבצי האפליקציה, network-first ל-index.html
 * (כדי לקבל עדכוני גרסה), ורשת בלבד לבקשות חוצות-דומיין (Google APIs, מפות).
 */

const CACHE = 'birds-app-v1';

const APP_SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/app.css',
  './js/app.js',
  './js/db.js',
  './js/drive.js',
  './js/ui.js',
  './js/csv.js',
  './js/pdf.js',
  './js/markdown.js',
  './js/species-seed.js',
  './js/views/form.js',
  './js/views/map.js',
  './js/views/table.js',
  './js/views/cards.js',
  './js/views/settings.js',
  './vendor/leaflet/leaflet.js',
  './vendor/leaflet/leaflet.css',
  './vendor/leaflet/images/marker-icon.png',
  './vendor/leaflet/images/marker-icon-2x.png',
  './vendor/leaflet/images/marker-shadow.png',
  './vendor/html2pdf/html2pdf.bundle.min.js',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(APP_SHELL)).then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET') return;

  // cross-origin (Google APIs, OSM tiles, GIS) — network only
  if (url.origin !== location.origin) return;

  // navigation / index: network-first so new versions land, cache fallback offline
  if (event.request.mode === 'navigate' || url.pathname.endsWith('/index.html')) {
    event.respondWith(
      fetch(event.request)
        .then((resp) => {
          const copy = resp.clone();
          caches.open(CACHE).then((c) => c.put('./index.html', copy));
          return resp;
        })
        .catch(() => caches.match('./index.html')),
    );
    return;
  }

  // everything else same-origin: cache-first
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).then((resp) => {
        if (resp.ok) {
          const copy = resp.clone();
          caches.open(CACHE).then((c) => c.put(event.request, copy));
        }
        return resp;
      });
    }),
  );
});
