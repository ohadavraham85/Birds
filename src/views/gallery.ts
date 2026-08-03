/* views/gallery.ts — טאב "גלריה": כל תמונה שנשמרה אי-פעם באפליקציה (בין אם
 * צולמה/הועלתה מתוך טופס תצפית, יובאה בייבוא תמונות מרוכז, או הועלתה כאן
 * ישירות) בתצוגת רשת אחת, ללא צורך בייבוא/הגירה נפרד — כולן כבר יושבות
 * באותה טבלת media. לחיצה על תמונה פותחת דפדוף במסך מלא (עם החלקה בין
 * תמונות והגדלה בצביטת שתי אצבעות); תמונה שהועלתה ישירות כאן ("יתומה", ללא
 * תצפית) אפשר לשייך לתצפית קיימת מתוך מסך הצפייה. כפתור "פרטים" מציג את שם
 * המין מתחת לכל תמונה משויכת, וכפתור "בחירה" מאפשר לסמן כמה תמונות ולשייך
 * או למחוק אותן יחד. */

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

/** Whether tiles show a species/status caption below the thumbnail. */
let showDetails = false;
/** Multi-select mode: tap toggles selection instead of opening the lightbox,
 * and a bulk toolbar offers associating or deleting every selected photo at once. */
let selectionMode = false;
let selectedIds = new Set<string>();

export function init(el: HTMLElement): void {
  container = el;
  container.innerHTML = `
    <div class="gallery-toolbar">
      <span class="gallery-count" id="gallery-count"></span>
      <div class="gallery-toolbar-actions">
        <button type="button" class="btn btn-icon" id="gallery-detail-btn" title="הצגת פרטים מתחת לתמונות" aria-label="הצגת פרטים מתחת לתמונות">${icon('list')}</button>
        <button type="button" class="btn btn-icon" id="gallery-select-btn" title="בחירה מרובה" aria-label="בחירה מרובה">${icon('check')}</button>
        <button type="button" class="btn btn-primary" id="gallery-upload-btn">${icon('upload')} העלאת תמונות</button>
      </div>
      <input type="file" id="gallery-upload-input" accept="image/*" multiple hidden>
    </div>
    <div class="bulk-toolbar" id="gallery-bulk-toolbar" hidden>
      <span id="gallery-bulk-count"></span>
      <button type="button" class="btn btn-sm btn-primary" id="gallery-bulk-assoc">${icon('link')} שיוך לתצפית</button>
      <button type="button" class="btn btn-sm btn-danger" id="gallery-bulk-delete">${icon('trash')} מחיקה</button>
      <span class="spacer"></span>
      <button type="button" class="btn btn-sm" id="gallery-bulk-cancel">ביטול</button>
    </div>
    <div class="gallery-grid" id="gallery-grid"></div>
    <p class="gallery-empty" id="gallery-empty" hidden>אין עדיין תמונות. אפשר להעלות כאן, או להוסיף תמונות דרך טופס התצפית.</p>
  `;
  qs(container, '#gallery-upload-btn').addEventListener('click', () => qs(container, '#gallery-upload-input').click());
  qs<HTMLInputElement>(container, '#gallery-upload-input').addEventListener('change', (e) => void onUpload(e));

  qs(container, '#gallery-detail-btn').addEventListener('click', () => {
    showDetails = !showDetails;
    renderGrid();
  });

  qs(container, '#gallery-select-btn').addEventListener('click', () => {
    selectionMode = !selectionMode;
    if (!selectionMode) selectedIds.clear();
    renderGrid();
  });
  qs(container, '#gallery-bulk-cancel').addEventListener('click', () => {
    selectionMode = false;
    selectedIds.clear();
    renderGrid();
  });
  qs(container, '#gallery-bulk-delete').addEventListener('click', () => void onBulkDelete());
  qs(container, '#gallery-bulk-assoc').addEventListener('click', () => void onBulkAssociate());
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

/** Caption shown under a tile in detail mode — the species it's attached to,
 * or its association status when it has none. */
async function captionFor(m: MediaRecord): Promise<string> {
  const owner = await ownerInfo(m);
  return owner ? (owner.species || speciesLabel(owner.obs) || 'תצפית') : 'לא משויכת';
}

function renderGrid(): void {
  const grid = qs(container, '#gallery-grid');
  qs(container, '#gallery-empty').hidden = items.length > 0;
  qs(container, '#gallery-count').textContent = items.length ? `${items.length} תמונות` : '';
  qs(container, '#gallery-detail-btn').classList.toggle('active', showDetails);
  qs(container, '#gallery-select-btn').classList.toggle('active', selectionMode);
  qs(container, '#gallery-bulk-toolbar').hidden = !selectionMode;
  qs(container, '#gallery-bulk-count').textContent = selectionMode ? `${selectedIds.size} נבחרו` : '';
  grid.classList.toggle('gallery-grid-detail', showDetails);
  grid.innerHTML = '';
  items.forEach((m, i) => {
    // A plain <button> can't host the nested "i" info button (invalid HTML —
    // the parser would auto-close it), so the tile itself is a div acting as
    // a button, with the real info button nested inside it.
    const tile = document.createElement('div');
    tile.className = `gallery-tile${selectedIds.has(m.id) ? ' selected' : ''}`;
    tile.setAttribute('role', 'button');
    tile.tabIndex = 0;
    tile.setAttribute('aria-label', m.name || 'תמונה');
    tile.innerHTML = `
      <div class="gallery-tile-img">
        <img alt="">
        ${m.obsId ? `<span class="gallery-tile-badge" title="משויכת לתצפית">${icon('link')}</span>` : ''}
        <button type="button" class="gallery-tile-info" title="מידע מקורי" aria-label="מידע מקורי על התמונה">${icon('info')}</button>
        <span class="gallery-tile-select-check">${icon('check')}</span>
      </div>
      <div class="gallery-tile-caption"></div>
    `;
    const open = (): void => {
      if (selectionMode) { toggleSelect(m.id, tile); return; }
      openLightbox(i);
    };
    tile.addEventListener('click', open);
    tile.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); }
    });
    tile.querySelector('.gallery-tile-info')!.addEventListener('click', (e) => {
      e.stopPropagation();
      showPhotoInfo(m);
    });
    grid.appendChild(tile);
    void getMediaObjectUrl(m).then((url) => { if (url) tile.querySelector('img')!.src = url; });
    if (showDetails) void captionFor(m).then((text) => { tile.querySelector('.gallery-tile-caption')!.textContent = text; });
  });
}

