/* lib/obs-card.ts — shared observation-card renderer used by the journal
 * feed (views/cards.ts) and the single-observation detail view
 * (views/detail.ts): place (linked to maps), meta, numbered species list
 * (each with its own note + photos), and general notes. Also exports a
 * compact summary (place/time/project/coordinates only, no species or
 * notes) for the journal's "list" display mode. */

import { fmtDateTime, fmtCoords, showImageModal } from './ui';
import { renderMarkdown, escapeHtml } from './markdown';
import { getImageObjectUrl } from './media';
import { entriesOf, entryImages } from './observation';
import { icon } from './icons';
import { getTrack } from '../db/repository';
import type { Observation } from '../types';

function mapsUrl(o: Observation): string | null {
  if (o.lat != null && o.lng != null) return `https://www.google.com/maps/search/?api=1&query=${o.lat},${o.lng}`;
  if (o.locationName) return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(o.locationName)}`;
  return null;
}

function headMetaHtml(o: Observation): string {
  const url = mapsUrl(o);
  return `
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
    </div>`;
}

/** Compact row: location, time, project and coordinates only — no species
 * or notes. Used by the journal's "list" display mode. */
export function renderObservationSummary(o: Observation): HTMLElement {
  const card = document.createElement('article');
  card.className = 'obs-card obs-card-compact';
  card.innerHTML = headMetaHtml(o);
  return card;
}

export function renderObservationCard(o: Observation): HTMLElement {
  const card = document.createElement('article');
  card.className = 'obs-card';
  card.innerHTML = `
    ${headMetaHtml(o)}
    <ol class="species-ol"></ol>
    <div class="track-preview" data-track-preview hidden></div>
    ${o.notes ? `<div class="notes">${renderMarkdown(o.notes)}</div>` : ''}
  `;

  void getTrack(o.id).then((track) => {
    if (!track?.previewImage) return;
    const wrap = card.querySelector<HTMLElement>('[data-track-preview]');
    if (!wrap) return;
    const mins = Math.round(track.durationMs / 60000);
    wrap.innerHTML = `
      <div class="track-preview-label">${icon('map')} מסלול תצפית${mins ? ` · ${mins} דק׳` : ''}</div>
      <img src="${track.previewImage}" alt="מסלול התצפית">
    `;
    wrap.hidden = false;
  });

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
