/* lib/obs-card.ts — shared observation-card renderer used by the journal
 * feed (views/cards.ts) and the single-observation detail view
 * (views/detail.ts): place (linked to maps), meta, numbered species list
 * (each with its own note + photos), and general notes. Also exports a
 * compact summary (place/time/tags/coordinates only, no species or
 * notes) for the journal's "list" display mode. */

import { fmtDateTimeWithWeekday, fmtCoords, showImageModal, confirmDialog, toast, safeHttpUrl } from './ui';
import { renderMarkdown, escapeHtml } from './markdown';
import { getImageObjectUrl } from './media';
import { entriesOf, entryImages, allImages, primarySpecies } from './observation';
import { icon } from './icons';
import { renderTrackMap } from './track-map';
import { fmtDistance } from './gps-track';
import { getTrack, deleteTrack, toggleStarred, getSeries } from '../db/repository';
import { tagBadgesHtml, wireTagBadges } from './tag-badge';
import { familyColor } from './family-color';
import { getSpeciesDetail } from './species-details-cache';
import { seriesDayLabel } from './series';
import { navigate } from '../main';
import type { Observation } from '../types';

/** Sets the --family-color custom property (read by .obs-card's left
 * accent border in CSS) from the primary species' family, so the journal
 * feed gets a bit of species-driven color variety at a glance. */
function applyFamilyAccent(card: HTMLElement, o: Observation): void {
  const family = getSpeciesDetail(primarySpecies(o)).family || '';
  const color = familyColor(family);
  if (color) card.style.setProperty('--family-color', color);
}

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

/** @param collapsible When true (the default — calendar list + detail view),
 * tags/observers hide behind a count toggle. The journal's list display
 * always wants them visible, so it passes false and gets a plain, always-
 * expanded block instead. */
function headMetaHtml(o: Observation, collapsible = true): string {
  const url = mapsUrl(o);
  const hasPhotos = allImages(o).length > 0;
  const mediaHref = o.mediaLink ? safeHttpUrl(o.mediaLink) : null;
  const tagCount = o.tags?.length || 0;
  const observerCount = o.observers?.length || 0;
  const metaDetailsHtml = `
    ${tagCount ? `<div class="tag-badge-row">${tagBadgesHtml(o.tags)}</div>` : ''}
    ${observerCount ? `<div class="observer-row" title="צופים נוספים">${icon('users')} ${escapeHtml(o.observers!.join(', '))}</div>` : ''}`;
  const tagsObserversHtml = !(tagCount || observerCount) ? '' : collapsible ? `
      <button type="button" class="card-meta-toggle" data-meta-toggle title="הצגת תגיות וצופים">
        ${tagCount ? `<span>${icon('tagGeneric')} ${tagCount} תגיות</span>` : ''}
        ${observerCount ? `<span>${icon('users')} ${observerCount} צופים</span>` : ''}
        <span class="card-meta-caret">${icon('chevronsDown')}</span>
      </button>
      <div class="card-meta-details" hidden>${metaDetailsHtml}</div>` : `
      <div class="card-meta-details">${metaDetailsHtml}</div>`;
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
      <span>${icon('clock')} ${fmtDateTimeWithWeekday(o.dateTime)}</span>
      ${fmtCoords(o.lat, o.lng) ? `<span dir="ltr">${icon('compass')} ${fmtCoords(o.lat, o.lng)}</span>` : ''}
      ${hasPhotos ? `<span class="media-indicator" title="כולל תמונות מצורפות">${icon('camera')}</span>` : ''}
      ${mediaHref ? `<a href="${escapeHtml(mediaHref)}" target="_blank" rel="noopener" class="media-indicator media-link-icon" title="פתיחת התמונות/סרטונים בענן">${icon('link')}</a>` : ''}
    </div>
    ${o.seriesId ? `<div class="series-badge-row" data-series-badge="${escapeHtml(o.seriesId)}" hidden></div>` : ''}
    ${tagsObserversHtml}`;
}

/** Fills in the series badge placeholder rendered by `headMetaHtml()` (if
 * this observation is linked to one) once its series row loads — async
 * since obs-card renders synchronously but the series lookup isn't. Clicking
 * the badge opens that series' page in the series library. */
function wireSeriesBadge(root: HTMLElement, o: Observation): void {
  if (!o.seriesId) return;
  const slot = root.querySelector<HTMLElement>('[data-series-badge]');
  if (!slot) return;
  void getSeries(o.seriesId).then((series) => {
    if (!series) return;
    slot.hidden = false;
    slot.innerHTML = `
      <button type="button" class="series-badge" title="מעבר לדף המעקב">
        ${icon('target')} ${escapeHtml(series.name)} · ${escapeHtml(seriesDayLabel(series, new Date(o.dateTime)))}
      </button>`;
    slot.querySelector('button')!.addEventListener('click', (e) => {
      e.stopPropagation();
      navigate('series', { seriesId: series.id });
    });
  });
}

/** Wires the collapsed tags/observers toggle rendered by `headMetaHtml()` —
 * stops the click from bubbling into the card's own "open detail" handler,
 * since the toggle should only expand/collapse in place. */
export function wireCardMetaToggle(root: HTMLElement): void {
  const btn = root.querySelector<HTMLButtonElement>('[data-meta-toggle]');
  const details = root.querySelector<HTMLElement>('.card-meta-details');
  if (!btn || !details) return;
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    details.hidden = !details.hidden;
    btn.classList.toggle('expanded', !details.hidden);
  });
}

/** Compact row: location, time, tags and coordinates only — no species
 * or notes. Used by the journal's "list" display mode. */
export function renderObservationSummary(o: Observation): HTMLElement {
  const card = document.createElement('article');
  card.className = 'obs-card obs-card-compact';
  card.innerHTML = headMetaHtml(o, false);
  applyFamilyAccent(card, o);
  wireStarButton(card);
  wireTagBadges(card);
  wireCardMetaToggle(card);
  wireSeriesBadge(card, o);
  return card;
}

export function renderObservationCard(o: Observation): HTMLElement {
  const card = document.createElement('article');
  card.className = 'obs-card';
  applyFamilyAccent(card, o);
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
  wireCardMetaToggle(card);
  wireSeriesBadge(card, o);

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
