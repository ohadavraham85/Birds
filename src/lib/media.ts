/* lib/media.ts — resolve an observation image to a displayable object URL. */

import { getMedia } from '../db/repository';
import type { ObservationImage } from '../types';

export async function getImageObjectUrl(img: ObservationImage): Promise<string | null> {
  if (!img?.localId) return null;
  const m = await getMedia(img.localId);
  return m?.blob ? URL.createObjectURL(m.blob) : null;
}
