/* lib/tags-cache.ts — in-memory mirror of the tags master list, kept fresh
 * via onDataChanged. Card/tile/table rendering needs a tag's color+icon
 * synchronously (it draws many small badges per render pass without
 * awaiting a DB read for each one), so this cache is refreshed in the
 * background and read synchronously wherever a badge is drawn. */

import { listTagRows, onDataChanged } from '../db/repository';
import type { TagRow } from '../types';

let cache = new Map<string, TagRow>();

export function getTagInfo(name: string): TagRow | undefined {
  return cache.get(name);
}

export async function refreshTagsCache(): Promise<void> {
  cache = new Map((await listTagRows()).map((t) => [t.name, t]));
}

onDataChanged(() => { void refreshTagsCache(); });