/** Toggles one tile's selection without rebuilding the whole grid (which
 * would re-issue every thumbnail's object URL) — only leaving/entering
 * selection mode entirely re-renders, since that changes every tile's
 * click behavior and visible chrome. */
function toggleSelect(id: string, tile: HTMLElement): void {
  if (selectedIds.has(id)) selectedIds.delete(id); else selectedIds.add(id);
  tile.classList.toggle('selected', selectedIds.has(id));
  if (!selectedIds.size) { selectionMode = false; renderGrid(); return; }
  qs(container, '#gallery-bulk-count').textContent = `${selectedIds.size} נבחרו`;
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
  const gestures = wireLightboxGestures(
    qs(box, '.gallery-lb-imgwrap'),
    qs<HTMLImageElement>(box, '.gallery-lb-img'),
    () => step(1),
    () => step(-1),
  );

  async function render(): Promise<void> {
    const m = items[lightboxIndex];
    if (!m) { close(); return; }
    gestures.reset();
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
      info.querySelector('.gallery-lb-assoc')!.addEventListener('click', () => {
        close();
        openObservationPicker('שיוך תמונה לתצפית', taken, (obsId) => void doAssociateOne(m, obsId), m.takenAt);
      });
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

async function onBulkDelete(): Promise<void> {
  if (!selectedIds.size) return;
  const count = selectedIds.size;
  if (!(await confirmDialog(`למחוק ${count} תמונות שנבחרו לצמיתות?`, 'מחיקה'))) return;
  for (const id of selectedIds) await deleteMediaAndUnlink(id);
  selectionMode = false;
  selectedIds.clear();
  toast(`${count} תמונות נמחקו`);
  await activate();
}

async function onBulkAssociate(): Promise<void> {
  if (!selectedIds.size) return;
  const ids = [...selectedIds];
  openObservationPicker(`שיוך ${ids.length} תמונות לתצפית`, null, (obsId) => void doAssociateMany(ids, obsId));
}

async function doAssociateOne(m: MediaRecord, obsId: string): Promise<void> {
  await associateMediaWithObservation(m.id, obsId);
  toast('התמונה שויכה לתצפית');
  await activate();
}

async function doAssociateMany(ids: string[], obsId: string): Promise<void> {
  for (const id of ids) await associateMediaWithObservation(id, obsId);
  selectionMode = false;
  selectedIds.clear();
  toast(`${ids.length} תמונות שויכו לתצפית`);
  await activate();
}

/** Searchable observation picker modal, shared by the single-photo and
 * bulk association flows. When `nearDate` is given (a single photo's own
 * capture date), leads with whichever observations happened closest to it —
 * skipped for the bulk flow, where several selected photos may have
 * unrelated capture dates and no single "nearest" ordering would make sense. */
function openObservationPicker(title: string, hint: string | null, onPick: (obsId: string) => void, nearDate?: string): void {
  void (async () => {
    const obsList = await listObservations();
    if (nearDate) {
      const ms = new Date(nearDate).getTime();
      obsList.sort((a, b) => Math.abs(new Date(a.dateTime).getTime() - ms) - Math.abs(new Date(b.dateTime).getTime() - ms));
    }
    const wrap = document.createElement('div');
    wrap.className = 'gallery-assoc-modal';
    wrap.innerHTML = `
      <h3>${escapeHtml(title)}</h3>
      ${hint ? `<p class="gallery-assoc-taken">${icon('info')} ${escapeHtml(hint)}${nearDate ? ' — התצפיות הקרובות ביותר לתאריך זה מופיעות ראשונות' : ''}</p>` : ''}
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
        item.addEventListener('click', () => { closeModal(); onPick(o.id); });
        list.appendChild(item);
      }
    };
    renderList('');
    qs<HTMLInputElement>(wrap, '.gallery-assoc-search').addEventListener('input', (e) => renderList((e.target as HTMLInputElement).value));
  })();
}

/** Horizontal swipe (flick left/right = next/prev, only while at 1×) plus
 * two-finger pinch-to-zoom on the lightbox image. Both gestures share the
 * same pointer tracking so a pinch starting mid-swipe doesn't also trigger
 * navigation — a swipe only fires if exactly one pointer was ever down. */
function wireLightboxGestures(el: HTMLElement, img: HTMLImageElement, onSwipeNext: () => void, onSwipePrev: () => void): { reset: () => void } {
  const SWIPE_THRESHOLD = 40;
  const MAX_SCALE = 4;
  const pointers = new Map<number, { x: number; y: number }>();
  let startX = 0;
  let swiping = false;
  let scale = 1;
  let pinchStartDist = 0;
  let pinchStartScale = 1;

  const applyScale = (): void => { img.style.transform = scale > 1 ? `scale(${scale})` : ''; };

  el.addEventListener('pointerdown', (e: PointerEvent) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 1) {
      startX = e.clientX;
      swiping = scale <= 1;
    } else if (pointers.size === 2) {
      swiping = false;
      const [a, b] = [...pointers.values()];
      pinchStartDist = Math.hypot(a!.x - b!.x, a!.y - b!.y);
      pinchStartScale = scale;
    }
  });
  el.addEventListener('pointermove', (e: PointerEvent) => {
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 2 && pinchStartDist > 0) {
      const [a, b] = [...pointers.values()];
      const dist = Math.hypot(a!.x - b!.x, a!.y - b!.y);
      scale = Math.min(MAX_SCALE, Math.max(1, pinchStartScale * (dist / pinchStartDist)));
      applyScale();
    }
  });
  const endPointer = (e: PointerEvent): void => {
    if (pointers.size === 1 && swiping) {
      const dx = e.clientX - startX;
      if (dx <= -SWIPE_THRESHOLD) onSwipeNext();
      else if (dx >= SWIPE_THRESHOLD) onSwipePrev();
    }
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinchStartDist = 0;
    swiping = false;
  };
  el.addEventListener('pointerup', endPointer);
  el.addEventListener('pointercancel', endPointer);

  return {
    reset: (): void => { scale = 1; pointers.clear(); pinchStartDist = 0; applyScale(); },
  };
}

export function deactivate(): void {
  closeLightbox?.();
}
