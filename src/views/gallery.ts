/* views/gallery.ts — טאב "גלריה": כל תמונה שנשמרה אי-פעם באפליקציה (בין אם
 * צולמה/הועלתה מתוך טופס תצפית, יובאה בייבוא תמונות מרוכז, או הועלתה כאן
 * ישירות) בתצוגת רשת אחת, ללא צורך בייבוא/הגירה נפרד — כולן כבר יושבות
 * באותה טבלת media. לחיצה על תמונה פותחת דפדוף במסך מלא (עם החלקה בין
 * תמונות והגדלה בצביטת שתי אצבעות); תמונה שהועלתה ישירות כאן ("יתומה", ללא
 * תצפית) אפשר לשייך לתצפית קיימת מתוך מסך הצפייה. שם המין מוצג תמיד מתחת
 * לכל תמונה משויכת, ולחיצה ארוכה על תמונה נכנסת לבחירה מרובה כדי לשייך או
 * למחוק כמה תמונות יחד. */

import { listAllMedia, deleteMediaAndUnlink, saveMedia, associateMediaWithObservation, listObservations, listSpecies, findMediaByHash, getSetting, setSetting } from '../db/repository';
import { getMediaObjectUrl, hashBlob } from '../lib/media';
import { resolvePhotoDate } from '../lib/exif';
import { toast, confirmDialog, showModal, fmtDateTime } from '../lib/ui';
import { escapeHtml } from '../lib/markdown';
import { speciesLabel, entriesOf } from '../lib/observation';
import { icon } from '../lib/icons';
import { qs } from '../lib/dom';
import { navigate } from '../main';
import type { MediaRecord, Observation, SpeciesEntry } from '../types';

/** "צולם ב-..." line, or null if the photo has no known capture date at all
 * (e.g. a very old row saved before this field existed). */
function takenLabel(m: MediaRecord): string | null {
  if (!m.takenAt) return null;
  const approx = m.takenAtSource === 'file' ? ' (משוער לפי תאריך הקובץ)' : '';
  return `צולמה ב-${fmtDateTime(m.takenAt)}${approx}`;
}

const LONG_PRESS_MS = 500;
const LONG_PRESS_MOVE_TOLERANCE = 10;

let container: HTMLElement;
/** Every photo ever loaded, before the with/without-observation filter. */
let allItems: MediaRecord[] = [];
/** The subset actually shown in the grid and browsable in the lightbox —
 * `allItems` filtered by `assocFilter`. */
let items: MediaRecord[] = [];
/** Which photos to show: all, only ones attached to an observation, or only
 * unassociated ("orphan") ones. */
let assocFilter: 'all' | 'assoc' | 'orphan' = 'all';
let lightboxIndex = -1;
let closeLightbox: (() => void) | null = null;

/** Multi-select mode: entered by long-pressing a tile — tap then toggles
 * selection instead of opening the lightbox, and a bulk toolbar offers
 * associating or deleting every selected photo at once. */
let selectionMode = false;
let selectedIds = new Set<string>();

