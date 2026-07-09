/* media.js — resolving observation images from local storage (POC: client-only).
 * Image blobs live in IndexedDB at original quality; this maps an image ref
 * ({localId, name}) to an object URL for display.
 */

import { getMedia } from './db.js';

export async function getImageObjectUrl(img) {
  if (!img?.localId) return null;
  const m = await getMedia(img.localId);
  return m?.blob ? URL.createObjectURL(m.blob) : null;
}
