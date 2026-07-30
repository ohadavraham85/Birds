/* lib/media.ts — resolve an asset image to a displayable object URL. */

import { getMedia } from '../db/repository';
import type { AssetImage } from '../types';

export async function getImageObjectUrl(img: AssetImage): Promise<string | null> {
  if (!img?.localId) return null;
  const m = await getMedia(img.localId);
  return m?.blob ? URL.createObjectURL(m.blob) : null;
}
