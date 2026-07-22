/// <reference lib="webworker" />
/* sw.ts — Workbox service worker (injectManifest).
 * Precaches the app shell for offline use, runtime-caches OSM map tiles,
 * and focuses/opens the app when a local notification is tapped. */

import { precacheAndRoute, cleanupOutdatedCaches } from 'workbox-precaching';
import { registerRoute } from 'workbox-routing';
import { CacheFirst } from 'workbox-strategies';
import { ExpirationPlugin } from 'workbox-expiration';
import { CacheableResponsePlugin } from 'workbox-cacheable-response';
import { clientsClaim } from 'workbox-core';

declare let self: ServiceWorkerGlobalScope & { __WB_MANIFEST: Array<{ url: string; revision: string | null }> };

self.skipWaiting();
clientsClaim();

cleanupOutdatedCaches();
precacheAndRoute(self.__WB_MANIFEST);

// OpenStreetMap tiles — cache-first with a bounded, expiring cache.
registerRoute(
  ({ url }) => url.hostname.endsWith('tile.openstreetmap.org'),
  new CacheFirst({
    cacheName: 'osm-tiles',
    plugins: [
      new CacheableResponsePlugin({ statuses: [0, 200] }),
      new ExpirationPlugin({ maxEntries: 500, maxAgeSeconds: 30 * 24 * 60 * 60 }),
    ],
  }),
);

// Tapping a local notification focuses an already-open tab if there is one,
// otherwise opens a fresh one at the app root.
self.addEventListener('notificationclick', (event: Event) => {
  const e = event as Event & { notification: { close(): void }; waitUntil(p: Promise<unknown>): void };
  e.notification.close();
  e.waitUntil(focusOrOpen());
});

async function focusOrOpen(): Promise<void> {
  const clients = await self.clients.matchAll({ includeUncontrolled: true, type: 'window' });
  for (const c of clients) {
    if ('focus' in c) { await (c as WindowClient).focus(); return; }
  }
  await self.clients.openWindow('/');
}