export function init(el: HTMLElement): void {
  container = el;
  container.innerHTML = `
    <div class="gallery-toolbar">
      <span class="gallery-count" id="gallery-count"></span>
      <div class="gallery-toolbar-actions">
        <button type="button" class="btn btn-primary" id="gallery-upload-btn">${icon('upload')} העלאת תמונות</button>
      </div>
      <input type="file" id="gallery-upload-input" accept="image/*" multiple hidden>
    </div>
    <div class="seg-toggle" id="gallery-assoc-filter">
      <button type="button" class="seg-btn active" data-filter="all">הכל</button>
      <button type="button" class="seg-btn" data-filter="assoc">עם תצפית</button>
      <button type="button" class="seg-btn" data-filter="orphan">ללא תצפית</button>
    </div>
    <div class="bulk-toolbar" id="gallery-bulk-toolbar" hidden>
      <span id="gallery-bulk-count"></span>
      <button type="button" class="btn btn-sm btn-primary" id="gallery-bulk-assoc">${icon('link')} שיוך לתצפית</button>
      <button type="button" class="btn btn-sm btn-danger" id="gallery-bulk-delete">${icon('trash')} מחיקה</button>
      <span class="spacer"></span>
      <button type="button" class="btn btn-sm" id="gallery-bulk-cancel">ביטול</button>
    </div>
    <div class="gallery-grid gallery-grid-detail" id="gallery-grid"></div>
    <p class="gallery-empty" id="gallery-empty" hidden>אין עדיין תמונות. אפשר להעלות כאן, או להוסיף תמונות דרך טופס התצפית.</p>
  `;
  qs(container, '#gallery-upload-btn').addEventListener('click', () => qs(container, '#gallery-upload-input').click());
  qs<HTMLInputElement>(container, '#gallery-upload-input').addEventListener('change', (e) => void onUpload(e));

  qs(container, '#gallery-assoc-filter').addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('.seg-btn');
    if (!btn) return;
    assocFilter = btn.dataset.filter as 'all' | 'assoc' | 'orphan';
    qs(container, '#gallery-assoc-filter').querySelectorAll('.seg-btn').forEach((el) => el.classList.toggle('active', el === btn));
    selectionMode = false;
    selectedIds.clear();
    applyFilter();
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
  await ensureHashBackfill();
  let added = 0;
  let skipped = 0;
  for (const file of files) {
    const contentHash = await hashBlob(file);
    if (await findMediaByHash(contentHash)) { skipped++; continue; }
    const { date, source } = await resolvePhotoDate(file);
    await saveMedia({
      id: crypto.randomUUID(), obsId: '', name: file.name || 'image', mime: file.type, blob: file,
      takenAt: date.toISOString(), takenAtSource: source, contentHash,
    });
    added++;
  }
  if (skipped) toast(added ? `הועלו ${added} תמונות, ${skipped} דולגו (כבר קיימות בגלריה)` : `${skipped} תמונות דולגו — כבר קיימות בגלריה`);
  else toast(`הועלו ${added} תמונות לגלריה`);
  await activate();
}

let hashBackfillDone = false;

/** One-time (per device) backfill: hashes any photo already sitting in the
 * media table without a `contentHash` — either uploaded before the
 * duplicate-check existed, or added through a path that never computes one
 * (form.ts, settings.ts's bulk import) — so the upload button's duplicate
 * check has something to compare against for photos that predate it, not
 * just ones uploaded after this fix shipped. Guarded by a persisted setting
 * so it only ever runs once per device, not on every Gallery visit. */
async function ensureHashBackfill(): Promise<void> {
  if (hashBackfillDone) return;
  if (await getSetting<boolean>('galleryHashBackfillDone', false)) { hashBackfillDone = true; return; }
  for (const m of await listAllMedia()) {
    if (m.contentHash || !m.blob) continue;
    try {
      await saveMedia({ ...m, contentHash: await hashBlob(m.blob) });
    } catch {
      /* unreadable blob — leave it without a hash rather than fail the whole backfill */
    }
  }
  await setSetting('galleryHashBackfillDone', true);
  hashBackfillDone = true;
}

export async function activate(): Promise<void> {
  void ensureHashBackfill();
  allItems = (await listAllMedia()).sort((a, b) => (b.addedAt || '').localeCompare(a.addedAt || ''));
  await buildOwnerIndex();
  applyFilter();
  renderGrid();
}

/** Recomputes `items` (the browsable/rendered subset) from `allItems` per
 * the current with/without-observation filter. */
function applyFilter(): void {
  items = assocFilter === 'all' ? allItems
    : assocFilter === 'assoc' ? allItems.filter((m) => !!m.obsId)
    : allItems.filter((m) => !m.obsId);
}

