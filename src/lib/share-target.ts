/* lib/share-target.ts — constants shared between sw.ts (which stashes files
 * shared into the app via the OS share sheet into the Cache API, since a
 * service worker is the only thing that can read a share-target POST body)
 * and gallery.ts (which reads them back out once the app reloads). */

export const SHARE_TARGET_CACHE = 'share-target-photos';
export const SHARE_TARGET_FIELD = 'photos';
export const SHARE_TARGET_HASH = '#share-target';
