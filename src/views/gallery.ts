/* views/gallery.ts — טאב "גלריה": כל תמונה שנשמרה אי-פעם באפליקציה (בין אם
 * צולמה/הועלתה מתוך טופס תצפית, יובאה בייבוא תמונות מרוכז, או הועלתה כאן
 * ישירות) בתצוגת רשת אחת, ללא צורך בייבוא/הגירה נפרד — כולן כבר יושבות
 * באותה טבלת media. לחיצה על תמונה פותחת דפדוף במסך מלא (עם החלקה/חצים בין
 * תמונות); תמונה שהועלתה ישירות כאן ("יתומה", ללא תצפית) אפשר לשייך לתצפית
 * קיימת מתוך מסך הצפייה. */

import { listAllMedia, deleteMediaAndUnlink, saveMedia, associateMediaWithObservation, listObservations, getObservation } from '../db/repository';
import { getMediaObjectUrl } from '../lib/media';
import { resolvePhotoDate } from '../lib/exif';
import { toast, confirmDialog, showModal, fmtDateTime } from '../lib/ui';
import { escapeHtml } from '../lib/markdown';
import { speciesLabel, entriesOf } from '../lib/observation';
import { icon } from '../lib/icons';
import { qs } from '../lib/dom';
import { navigate } from '../main';
import type { MediaRecord, Observation } from '../types';

/** "צולם ב-..." line, or null if the photo has no known capture date at all
 * (e.g. a very old row saved before this field existed). */
function takenLabel(m: MediaRecord): string | null {
  if (!m.takenAt) return null;
  const approx = m.takenAtSource === 'file' ? ' (משוער לפי תאריך הקובץ)' : '';
  return `צולמה ב-${fmtDateTime(m.takenAt)}${approx}`;
}

let container: HTMLElement;
let items: MediaRecord[] = [];
let lightboxIndex = -1;
let closeLightbox: (() => void) | null = null;

export function init(el: HTMLElement): void {
  container = el;
  container.innerHTML = `
    <div class="gallery-toolbar">
      <span class="gallery-count" id="gallery-count"></span>
      <button type="button" class="btn btn-primary" id="gallery-upload-btn">${icon('upload')} העלאת תמונות</button>
      <input type="file" id="gallery-upload-input" accept="image/*" multiple hidden>
    </div>
    <div class="gallery-grid" id="gallery-grid"></div>
    <p class="gallery-empty" id="gallery-empty" hidden>אין עדיין תמונות. אפשר להעלות כאן, או להוסיף תמונות דרך טופס התצפית.</p>
  `;
  qs(container, '#gallery-upload-btn').addEventListener('click', () => qs(container, '#gallery-upload-input').click());
  qs<HTMLInputElement>(container, '#gallery-upload-input').addEventListener('change', (e) => void onUpload(e));
}

async function onUpload(e: Event): Promise<void> {
  const input = e.target as HTMLInputElement;
  const files = input.files ? Array.from(input.files) : [];
  input.value = '';
  if (!files.length) return;
  for (const file of files) {
    const { date, source } = await resolvePhotoDate(file);
    await saveMedia({
      id: crypto.randomUUID(), obsId: '', name: file.name || 'image', mime: file.type, blob: file,
      takenAt: date.toISOString(), takenAtSource: source,
    });
  }
  toast(`הועלו ${files.length} תמונות לגלריה`);
  await activate();
}

export async function activate(): Promise<void> {
  items = (await listAllMedia()).sort((a, b) => (b.addedAt || '').localeCompare(a.addedAt || ''));
  renderGrid();
}

function renderGrid(): void {
  const grid = qs(container, '#gallery-grid');
  qs(container, '#gallery-empty').hidden = items.length > 0;
  qs(container, '#gallery-count').textContent = items.length ? `${items.length} תמונות` : '';
  grid.innerHTML = '';
  items.forEach((m, i) => {
    // A plain <button> can't host the nested "i" info button (invalid HTML —
    // the parser would auto-close it), so the tile itself is a div acting as
    // a button, with the real info button nested inside it.
    const tile = document.createElement('div');
    tile.className = 'gallery-tile';
    tile.setAttribute('role', 'button');
    tile.tabIndex = 0;
    tile.setAttribute('aria-label', m.name || 'תמונה');
    tile.innerHTML = `
      <img alt="">
      ${m.obsId ? `<span class="gallery-tile-badge" title="משויכת לתצפית">${icon('link')}</span>` : ''}
      <button type="button" class="gallery-tile-info" title="מידע מקורי" aria-label="מידע מקורי על התמונה">${icon('info')}</button>
    `;
    tile.addEventListener('click', () => openLightbox(i));
    tile.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openLightbox(i); }
    });
    tile.querySelector('.gallery-tile-info')!.addEventListener('click', (e) => {
      e.stopPropagation();
      showPhotoInfo(m);
    });
    grid.appendChild(tile);
    void getMediaObjectUrl(m).then((url) => { if (url) tile.querySelector('img')!.src = url; });
  });
}