/** localId -> the observation/species entry that references it, for every
 * image currently attached to a live observation. Built once per activation
 * from a single listObservations() scan, instead of a separate getObservation()
 * call per associated tile — with a real photo library (100+ items, mostly
 * associated) that per-tile lookup was firing that many concurrent IndexedDB
 * reads on every Gallery render, which is what made opening the tab feel
 * stuck. A media row's `obsId` only ever points to a live observation —
 * deleteObservation() always hard-deletes its media alongside it — so
 * listObservations()'s already-filters-deleted result is equivalent to the
 * old per-row getObservation() lookup for every real case. */
let ownerIndex = new Map<string, { obs: Observation; species: string }>();

async function buildOwnerIndex(): Promise<void> {
  const index = new Map<string, { obs: Observation; species: string }>();
  for (const obs of await listObservations()) {
    for (const entry of entriesOf(obs)) {
      for (const img of entry.images ?? []) {
        if (img.localId) index.set(img.localId, { obs, species: entry.species });
      }
    }
  }
  ownerIndex = index;
}

/** Caption shown under a tile — the species it's attached to via an
 * observation, its own directly-tagged species (see `species` on
 * MediaRecord — set independently of any observation link, from the
 * lightbox's "שיוך למין" action), or its association status when it has
 * neither. */
function captionFor(m: MediaRecord): string {
  const owner = ownerInfo(m);
  if (owner) return owner.species || speciesLabel(owner.obs) || 'תצפית';
  return m.species || 'לא משויכת';
}

function renderGrid(): void {
  const grid = qs(container, '#gallery-grid');
  const empty = qs(container, '#gallery-empty');
  empty.hidden = items.length > 0;
  empty.textContent = allItems.length === 0
    ? 'אין עדיין תמונות. אפשר להעלות כאן, או להוסיף תמונות דרך טופס התצפית.'
    : 'אין תמונות שתואמות את הסינון הנוכחי.';
  qs(container, '#gallery-count').textContent = items.length ? `${items.length} תמונות` : '';
  qs(container, '#gallery-bulk-toolbar').hidden = !selectionMode;
  qs(container, '#gallery-bulk-count').textContent = selectionMode ? `${selectedIds.size} נבחרו` : '';
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
    attachLongPress(tile, () => {
      if (selectionMode) return;
      selectionMode = true;
      selectedIds.add(m.id);
      renderGrid();
    });
    tile.querySelector('.gallery-tile-info')!.addEventListener('click', (e) => {
      e.stopPropagation();
      showPhotoInfo(m);
    });
    grid.appendChild(tile);
    void getMediaObjectUrl(m).then((url) => { if (url) tile.querySelector('img')!.src = url; });
    tile.querySelector('.gallery-tile-caption')!.textContent = captionFor(m);
  });
}

/** Fires `onLongPress` after a ~500ms hold that doesn't move much and isn't
 * released early — same gesture/thresholds as the journal's long-press
 * multi-select (cards.ts), so entering selection mode feels consistent
 * across the app. */
function attachLongPress(el: HTMLElement, onLongPress: () => void): void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let startX = 0;
  let startY = 0;
  const clear = (): void => { if (timer) { clearTimeout(timer); timer = null; } };
  el.addEventListener('pointerdown', (e: PointerEvent) => {
    startX = e.clientX;
    startY = e.clientY;
    clear();
    timer = setTimeout(() => { timer = null; onLongPress(); }, LONG_PRESS_MS);
  });
  el.addEventListener('pointermove', (e: PointerEvent) => {
    if (!timer) return;
    if (Math.abs(e.clientX - startX) > LONG_PRESS_MOVE_TOLERANCE || Math.abs(e.clientY - startY) > LONG_PRESS_MOVE_TOLERANCE) clear();
  });
  el.addEventListener('pointerup', clear);
  el.addEventListener('pointercancel', clear);
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
 * the specific entry that holds it — looked up from the batch-built
 * ownerIndex (see buildOwnerIndex) rather than a per-call DB query. */
