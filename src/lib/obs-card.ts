/* lib/obs-card.ts — shared observation-card renderer used by the journal
 * feed (views/cards.ts) and the single-observation detail view
 * (views/detail.ts): place (linked to maps), meta, numbered species list
 * (each with its own note + photos), and general notes. */

import { fmtDateTime, fmtCoords, showImageModal } from './ui';
import { renderMarkdown, escapeHtml } from './markdown';
import { getImageObjectUrl } from './media';
import { entriesOf, entryImages } from './observation';
import { icon } from './icons';
import type { Observation } from '../types';

function mapsUrl(o: Observation): string | null {
  if (o.lat != null && o.lng != null) return `https://www.google.com/maps/search/?api=1&query=${o.lat},${o.lng}`;
  if (o.locationName) return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(o.locationName)}`;
  return null;
}

export function renderObservationCard(o: Observation): HTMLElement {
  const url = mapsUrl(o);
  const card = document.createElement('article');
  card.className = 'obs-card';
  card.innerHTML = `
    <div class="card-head">
      <div class="card-place">
        ${url
          ? `<a href="${url}" target="_blank" rel="noopener" class="place-link">${icon('pin')} ${escapeHtml(o.locationName || 'מיקום')}</a>`
          : `<span>${icon('pin')} ${escapeHtml(o.locationName || '—')}</span>`}
        ${o.project ? `<span class="badge">${escapeHtml(o.project)}</span>` : ''}
      </div>
    </div>
    <div class="meta">
      <span>${icon('clock')} ${fmtDateTime(o.dateTime)}</span>
      ${fmtCoords(o.lat, o.lng) ? `<span dir="ltr">${icon('compass')} ${fmtCoords(o.lat, o.lng)}</span>` : ''}
    </div>
    <ol class="species-ol"></ol>
    ${o.notes ? `<div class="notes">${renderMarkdown(o.notes)}</div>` : ''}
  `;

  const ol = card.querySelector<HTMLElement>('.species-ol')!;
  for (const entry of entriesOf(o)) {
    const li = document.createElement('li');
    li.className = 'species-li';
    li.innerHTML = `
      <div class="species-line">
        <span class="species-name">${escapeHtml(entry.species)}</span>
        <span class="species-qty">× ${entry.quantity}</span>
      </div>
      ${entry.note ? `<div class="species-note">${escapeHtml(entry.note)}</div>` : ''}
      <div class="species-imgs"></div>
    `;
    const imgWrap = li.querySelector<HTMLElement>('.species-imgs')!;
    for (const img of entryImages(entry)) {
      const el = document.createElement('img');
      el.alt = img.name || entry.species;
      el.loading = 'lazy';
      imgWrap.appendChild(el);
      void getImageObjectUrl(img, o.id).then((objUrl) => {
        if (objUrl) { el.src = objUrl; el.onclick = (): void => showImageModal(objUrl, entry.species); }
        else el.remove();
      });
    }
    ol.appendChild(li);
  }
  return card;
}
