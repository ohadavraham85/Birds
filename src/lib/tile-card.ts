/* lib/tile-card.ts — compact observation tile for the "square"/"rectangular
 * tiles" view modes (journal + table). Shows a photo thumbnail when the
 * observation has one, otherwise a plain accent-colored placeholder, plus
 * the observation's main fields (location, time, tags, coordinates) —
 * not the species, which the list/detail views already cover. */

import { fmtDateTimeWithWeekday, fmtCoords } from './ui';
import { escapeHtml } from './markdown';
import { getImageObjectUrl } from './media';
import { entriesOf, entryImages, primarySpecies } from './observation';
import { icon } from './icons';
import { starButtonHtml, wireStarButton } from './obs-card';
import { tagBadgesHtml, wireTagBadges } from './tag-badge';
import { familyColor } from './family-color';
import { getSpeciesDetail } from './species-details-cache';
import type { Observation } from '../types';

export function renderObservationTile(o: Observation, mode: 'square' | 'rect'): HTMLElement {
  const tile = document.createElement('article');
  tile.className = `obs-tile obs-tile-${mode}`;
  const familyAccent = familyColor(getSpeciesDetail(primarySpecies(o)).family || '');
  if (familyAccent) tile.style.setProperty('--family-color', familyAccent);
  const coords = fmtCoords(o.lat, o.lng);
  tile.innerHTML = `
    <div class="obs-tile-media">${icon('bird', 'obs-tile-fallback-icon')}</div>
    ${starButtonHtml(o)}
    ${o.seqNo ? `<span class="obs-tile-seq" dir="ltr">#${o.seqNo}</span>` : ''}
    <div class="obs-tile-info">
      <span class="obs-tile-headline">${escapeHtml(o.locationName || 'ללא מיקום')}</span>
      <span class="obs-tile-meta">${icon('clock')} ${fmtDateTimeWithWeekday(o.dateTime)}</span>
      ${mode === 'rect' && coords ? `<span class="obs-tile-meta" dir="ltr">${icon('compass')} ${coords}</span>` : ''}
      ${mode === 'rect' && o.tags?.length ? `<div class="tag-badge-row">${tagBadgesHtml(o.tags, 'obs-tile-badge')}</div>` : ''}
    </div>
  `;
  wireStarButton(tile);
  wireTagBadges(tile);

  const media = tile.querySelector<HTMLElement>('.obs-tile-media')!;
  // Tries every photo across every entry in order, not just the very first
  // one — that single photo can be permanently unresolvable (no local blob,
  // no known Storage URL) while later ones on the same observation are fine,
  // which left the tile on the plain fallback icon despite having viewable
  // photos (same fix as species.ts's renderTileThumbnails).
  const candidates = entriesOf(o).flatMap((entry) => entryImages(entry));
  if (candidates.length) {
    void (async () => {
      for (const img of candidates) {
        const url = await getImageObjectUrl(img, o.id);
        if (!url) continue;
        media.innerHTML = '';
        const el = document.createElement('img');
        el.src = url;
        el.alt = o.locationName || 'תצפית';
        el.loading = 'lazy';
        media.appendChild(el);
        return;
      }
    })();
  }
  return tile;
}