function ownerInfo(m: MediaRecord): { obs: Observation; species: string } | null {
  if (!m.obsId) return null;
  return ownerIndex.get(m.id) || null;
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
    const owner = ownerInfo(m);
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
          <span>${m.species ? `${icon('bird')} ${escapeHtml(m.species)}` : 'לא משויכת לתצפית'}</span>
          ${m.species ? '<span>לא משויכת לתצפית</span>' : ''}
          ${taken ? `<span class="gallery-lb-taken">${icon('info')} ${escapeHtml(taken)}</span>` : ''}
        </div>
        <div class="gallery-lb-actions">
          <button type="button" class="btn btn-sm btn-primary gallery-lb-assoc">${icon('link')} שיוך לתצפית</button>
          <button type="button" class="btn btn-sm gallery-lb-species">${icon('bird')} ${m.species ? 'שינוי מין' : 'שיוך למין'}</button>
          <button type="button" class="btn btn-sm gallery-lb-new">${icon('plus')} תצפית חדשה</button>
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
        openObservationPicker('שיוך תמונה לתצפית', taken, (obsId, entryIndex) => void doAssociateOne(m, obsId, entryIndex), m.takenAt);
      });
      info.querySelector('.gallery-lb-species')!.addEventListener('click', () => {
        close();
        openSpeciesPicker(m);
      });
      info.querySelector('.gallery-lb-new')!.addEventListener('click', () => {
        close();
        navigate('form', { prefillMediaId: m.id });
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
  openObservationPicker(`שיוך ${ids.length} תמונות לתצפית`, null, (obsId, entryIndex) => void doAssociateMany(ids, obsId, entryIndex));
}

async function doAssociateOne(m: MediaRecord, obsId: string, entryIndex: number): Promise<void> {
  await associateMediaWithObservation(m.id, obsId, entryIndex);
  toast('התמונה שויכה לתצפית');
  await activate();
}

async function doAssociateMany(ids: string[], obsId: string, entryIndex: number): Promise<void> {
  for (const id of ids) await associateMediaWithObservation(id, obsId, entryIndex);
  selectionMode = false;
  selectedIds.clear();
  toast(`${ids.length} תמונות שויכו לתצפית`);
  await activate();
}

/** Tags an unassociated photo with a species directly — independent of
 * `associateMediaWithObservation`/`obsId`, so a photo can be labeled by
 * species without needing an actual logged observation to attach it to. */
async function doSetSpecies(m: MediaRecord, species: string | undefined): Promise<void> {
  // updatedAt: undefined forces saveMedia to stamp a fresh timestamp rather
  // than keep the stale one already on `m` from its last load — otherwise
  // this edit would never win a last-write-wins sync merge on other devices.
  await saveMedia({ ...m, species, updatedAt: undefined });
  toast(species ? `התמונה שויכה למין ${species}` : 'שיוך המין הוסר');
  await activate();
}

/** Searchable species picker for the lightbox's "שיוך למין"/"שינוי מין"
 * action — same search-list UI as openObservationPicker, but listing plain
 * species names instead of observations. Offers a clear option when the
 * photo already carries a species tag. */
function openSpeciesPicker(m: MediaRecord): void {
  void (async () => {
    const allSpecies = await listSpecies();
    const wrap = document.createElement('div');
    wrap.className = 'gallery-assoc-modal';
    wrap.innerHTML = `
      <h3>שיוך תמונה למין</h3>
      <input type="search" class="gallery-assoc-search" placeholder="חיפוש מין...">
      <div class="gallery-assoc-list"></div>
      ${m.species ? `<button type="button" class="btn btn-sm gallery-species-clear">${icon('trash')} הסרת שיוך המין</button>` : ''}
    `;
    const closeModal = showModal(wrap);
    const list = qs(wrap, '.gallery-assoc-list');
    const renderList = (filter: string): void => {
      const f = filter.trim().toLowerCase();
      const filtered = (f ? allSpecies.filter((s) => s.toLowerCase().includes(f)) : allSpecies).slice(0, 60);
      list.innerHTML = '';
      if (!filtered.length) { list.innerHTML = '<p class="map-sheet-empty">לא נמצאו מינים</p>'; return; }
      for (const name of filtered) {
        const item = document.createElement('button');
        item.type = 'button';
        item.className = 'map-sheet-item';
        item.innerHTML = `<span class="map-sheet-item-species">${escapeHtml(name)}</span>`;
        item.addEventListener('click', () => { closeModal(); void doSetSpecies(m, name); });
        list.appendChild(item);
      }
    };
    renderList('');
    qs<HTMLInputElement>(wrap, '.gallery-assoc-search').addEventListener('input', (e) => renderList((e.target as HTMLInputElement).value));
    wrap.querySelector('.gallery-species-clear')?.addEventListener('click', () => { closeModal(); void doSetSpecies(m, undefined); });
  })();
}

/** Searchable observation picker modal, shared by the single-photo and
 * bulk association flows. When `nearDate` is given (a single photo's own
 * capture date), leads with whichever observations happened closest to it —
 * skipped for the bulk flow, where several selected photos may have
 * unrelated capture dates and no single "nearest" ordering would make sense.
 *
 * `onPick` receives both the chosen observation's id and which of its
 * species entries to attach to. When the observation has only one entry
 * that's picked automatically; with more than one, a second step (rendered
 * into the same modal element, not a nested modal — see the z-index note in
 * the lightbox's own assoc-button handler) asks which species to use. */
function openObservationPicker(title: string, hint: string | null, onPick: (obsId: string, entryIndex: number) => void, nearDate?: string): void {
  void (async () => {
    const obsList = await listObservations();
    if (nearDate) {
      const ms = new Date(nearDate).getTime();
      obsList.sort((a, b) => Math.abs(new Date(a.dateTime).getTime() - ms) - Math.abs(new Date(b.dateTime).getTime() - ms));
    }
    const wrap = document.createElement('div');
    wrap.className = 'gallery-assoc-modal';
    const closeModal = showModal(wrap);

    const renderObsStep = (): void => {
      wrap.innerHTML = `
        <h3>${escapeHtml(title)}</h3>
        ${hint ? `<p class="gallery-assoc-taken">${icon('info')} ${escapeHtml(hint)}${nearDate ? ' — התצפיות הקרובות ביותר לתאריך זה מופיעות ראשונות' : ''}</p>` : ''}
        <input type="search" class="gallery-assoc-search" placeholder="חיפוש לפי מין / מיקום...">
        <div class="gallery-assoc-list"></div>
      `;
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
          item.addEventListener('click', () => pickObservation(o));
          list.appendChild(item);
        }
      };
      renderList('');
      qs<HTMLInputElement>(wrap, '.gallery-assoc-search').addEventListener('input', (e) => renderList((e.target as HTMLInputElement).value));
    };

    const pickObservation = (o: Observation): void => {
      const entries = entriesOf(o);
      if (entries.length <= 1) { closeModal(); onPick(o.id, 0); return; }
      renderSpeciesStep(o, entries);
    };

    const renderSpeciesStep = (o: Observation, entries: SpeciesEntry[]): void => {
      wrap.innerHTML = `
        <h3>לאיזה מין לשייך?</h3>
        <p class="gallery-assoc-taken">${escapeHtml(speciesLabel(o) ? `${o.locationName || 'ללא מיקום'} · ${fmtDateTime(o.dateTime)}` : '')}</p>
        <div class="gallery-assoc-list"></div>
        <button type="button" class="btn btn-sm gallery-assoc-back">${icon('chevronRight')} חזרה</button>
      `;
      const list = qs(wrap, '.gallery-assoc-list');
      entries.forEach((entry, entryIndex) => {
        const item = document.createElement('button');
        item.type = 'button';
        item.className = 'map-sheet-item';
        item.innerHTML = `<span class="map-sheet-item-species">${escapeHtml(entry.quantity > 1 ? `${entry.species} × ${entry.quantity}` : entry.species || 'ללא מין')}</span>`;
        item.addEventListener('click', () => { closeModal(); onPick(o.id, entryIndex); });
        list.appendChild(item);
      });
      qs(wrap, '.gallery-assoc-back').addEventListener('click', renderObsStep);
    };

    renderObsStep();
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