/** The observation (if any) a photo is attached to, and the species name of
 * the specific entry that holds it — found by scanning entries for the
 * localId, since a MediaRecord only stores which observation, not which row. */
async function ownerInfo(m: MediaRecord): Promise<{ obs: Observation; species: string } | null> {
  if (!m.obsId) return null;
  const obs = await getObservation(m.obsId);
  if (!obs) return null;
  const entry = entriesOf(obs).find((e) => e.images?.some((i) => i.localId === m.id));
  return { obs, species: entry?.species || '' };
}

function openLightbox(index: number): void {
  lightboxIndex = index;
  const backdrop = document.createElement('div');
  backdrop.className = 'gallery-lightbox-backdrop';
  const box = document.createElement('div');
  box.className = 'gallery-lightbox';
  box.innerHTML = `
    <button type="button" class="btn btn-icon gallery-lb-close" aria-label="סגירה">✕</button>
    <button type="button" class="gallery-lb-nav gallery-lb-prev" aria-label="הקודמת">${icon('chevronRight')}</button>
    <div class="gallery-lb-imgwrap"><img class="gallery-lb-img" alt=""></div>
    <button type="button" class="gallery-lb-nav gallery-lb-next" aria-label="הבאה">${icon('chevronLeft')}</button>
    <div class="gallery-lb-info"></div>
  `;
  backdrop.appendChild(box);
  document.getElementById('modal-root')!.appendChild(backdrop);

  const close = (): void => { backdrop.remove(); if (closeLightbox === close) closeLightbox = null; };
  closeLightbox = close;
  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(); });
  box.querySelector('.gallery-lb-close')!.addEventListener('click', close);

  const step = (delta: number): void => {
    lightboxIndex = (lightboxIndex + delta + items.length) % items.length;
    void render();
  };
  box.querySelector('.gallery-lb-prev')!.addEventListener('click', () => step(-1));
  box.querySelector('.gallery-lb-next')!.addEventListener('click', () => step(1));
  wireLightboxSwipe(qs(box, '.gallery-lb-imgwrap'), () => step(1), () => step(-1));

  async function render(): Promise<void> {
    const m = items[lightboxIndex];
    if (!m) { close(); return; }
    const img = box.querySelector<HTMLImageElement>('.gallery-lb-img')!;
    img.src = '';
    void getMediaObjectUrl(m).then((url) => { if (url) img.src = url; });

    const info = box.querySelector<HTMLElement>('.gallery-lb-info')!;
    const taken = takenLabel(m);
    const owner = await ownerInfo(m);
    if (owner) {
      info.innerHTML = `
        <div class="gallery-lb-meta">
          <strong>${escapeHtml(owner.species || speciesLabel(owner.obs) || 'תצפית')}</strong>
          <span>${escapeHtml(owner.obs.locationName || 'ללא מיקום')} · ${fmtDateTime(owner.obs.dateTime)}</span>
          ${taken ? `<span class="gallery-lb-taken">${icon('info')} ${escapeHtml(taken)}</span>` : ''}
        </div>
        <div class="gallery-lb-actions">
          <button type="button" class="btn btn-sm gallery-lb-open">${icon('openOut')} פתיחת התצפית</button>
          <button type="button" class="btn btn-sm btn-danger gallery-lb-delete">${icon('trash')} מחיקה</button>
        </div>
      `;
      info.querySelector('.gallery-lb-open')!.addEventListener('click', () => { close(); navigate('detail', { viewId: owner.obs.id }); });
    } else {
      info.innerHTML = `
        <div class="gallery-lb-meta">
          <span>לא משויכת לתצפית</span>
          ${taken ? `<span class="gallery-lb-taken">${icon('info')} ${escapeHtml(taken)}</span>` : ''}
        </div>
        <div class="gallery-lb-actions">
          <button type="button" class="btn btn-sm btn-primary gallery-lb-assoc">${icon('link')} שיוך לתצפית</button>
          <button type="button" class="btn btn-sm btn-danger gallery-lb-delete">${icon('trash')} מחיקה</button>
        </div>
      `;
      // A dialog opened from inside the lightbox must close the lightbox
      // first — both stack in the same #modal-root as the lightbox's own
      // fixed backdrop, and the lightbox's higher z-index (it sits above
      // regular modals, being full-screen media) would otherwise leave the
      // dialog rendered but unreachable behind it.
      info.querySelector('.gallery-lb-assoc')!.addEventListener('click', () => { close(); void onAssociate(m); });
    }
    info.querySelector('.gallery-lb-delete')!.addEventListener('click', () => { close(); void onDelete(m); });
  }
  void render();
}

