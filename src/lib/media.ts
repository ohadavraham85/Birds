/* lib/media.ts — resolve an observation image to a displayable object URL.
 * Prefers the local blob; if it is missing but the image has a Firebase
 * Storage download URL (remoteId), it downloads and caches it. */

import { getMedia, saveMedia } from '../db/repository';
import type { ObservationImage } from '../types';

export async function getImageObjectUrl(img: ObservationImage, obsId = ''): Promise<string | null> {
  if (img?.localId) {
    const m = await getMedia(img.localId);
    if (m?.blob) return URL.createObjectURL(m.blob);
  }
  const remoteId = img?.remoteId || img?.localId;
  if (remoteId && navigator.onLine && /^https?:\/\//.test(remoteId)) {
    try {
      const blob = await (await fetch(remoteId)).blob();
      await saveMedia({ id: img.localId || remoteId, obsId, name: img.name || '', mime: blob.type, blob, remoteId });
      return URL.createObjectURL(blob);
    } catch {
      /* offline / Storage object not reachable — nothing to show */
    }
  }
  return null;
}
