/* lib/obs-card.ts — shared observation-card renderer used by the journal
 * feed (views/cards.ts) and the single-observation detail view
 * (views/detail.ts): place (linked to maps), meta, numbered species list
 * (each with its own note + photos), and general notes. Also exports a
 * compact summary (place/time/tags/coordinates only, no species or
 * notes) for the journal's "list" display mode. */

import { fmtDateTime, fmtCoords, showImageModal, confirmDialog, toast, safeHttpUrl } from './ui';
import { renderMarkdown, escapeHtml } from './markdown';
import { getImageObjectUrl } from './media';
import { entriesOf, entryImages, allImages } from './observation';
import { icon } from './icons';
import { renderTrackMap } from './track-map';
import { fmtDistance } from './gps-track';
import { getTrack, deleteTrack, toggleStarred } from '../db/repository';
import { tagBadgesHtml, wireTagBadges } from './tag-badge';
import type { Observation } from '../types';

function mapsUrl(o: Observation): string | null {
  if (o.lat != null && o.lng != null) return `https://www.google.com/maps/search/?api=1&query=${o.lat},${o.lng}`;
  if (o.locationName) return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(o.locationName)}`;
  return null;
}

/** Shared by every place an observation is shown (journal rows/tiles, the
 * full card, detail view) so favoriting works identically everywhere. */
export function starButtonHtml(o: Observation): string {
  const label = o.starred ? 'הסרה מהמועדפים' : 'הוספה למועדפים';
  return `<button type="button" class="star-btn${o.starred ? ' starred' : ''}" data-star-btn data-obs-id="${o.id}" title="${label}" aria-label="${label}">${icon('star')}</button>`;
}

/** Wires the click handler for a starButtonHtml() button already in the DOM
 * under `root` — stops the click from bubbling into the card's own "open
 * detail" handler, since starring shouldn't navigate anywhere. */
export function wireStarButton(root: HTMLElement): void {
  const btn = root.querySelector<HTMLButtonElement>('[data-star-btn]');
  if (!btn) return;
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    void (async () => {
      const starred = await toggleStarred(btn.dataset.obsId!);
      btn.classList.toggle('starred', starred);
      const label = starred ? 'הסרה מהמועדפים' : 'הוספה למועדפים';
      btn.title = label;
      btn.setAttribute('aria-label', label);
    })();
  });
}

function headMetaHtml(o: Observation): string {
  const url = mapsUrl(o);
  const hasPhotos = allImages(o).length > 0;
  const mediaHref = o.mediaLink ? safeHttpUrl(o.mediaLink) : null;
  return `
    <div class="card-head">
      <div class="card-place">
        ${url
          ? `<a href="${url}" target="_blank" rel="noopener" class="place-link">${icon('pin')} ${escapeHtml(o.locationName || 'מיקום')}</a>`
          : `<span>${icon('pin')} ${escapeHtml(o.locationName || '—')}</span>`}
      </div>
      ${starButtonHtml(o)}
    </div>
    <div class="meta">
      ${o.seqNo ? `<span class="obs-seq" dir="ltr">#${o.seqNo}</span>` : ''}
      <span>${icon('clock')} ${fmtDateTime(o.dateTime)}</span>
      ${fmtCoords(o.lat, o.lng) ? `<span dir="ltr">${icon('compass')} ${fmtCoords(o.lat, o.lng)}</span>` : ''}
      ${hasPhotos ? `<span class="media-indicator" title="כולל תמונות מצורפות">${icon('camera')}</span>` : ''}
      ${mediaHref ? `<a href="${escapeHtml(mediaHref)}" target="_blank" rel="noopener" class="media-indicator media-link-icon" title="פתיחת התמונות/סרטונים בענן">${icon('link')}</a>` : ''}
    </div>
    ${o.tags?.length ? `<div class="tag-badge-row">${tagBadgesHtml(o.tags)}</div>` : ''}`;
}

/** Compact row: location, time, tags and coordinates only — no species
 * or notes. Used by the journal's "list" display mode. */
export function renderObservationSummary(o: Observation): HTMLElement {
  const card = document.createElement('article');
  card.className = 'obs-card obs-card-compact';
  card.innerHTML = headMetaHtml(o);
  wireStarButton(card);
  wireTagBadges(card);
  return card;
}

export function renderObservationCard(o: Observation): HTMLElement {
  const card = document.createElement('article');
  card.className = 'obs-card';
  const mediaHref = o.mediaLink ? safeHttpUrl(o.mediaLink) : null;
  card.innerHTML = `
    ${headMetaHtml(o)}
    <ol class="species-ol"></ol>
    <div class="track-preview" data-track-preview hidden></div>
    ${o.notes ? `<div class="notes">${renderMarkdown(o.notes)}</div>` : ''}
    ${mediaHref ? `<a href="${escapeHtml(mediaHref)}" target="_blank" rel="noopener" class="media-link">${icon('link')} תמונות/סרטונים בענן</a>` : ''}
  `;
  wireStarButton(card);
  wireTagBadges(card);

  void getTrack(o.id).then((track) => {
    if (!track || track.points.length < 2) return;
    const wrap = card.querySelector<HTMLElement>('[data-track-preview]');
    if (!wrap) return;
    const mins = Math.round(track.durationMs / 60000);
    const dist = track.distanceMeters;
    wrap.innerHTML = `
      <div class="track-preview-label">
        <span>${icon('map')} מסלול תצפית${mins ? ` · ${mins} דק׳` : ''}${dist ? ` · ${fmtDistance(dist)}` : ''}</span>
        <button type="button" class="btn btn-icon track-preview-del" title="מחיקת ההקלטה" aria-label="מחיקת ההקלטה">${icon('trash')}</button>
      </div>
      <div class="track-map" data-track-map></div>
    `;
    wrap.hidden = false;
    renderTrackMap(wrap.querySelector<HTMLElement>('[data-track-map]')!, track);
    wrap.querySelector('.track-preview-del')!.addEventListener('click', (e) => {
      e.stopPropagation();
      void (async () => {
        if (!(await confirmDialog('למחוק את הקלטת המסלול של תצפית זו?', 'מחיקה'))) return;
        await deleteTrack(o.id);
        wrap.hidden = true;
        toast('הקלטת המסלול נמחקה');
      })();
    });
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
