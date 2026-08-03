/* lib/media.ts — resolve an observation image to a displayable object URL.
 * Prefers the local blob; if it is missing but the image has a Firebase
 * Storage download URL (remoteId), it downloads and caches it. */

import { getMedia, saveMedia } from '../db/repository';
import type { ObservationImage, MediaRecord } from '../types';

/** SHA-256 hex digest of a blob's bytes — used to detect re-uploading a
 * photo that's already saved (same content, regardless of file name). */
export async function hashBlob(blob: Blob): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

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

/** Same resolution as getImageObjectUrl, but starting from a MediaRecord
 * directly — for the Gallery tab, which reads the media table itself rather
 * than going through an observation's ObservationImage references. */
export async function getMediaObjectUrl(media: MediaRecord): Promise<string | null> {
  if (media.blob?.size) return URL.createObjectURL(media.blob);
  if (media.remoteId && navigator.onLine) {
    try {
      const blob = await (await fetch(media.remoteId)).blob();
      await saveMedia({ ...media, blob });
      return URL.createObjectURL(blob);
    } catch {
      /* offline / Storage object not reachable — nothing to show */
    }
  }
  return null;
}
