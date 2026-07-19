/* lib/media.ts — resolve an observation image to a displayable object URL.
 * Prefers the local blob; if it is missing but the image has a server copy
 * (remoteId) and a sync server is configured, it downloads and caches it. */

import { getMedia, saveMedia } from '../db/repository';
import { serverUrl, syncToken } from '../sync/sync-engine';
import { downloadMedia } from '../sync/api-client';
import type { ObservationImage } from '../types';

export async function getImageObjectUrl(img: ObservationImage, obsId = ''): Promise<string | null> {
  if (img?.localId) {
    const m = await getMedia(img.localId);
    if (m?.blob) return URL.createObjectURL(m.blob);
  }
  const remoteId = img?.remoteId || img?.localId;
  if (remoteId && navigator.onLine) {
    // Firebase Storage stamps a full download URL as remoteId; the Cloudflare
    // Worker instead uses an opaque id fetched via its own /api/media/:id.
    if (/^https?:\/\//.test(remoteId)) {
      try {
        const blob = await (await fetch(remoteId)).blob();
        await saveMedia({ id: img.localId || remoteId, obsId, name: img.name || '', mime: blob.type, blob, remoteId });
        return URL.createObjectURL(blob);
      } catch {
        /* offline / Storage object not reachable — nothing to show */
      }
      return null;
    }
    const base = await serverUrl();
    if (base) {
      try {
        const blob = await downloadMedia(base, await syncToken(), remoteId);
        if (blob) {
          // cache locally under the original localId so future loads are instant
          await saveMedia({ id: img.localId || remoteId, obsId, name: img.name || '', mime: blob.type, blob, remoteId });
          return URL.createObjectURL(blob);
        }
      } catch {
        /* offline / not uploaded yet — nothing to show */
      }
    }
  }
  return null;
}
