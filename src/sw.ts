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
import { SHARE_TARGET_CACHE, SHARE_TARGET_FIELD, SHARE_TARGET_HASH } from './lib/share-target';

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

// OS "share" sheet target (see manifest's share_target in vite.config.ts) —
// selecting photos in the phone's own Gallery app and sharing them into this
// app POSTs them here. Only a service worker can read a share-target POST
// body, so the files are stashed into the Cache API and the client (see
// lib/share-target's counterpart in gallery.ts) picks them up after the
// redirect reloads the app.
self.addEventListener('fetch', (event: FetchEvent) => {
  const url = new URL(event.request.url);
  if (event.request.method === 'POST' && url.pathname.endsWith('/share-target')) {
    event.respondWith(handleShareTarget(event.request));
  }
});

async function handleShareTarget(request: Request): Promise<Response> {
  try {
    const formData = await request.formData();
    const files = formData.getAll(SHARE_TARGET_FIELD).filter((f): f is File => f instanceof File);
    const cache = await caches.open(SHARE_TARGET_CACHE);
    await Promise.all((await cache.keys()).map((k) => cache.delete(k)));
    await Promise.all(files.map((file, i) => cache.put(
      `/__share-target-file-${i}`,
      new Response(file, {
        headers: {
          'Content-Type': file.type || 'application/octet-stream',
          'X-Share-Name': encodeURIComponent(file.name || 'shared-image'),
          'X-Share-Last-Modified': String(file.lastModified || Date.now()),
        },
      }),
    )));
  } catch {
    /* malformed share payload — fall through to a plain redirect so the
     * share sheet doesn't hang; the client will just find nothing to import. */
  }
  return Response.redirect(self.registration.scope + SHARE_TARGET_HASH, 303);
}

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