/** Small read-only panel for the tile's "i" marker — the photo's preserved
 * original metadata (capture date + source filename), reachable without
 * leaving the grid or opening the full-screen lightbox. */
function showPhotoInfo(m: MediaRecord): void {
  const taken = takenLabel(m);
  const wrap = document.createElement('div');
  wrap.className = 'photo-info-modal';
  wrap.innerHTML = `
    <h3>מידע מקורי על התמונה</h3>
    <dl class="photo-info-list">
      <dt>תאריך צילום</dt><dd>${escapeHtml(taken ? taken.replace(/^צולמה ב-/, '') : 'לא ידוע')}</dd>
      <dt>שם קובץ מקורי</dt><dd>${escapeHtml(m.name || 'לא ידוע')}</dd>
    </dl>
  `;
  showModal(wrap);
}

async function onDelete(m: MediaRecord): Promise<void> {
  const ok = await confirmDialog('למחוק את התמונה לצמיתות?', 'מחיקה');
  if (!ok) return;
  await deleteMediaAndUnlink(m.id);
  toast('התמונה נמחקה');
  await activate();
}

async function onAssociate(m: MediaRecord): Promise<void> {
  const obsList = await listObservations();
  // When the photo's capture date is known, lead with whichever observations
  // happened closest to it — that's the whole point of keeping takenAt: it
  // tells the user (and this list) which date the photo actually belongs to,
  // instead of just offering the same newest-first order every time.
  const takenMs = m.takenAt ? new Date(m.takenAt).getTime() : null;
  if (takenMs != null) {
    obsList.sort((a, b) => Math.abs(new Date(a.dateTime).getTime() - takenMs) - Math.abs(new Date(b.dateTime).getTime() - takenMs));
  }
  const taken = takenLabel(m);
  const wrap = document.createElement('div');
  wrap.className = 'gallery-assoc-modal';
  wrap.innerHTML = `
    <h3>שיוך תמונה לתצפית</h3>
    ${taken ? `<p class="gallery-assoc-taken">${icon('info')} ${escapeHtml(taken)} — התצפיות הקרובות ביותר לתאריך זה מופיעות ראשונות</p>` : ''}
    <input type="search" class="gallery-assoc-search" placeholder="חיפוש לפי מין / מיקום...">
    <div class="gallery-assoc-list"></div>
  `;
  const closeModal = showModal(wrap);
  const list = qs(wrap, '.gallery-assoc-list');

  const renderList = (filter: string): void => {
    const f = filter.trim().toLowerCase();
    const filtered = (f ? obsList.filter((o) => (speciesLabel(o) + ' ' + o.locationName).toLowerCase().includes(f)) : obsList).slice(0, 60);
    list.innerHTML = '';
    if (!filtered.length) { list.innerHTML = '<p class="map-sheet-empty">לא נמצאו תצפיות</p>'; return; }
    for (const o of filtered) {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'map-sheet-item';
      item.innerHTML = `<span class="map-sheet-item-species">${escapeHtml(speciesLabel(o) || 'ללא מין')}</span><span class="map-sheet-item-date">${fmtDateTime(o.dateTime)}</span>`;
      item.addEventListener('click', () => void doAssociate(o.id));
      list.appendChild(item);
    }
  };
  renderList('');
  qs<HTMLInputElement>(wrap, '.gallery-assoc-search').addEventListener('input', (e) => renderList((e.target as HTMLInputElement).value));

  const doAssociate = async (obsId: string): Promise<void> => {
    await associateMediaWithObservation(m.id, obsId);
    closeModal();
    toast('התמונה שויכה לתצפית');
    await activate();
  };
}

/** Horizontal swipe on the lightbox image — a plain pointer delta with no
 * live drag-following (unlike the journal's swipe-to-reveal), since a photo
 * carousel only needs a "flick left/right = next/prev" gesture. */
function wireLightboxSwipe(el: HTMLElement, onSwipeNext: () => void, onSwipePrev: () => void): void {
  const THRESHOLD = 40;
  let startX = 0;
  let active = false;
  el.addEventListener('pointerdown', (e: PointerEvent) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    startX = e.clientX;
    active = true;
  });
  el.addEventListener('pointerup', (e: PointerEvent) => {
    if (!active) return;
    active = false;
    const dx = e.clientX - startX;
    if (dx <= -THRESHOLD) onSwipeNext();
    else if (dx >= THRESHOLD) onSwipePrev();
  });
  el.addEventListener('pointercancel', () => { active = false; });
}

export function deactivate(): void {
  closeLightbox?.();
}
