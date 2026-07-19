/* lib/tile-card.ts — compact observation tile for the "square"/"rectangular
 * tiles" view modes (journal + table). Shows a photo thumbnail when the
 * observation has one, otherwise a plain accent-colored placeholder, plus
 * species/date/location text sized to the tile shape. */

import { fmtDateTime } from './ui';
import { escapeHtml } from './markdown';
import { getImageObjectUrl } from './media';
import { entriesOf, entryImages, speciesLabel, primarySpecies } from './observation';
import { icon } from './icons';
import type { Observation } from '../types';

export function renderObservationTile(o: Observation, mode: 'square' | 'rect'): HTMLElement {
  const tile = document.createElement('article');
  tile.className = `obs-tile obs-tile-${mode}`;
  const label = mode === 'square' ? primarySpecies(o) || 'ללא מין' : speciesLabel(o) || 'ללא מין';
  tile.innerHTML = `
    <div class="obs-tile-media">${icon('bird', 'obs-tile-fallback-icon')}</div>
    <div class="obs-tile-info">
      <span class="obs-tile-species">${escapeHtml(label)}</span>
      <span class="obs-tile-meta">${icon('clock')} ${fmtDateTime(o.dateTime)}</span>
      ${mode === 'rect' && o.locationName ? `<span class="obs-tile-meta">${icon('pin')} ${escapeHtml(o.locationName)}</span>` : ''}
    </div>
  `;

  const media = tile.querySelector<HTMLElement>('.obs-tile-media')!;
  for (const entry of entriesOf(o)) {
    const img = entryImages(entry)[0];
    if (!img) continue;
    void getImageObjectUrl(img, o.id).then((url) => {
      if (!url) return;
      media.innerHTML = '';
      const el = document.createElement('img');
      el.src = url;
      el.alt = entry.species;
      el.loading = 'lazy';
      media.appendChild(el);
    });
    break;
  }
  return tile;
}
