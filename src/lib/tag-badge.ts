/* lib/tag-badge.ts — shared colored+iconed tag badge, rendered wherever an
 * observation is shown (journal cards/tiles, table rows, detail view).
 * Clicking a badge anywhere instantly filters the journal to that tag. */

import { escapeHtml } from './markdown';
import { getTagInfo } from './tags-cache';
import { navigate } from '../main';

/** One badge per tag name, plain colored text (no icon — see tag icon
 * removal). A tag that no longer exists in the master list (stale legacy
 * value) still renders, with a neutral fallback color, so it doesn't just
 * silently vanish from the observation. */
export function tagBadgesHtml(tags: string[], extraClass = ''): string {
  return tags.map((name) => {
    const info = getTagInfo(name);
    const color = info?.color || '#607d8b';
    return `<button type="button" class="tag-badge${extraClass ? ' ' + extraClass : ''}" data-tag-badge="${escapeHtml(name)}" style="--tag-color:${escapeHtml(color)}" title="סינון לפי תגית זו">${escapeHtml(name)}</button>`;
  }).join('');
}

/** Wires every tag-badge button under `root` — stops the click from
 * bubbling into the card/row/tile's own "open detail" handler, since
 * tapping a badge should filter instead of navigating there. */
export function wireTagBadges(root: HTMLElement): void {
  root.querySelectorAll<HTMLElement>('[data-tag-badge]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      navigate('cards', { filterTag: btn.dataset.tagBadge! });
    });
  });
}
