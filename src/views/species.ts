/* views/species.ts — טאב "מינים": רשימת המינים עם פרטים (עברית/אנגלית/מדעי/משפחה),
 * חיפוש, קיבוץ לפי משפחה, מספר תצפיות לכל מין, תמונות מהתצפיות, תיאור אישי
 * לכל מין, וקישור לתצפיות. */

import { listSpeciesRows, addSpecies, setSpeciesDescription, updateSpeciesDetails, listObservations, listAllMedia, saveMedia, findMediaByHash, getMedia, deleteMediaAndUnlink, removeBrokenObservationImage } from '../db/repository';
import { getSpeciesDetail, getManualSpeciesTag } from '../lib/species-details-cache';
import { toast, showImageModal, fmtDateTime, showModal, confirmDialog } from '../lib/ui';
import { escapeHtml } from '../lib/markdown';
import { speciesNames, entriesOf, entryImages } from '../lib/observation';
import { getImageObjectUrl, hashBlob } from '../lib/media';
import { resolvePhotoDate } from '../lib/exif';
import { pickFromGalleryForSpecies } from '../lib/photo-picker';
import { qs, input, select } from '../lib/dom';
import { icon, type IconName } from '../lib/icons';
import { speciesInfoButtonHtml, openSpeciesInfoModal } from '../lib/species-info';
import { viewModeToggleHtml, wireViewModeToggle, syncViewModeToggle, type ViewDisplayMode } from '../lib/view-mode';
import { navigate } from '../main';
import type { ViewParams } from './view';
import type { SpeciesDetail, ObservationImage, SpeciesTag } from '../types';
import { SPECIES_TAGS, SPECIES_TAG_LABELS } from '../types';

/** Corner badge shown on a species card/tile for its birding-status (see
 * SpeciesTag) — click it to set the status directly (any of the 4 states),
 * or pick "אוטומטי" to clear the override and go back to deriving it from
 * the species' own logged observation count: 0 → unseen, 1 → lifer, 2+ →
 * seen. */
const SPECIES_TAG_ICONS: Record<SpeciesTag, IconName> = {
  seen: 'check', unseen: 'eye', target: 'target', lifer: 'star',
};

function speciesTag(name: string): SpeciesTag {
  const manual = getManualSpeciesTag(name);
  if (manual) return manual;
  const n = counts[name] || 0;
  if (n === 0) return 'unseen';
  if (n === 1) return 'lifer';
  return 'seen';
}

function speciesTagBadgeHtml(name: string): string {
  const tag = speciesTag(name);
  const label = SPECIES_TAG_LABELS[tag];
  return `<button type="button" class="sp-tagbadge sp-tagbadge-${tag}" data-name="${escapeHtml(name)}" title="לחיצה לשינוי הסיווג — ${label}">${icon(SPECIES_TAG_ICONS[tag])} ${label}</button>`;
}

type SortMode = 'family' | 'alpha' | 'recent' | 'seen' | 'tag' | 'count' | 'details';
type SortDir = 'asc' | 'desc';

let container: HTMLElement;
let names: string[] = [];
let counts: Record<string, number> = {};
let descriptions: Record<string, string> = {};
let imagesByName: Record<string, { img: ObservationImage; obsId: string }[]> = {};
let lastObserved: Record<string, string> = {};
/** Every tag a species has been logged under, across all its observations — a species can span several tags, unlike location/family which are single-valued. */
let tagsByName: Record<string, Set<string>> = {};
let query = '';
let sortMode: SortMode = 'family';
/** 'asc' reproduces each mode's original default ordering; 'desc' reverses it — see the toggle button's dynamic tooltip for what's actually shown. */
let sortDir: SortDir = 'asc';
let selectedTags = new Set<string>();
let displayMode: ViewDisplayMode = 'list';
let openKey: string | null = null;
let collapsedGroups = new Set<string>();
/** Set by setParams when arriving via a direct deep link (e.g. the home
 * screen's "Bird of the Day"); consumed once in the next activate() to
 * scroll straight to that species' card, so the trip feels like opening its
 * details directly rather than landing on the general list. */
let scrollToOnActivate: string | null = null;

export function init(el: HTMLElement): void {
  container = el;
  container.innerHTML = `
    <h2>רשימת המינים</h2>
    <div class="filter-bar">
      <input type="search" id="sp-q" class="filter-search" placeholder="חיפוש מין (עברית / אנגלית / מדעי / משפחה)...">
      <select id="sp-group" class="filter-sel">
        <option value="family">קיבוץ לפי משפחה</option>
        <option value="seen">נצפה / לא נצפה</option>
        <option value="details">עם פרטים / ללא פרטים</option>
        <option value="tag">קיבוץ לפי תגית</option>
        <option value="alpha">לפי א״ב</option>
        <option value="recent">לפי תצפית אחרונה</option>
        <option value="count">לפי מספר צפיות</option>
      </select>
      <button type="button" class="btn btn-icon sp-filter-btn" id="sp-filter-btn" title="סינון לפי תגית" aria-label="סינון לפי תגית">
        ${icon('filter')}<span class="filter-badge" id="sp-filter-badge" hidden></span>
      </button>
      <button type="button" class="btn btn-icon" id="sp-sort-btn" title="היפוך סדר" aria-label="היפוך סדר">${icon('sortArrows')}</button>
      ${viewModeToggleHtml('sp-view-mode')}
    </div>
    <div class="add-species-row">
      <input type="text" id="sp-new" placeholder="הוספת מין חדש לרשימה...">
      <button class="btn" id="sp-add">${icon('plus')} הוספה</button>
    </div>
    <p class="sp-summary" id="sp-summary"></p>
    <button type="button" class="btn btn-sm" id="sp-copy-missing">${icon('document')} העתקת רשימת מינים ללא פרטים</button>
    <div id="sp-list" class="sp-cards"></div>
  `;
  wireViewModeToggle(container, 'sp-view-mode', (mode) => { displayMode = mode; render(); });
  input(container, '#sp-q').addEventListener('input', (e) => { query = (e.target as HTMLInputElement).value; render(); });
  select(container, '#sp-group').addEventListener('change', (e) => { sortMode = (e.target as HTMLSelectElement).value as SortMode; render(); });
  qs(container, '#sp-filter-btn').addEventListener('click', openFilterModal);
  qs(container, '#sp-sort-btn').addEventListener('click', () => {
    sortDir = sortDir === 'asc' ? 'desc' : 'asc';
    render();
  });
  qs(container, '#sp-add').addEventListener('click', () => void onAdd());
  qs(container, '#sp-copy-missing').addEventListener('click', () => void onCopyMissingDetails());
  input(container, '#sp-new').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); void onAdd(); } });
  qs(container, '#sp-list').addEventListener('click', onListClick);
  qs(container, '#sp-list').addEventListener('change', (e) => {
    void onDescriptionChange(e);
    void onPhotoFileChange(e);
  });
}

/** Opens a specific species' card directly (e.g. from the home screen's
 * "Bird of the Day" widget) instead of the default collapsed list. */
export function setParams(params: ViewParams): void {
  if (!params.species) return;
  openKey = params.species;
  scrollToOnActivate = params.species;
  // make sure the arriving species isn't hidden inside a collapsed group,
  // regardless of which grouping mode is currently selected
  const family = detailsFor(params.species).family || '(ללא משפחה)';
  collapsedGroups.delete(family);
  collapsedGroups.delete('נצפה');
  collapsedGroups.delete('לא נצפה');
}

export async function activate(): Promise<void> {
  const rows = await listSpeciesRows();
  names = rows.map((r) => r.name);
  descriptions = {};
  for (const r of rows) descriptions[r.name] = r.description || '';

  const obs = await listObservations();
  counts = {};
  imagesByName = {};
  lastObserved = {};
  tagsByName = {};
  for (const o of obs) {
    const tags = o.tags.length ? o.tags : ['(ללא תגית)'];
    for (const name of speciesNames(o)) {
      counts[name] = (counts[name] || 0) + 1;
      if (!lastObserved[name] || o.dateTime > lastObserved[name]!) lastObserved[name] = o.dateTime;
      for (const tag of tags) (tagsByName[name] ??= new Set()).add(tag);
    }
    for (const entry of entriesOf(o)) {
      const imgs = entryImages(entry);
      if (entry.species && imgs.length) {
        (imagesByName[entry.species] ??= []).push(...imgs.map((img) => ({ img, obsId: o.id })));
      }
    }
  }
  // Gallery photos tagged with a species directly (no observation link) —
  // shown alongside observation photos so a species-only tag still counts
  // as "a photo of this species" here and in the home screen's Bird of the Day.
  for (const m of await listAllMedia()) {
    if (m.obsId || !m.species) continue;
    (imagesByName[m.species] ??= []).push({ img: { localId: m.id, name: m.name, remoteId: m.remoteId }, obsId: '' });
  }
  render();

  if (scrollToOnActivate) {
    const name = scrollToOnActivate;
    scrollToOnActivate = null;
    requestAnimationFrame(() => {
      const el = container.querySelector<HTMLElement>(`.sp-card[data-name="${CSS.escape(name)}"], .sp-tile[data-name="${CSS.escape(name)}"]`);
      el?.scrollIntoView({ block: 'start' });
    });
  }
}

function detailsFor(name: string): SpeciesDetail {
  return getSpeciesDetail(name);
}

function matches(name: string): boolean {
  const q = query.trim().toLowerCase();
  if (q) {
    const d = detailsFor(name);
    if (!`${d.he} ${d.en} ${d.sci} ${d.family}`.toLowerCase().includes(q)) return false;
  }
  if (selectedTags.size) {
    const tags = tagsByName[name] ?? new Set(['(ללא תגית)']);
    if (![...tags].some((t) => selectedTags.has(t))) return false;
  }
  return true;
}

/** Ascending reproduces localeCompare's natural order; descending just flips it — used for both group keys and in-group item order. */
function sortAlpha(list: string[]): string[] {
  return [...list].sort((a, b) => (sortDir === 'asc' ? a.localeCompare(b, 'he') : b.localeCompare(a, 'he')));
}

function itemsHtml(list: string[]): string {
  if (displayMode === 'list') return list.map(cardHtml).join('');
  return `<div class="obs-tile-grid obs-tile-grid-${displayMode}">${list.map((n) => tileHtml(n, displayMode)).join('')}</div>`;
}

/* ---------- advanced filter modal (by tag) ---------- */

function openFilterModal(): void {
  const tags = [...new Set(Object.values(tagsByName).flatMap((s) => [...s]))].sort((a, b) => a.localeCompare(b, 'he'));
  const localSet = new Set(selectedTags);

  const wrap = document.createElement('div');
  wrap.className = 'filter-modal';
  wrap.innerHTML = `
    <h3>סינון לפי תגית</h3>
    <div class="filter-modal-section">
      <div class="filter-modal-checks">
        ${tags.map((t) => `
          <label class="filter-modal-check">
            <input type="checkbox" value="${escapeHtml(t)}" ${localSet.has(t) ? 'checked' : ''}>
            <span>${escapeHtml(t)}</span>
          </label>`).join('') || '<p class="hint">אין תגיות עדיין</p>'}
      </div>
    </div>
    <div class="modal-actions">
      <button type="button" class="btn btn-primary" id="filter-apply">החלת סינון</button>
      <button type="button" class="btn" id="filter-clear">נקה סינון</button>
    </div>
  `;
  const close = showModal(wrap);

  wrap.querySelectorAll<HTMLInputElement>('input[type=checkbox]').forEach((cb) => {
    cb.addEventListener('change', () => {
      if (cb.checked) localSet.add(cb.value); else localSet.delete(cb.value);
    });
  });
  wrap.querySelector('#filter-apply')!.addEventListener('click', () => {
    selectedTags = localSet;
    close();
    render();
  });
  wrap.querySelector('#filter-clear')!.addEventListener('click', () => {
    selectedTags = new Set();
    close();
    render();
  });
}

function render(): void {
  syncViewModeToggle(container, 'sp-view-mode', displayMode);
  const filterCount = selectedTags.size;
  const badge = qs(container, '#sp-filter-badge');
  badge.hidden = !filterCount;
  badge.textContent = String(filterCount);
  qs(container, '#sp-filter-btn').classList.toggle('active', !!filterCount);
  const sortBtn = qs(container, '#sp-sort-btn');
  sortBtn.innerHTML = icon('sortArrows', sortDir === 'desc' ? 'icon-flip' : '');
  sortBtn.title = sortMode === 'count'
    ? (sortDir === 'asc' ? 'מוצג: מהשכיח לנדיר' : 'מוצג: מהנדיר לשכיח')
    : sortDir === 'asc' ? 'מוצג: סדר רגיל' : 'מוצג: סדר הפוך';

  const list = names.filter(matches);
  const withDetails = names.filter((n) => detailsFor(n).en).length;
  qs(container, '#sp-summary').textContent =
    `${names.length} מינים ברשימה · ${withDetails} עם פרטים מלאים` + (query || filterCount ? ` · ${list.length} תואמים לסינון` : '');

  const el = qs(container, '#sp-list');
  if (!list.length) { el.innerHTML = '<p style="color:var(--ink-soft)">אין מין תואם.</p>'; return; }

  if (sortMode === 'family' || sortMode === 'seen' || sortMode === 'tag' || sortMode === 'details') {
    const groups = new Map<string, string[]>();
    for (const n of list) {
      const keys = sortMode === 'family' ? [detailsFor(n).family || '(ללא משפחה)']
        : sortMode === 'seen' ? [counts[n] ? 'נצפה' : 'לא נצפה']
        : sortMode === 'details' ? [detailsFor(n).en ? 'יש פרטים' : 'אין פרטים']
        : [...(tagsByName[n] ?? new Set(['(ללא תגית)']))];
      for (const key of keys) (groups.get(key) ?? groups.set(key, []).get(key)!).push(n);
    }
    const keys = sortMode === 'seen'
      ? (sortDir === 'asc' ? ['נצפה', 'לא נצפה'] : ['לא נצפה', 'נצפה']).filter((k) => groups.has(k))
      : sortMode === 'details'
        ? (sortDir === 'asc' ? ['אין פרטים', 'יש פרטים'] : ['יש פרטים', 'אין פרטים']).filter((k) => groups.has(k))
        : sortAlpha([...groups.keys()]);
    el.innerHTML = keys.map((key) => {
      const items = sortAlpha(groups.get(key)!);
      const collapsed = collapsedGroups.has(key);
      return `
      <div class="sp-group">
        <button type="button" class="sp-group-head" data-group="${escapeHtml(key)}">
          <span>${escapeHtml(key)} <span class="sp-group-n">${items.length}</span></span>
          <span class="sp-caret">${collapsed ? '▼' : '▲'}</span>
        </button>
        ${collapsed ? '' : itemsHtml(items)}
      </div>`;
    }).join('');
  } else if (sortMode === 'recent') {
    const sorted = [...list].sort((a, b) => {
      const la = lastObserved[a] || '';
      const lb = lastObserved[b] || '';
      if (la && lb) return sortDir === 'asc' ? (la < lb ? 1 : la > lb ? -1 : 0) : (la < lb ? -1 : la > lb ? 1 : 0);
      if (la) return -1;
      if (lb) return 1;
      return a.localeCompare(b, 'he');
    });
    el.innerHTML = itemsHtml(sorted);
  } else if (sortMode === 'count') {
    const sorted = [...list].sort((a, b) => {
      const cmp = (counts[b] || 0) - (counts[a] || 0);
      return (sortDir === 'asc' ? cmp : -cmp) || a.localeCompare(b, 'he');
    });
    el.innerHTML = itemsHtml(sorted);
  } else {
    el.innerHTML = itemsHtml(sortAlpha(list));
  }
  renderOpenPhotos();
  renderTileThumbnails();
}

/** Fills the open card's photo gallery (thumbnails resolved async, like the
 * journal cards). A working photo tagged directly from the Gallery (no
 * `obsId`) gets a small remove button to undo an accidental tag — a working
 * photo attached via an observation entry has its species implied by that
 * entry, so it isn't removable from here. A *broken* photo (no local blob,
 * no working Storage URL — can never load, regardless of source) instead
 * gets a delete button that removes it outright, since untagging alone
 * would just leave a permanently-dead row sitting in the Gallery too. */
function renderOpenPhotos(): void {
  if (!openKey) return;
  const wrap = [...container.querySelectorAll<HTMLElement>('.sp-photos')].find((w) => w.dataset.name === openKey);
  if (!wrap) return;
  const photos = imagesByName[openKey] || [];
  wrap.innerHTML = '';
  for (const { img, obsId } of photos) {
    const tile = document.createElement('div');
    tile.className = 'sp-photo-tile';
    const el = document.createElement('img');
    el.loading = 'lazy';
    el.alt = openKey;
    tile.appendChild(el);
    wrap.appendChild(tile);
    void getImageObjectUrl(img, obsId).then((url) => {
      if (url) {
        el.src = url;
        el.onclick = (): void => showImageModal(url, openKey || '');
        if (!obsId) {
          const removeBtn = document.createElement('button');
          removeBtn.type = 'button';
          removeBtn.className = 'sp-photo-remove';
          removeBtn.title = 'הסרת שיוך התמונה למין';
          removeBtn.setAttribute('aria-label', 'הסרת שיוך התמונה למין');
          removeBtn.textContent = '✕';
          removeBtn.addEventListener('click', (e) => { e.stopPropagation(); void onRemovePhotoTag(img.localId); });
          tile.appendChild(removeBtn);
        }
        return;
      }
      // No local blob and no (working) Storage URL to fetch it from —
      // shown as a visible broken-photo placeholder (with a delete action,
      // since it can never load) rather than silently vanishing, so a
      // photo that "looks like it's there" (it's still counted above)
      // doesn't just disappear with no way to deal with it. If it's worth
      // trying to recover instead of deleting, Settings ← סנכרון וגיבוי has
      // "הורדת כל התמונות מהענן" / "תיקון קישורי תמונות שבורות" first.
      el.remove();
      tile.classList.add('sp-photo-broken');
      const broken = document.createElement('div');
      broken.className = 'sp-photo-broken-icon';
      broken.title = 'לא ניתן לטעון תמונה זו — היא לא נמצאת במכשיר הזה ולא זמינה להורדה מהענן. אפשר לנסות "הורדת כל התמונות מהענן" או "תיקון קישורי תמונות שבורות" בהגדרות ← סנכרון וגיבוי, או למחוק אותה.';
      broken.innerHTML = icon('alert');
      tile.insertBefore(broken, tile.firstChild);
      const deleteBtn = document.createElement('button');
      deleteBtn.type = 'button';
      deleteBtn.className = 'sp-photo-remove';
      deleteBtn.title = 'מחיקת התמונה השבורה';
      deleteBtn.setAttribute('aria-label', 'מחיקת התמונה השבורה');
      deleteBtn.textContent = '✕';
      deleteBtn.addEventListener('click', (e) => { e.stopPropagation(); void onDeleteBrokenPhoto(img.localId, obsId); });
      tile.appendChild(deleteBtn);
    });
  }
}

/** Undoes an accidental "תמונה מהגלריה"/"תמונה מהמכשיר" species tag. */
async function onRemovePhotoTag(mediaId: string): Promise<void> {
  const media = await getMedia(mediaId);
  if (!media) return;
  // updatedAt: undefined — see gallery.ts's doSetSpecies for why the stale
  // one already on `media` must not be kept.
  await saveMedia({ ...media, species: undefined, updatedAt: undefined });
  toast('שיוך התמונה למין הוסר');
  await activate();
}

/** Permanently deletes a photo that can never load (no local blob, no
 * working Storage URL) — for an observation-linked one this strips the
 * dangling reference from that specific entry too, not just the (possibly
 * nonexistent) media row, see repository.ts's removeBrokenObservationImage. */
async function onDeleteBrokenPhoto(mediaId: string, obsId: string): Promise<void> {
  if (!(await confirmDialog('למחוק את התמונה השבורה? לא ניתן לשחזר אותה.', 'מחיקה'))) return;
  if (obsId) await removeBrokenObservationImage(obsId, mediaId);
  else await deleteMediaAndUnlink(mediaId);
  toast('התמונה השבורה נמחקה');
  await activate();
}

/** Fills each closed tile's thumbnail (square/rect view modes) with the
 * species' first *resolvable* photo — tries every photo in order rather than
 * only the first, since that one alone can be permanently unresolvable (no
 * local blob and no known Storage URL, e.g. from a historical association
 * bug — see repository.ts's repairMissingImageLinks) while later ones in the
 * same list are perfectly fine; stopping at the first candidate left the
 * tile blank even though the species genuinely has viewable photos. */
function renderTileThumbnails(): void {
  for (const media of container.querySelectorAll<HTMLElement>('.sp-tile-media[data-name]')) {
    const name = media.dataset.name!;
    const candidates = imagesByName[name] || [];
    if (!candidates.length) continue;
    void (async () => {
      for (const { img, obsId } of candidates) {
        const url = await getImageObjectUrl(img, obsId);
        if (!url) continue;
        media.innerHTML = '';
        const el = document.createElement('img');
        el.src = url;
        el.alt = name;
        el.loading = 'lazy';
        media.appendChild(el);
        return;
      }
    })();
  }
}

function detailsHtml(name: string): string {
  const d = detailsFor(name);
  const n = counts[name] || 0;
  const photoCount = (imagesByName[name] || []).length;
  const desc = descriptions[name] || '';
  return `
    <div class="sp-details">
      ${d.sci ? `<div><b>שם מדעי:</b> <i dir="ltr">${escapeHtml(d.sci)}</i></div>` : ''}
      ${d.en ? `<div><b>שם אנגלי:</b> <span dir="ltr">${escapeHtml(d.en)}</span></div>` : ''}
      ${d.family ? `<div><b>משפחה:</b> ${escapeHtml(d.family)}</div>` : ''}
      ${lastObserved[name] ? `<div><b>תצפית אחרונה:</b> ${fmtDateTime(lastObserved[name]!)}</div>` : ''}
      ${!d.en && !d.sci && !d.family ? '<div style="color:var(--ink-soft)">אין פרטים נוספים למין זה.</div>' : ''}
      ${photoCount ? `
        <div class="sp-photos-label">${icon('camera')} ${photoCount} תמונות</div>
        <div class="sp-photos" data-name="${escapeHtml(name)}"></div>` : ''}
      <div class="sp-photo-actions">
        <button type="button" class="btn btn-sm sp-photo-gallery" data-name="${escapeHtml(name)}">${icon('grid')} תמונה מהגלריה</button>
        <button type="button" class="btn btn-sm sp-photo-device" data-name="${escapeHtml(name)}">${icon('camera')} תמונה מהמכשיר</button>
        <input type="file" class="sp-photo-file" accept="image/*" multiple hidden data-name="${escapeHtml(name)}">
      </div>
      <div class="field sp-desc-field">
        <label for="sp-desc-${escapeHtml(name)}">תיאור אישי</label>
        <textarea id="sp-desc-${escapeHtml(name)}" class="sp-desc-input" data-name="${escapeHtml(name)}"
          placeholder="הוסיפו כאן תיאור, סימני זיהוי, מיקומים מועדפים...">${escapeHtml(desc)}</textarea>
      </div>
      <div class="sp-actions">
        ${n ? `<button class="btn btn-sm btn-primary act-obs" data-name="${escapeHtml(name)}">${icon('list')} הצגת ${n} התצפיות</button>` : ''}
        <button class="btn btn-sm act-report" data-name="${escapeHtml(name)}">${icon('plus')} דיווח תצפית</button>
        ${speciesInfoButtonHtml(d.he, d.sci)}
      </div>
    </div>`;
}

function cardHtml(name: string): string {
  const d = detailsFor(name);
  const n = counts[name] || 0;
  const open = openKey === name;
  return `
    <div class="sp-card${open ? ' open' : ''}" data-name="${escapeHtml(name)}">
      <div class="sp-row">
        <div class="sp-main">
          <span class="sp-he">${escapeHtml(d.he)}</span>
          ${d.en ? `<span class="sp-en">${escapeHtml(d.en)}</span>` : ''}
          ${speciesTagBadgeHtml(name)}
        </div>
        <div class="sp-side">
          ${n ? `<button class="badge badge-link act-obs" data-name="${escapeHtml(name)}" title="הצגת התצפיות של המין">${n} תצפיות ›</button>` : ''}
          <span class="sp-caret">${open ? '▲' : '▼'}</span>
        </div>
      </div>
      ${open ? detailsHtml(name) : ''}
    </div>`;
}

/** Species tile for the square/rect view modes; an open tile spans the full grid width so its
 * expanded details render inline without disturbing the other tiles' layout. */
function tileHtml(name: string, mode: ViewDisplayMode): string {
  const d = detailsFor(name);
  const n = counts[name] || 0;
  const open = openKey === name;
  return `
    <div class="sp-tile${open ? ' sp-tile-open' : ''}" data-name="${escapeHtml(name)}"${open ? ' style="grid-column:1/-1"' : ''}>
      ${speciesTagBadgeHtml(name)}
      <button type="button" class="sp-tile-head" data-name="${escapeHtml(name)}">
        <div class="sp-tile-media obs-tile-media" data-name="${escapeHtml(name)}">${icon('bird', 'obs-tile-fallback-icon')}</div>
        <div class="sp-tile-info obs-tile-info">
          <span class="sp-tile-he obs-tile-headline">${escapeHtml(d.he)}</span>
          ${mode === 'rect' && d.en ? `<span class="obs-tile-meta" dir="ltr">${escapeHtml(d.en)}</span>` : ''}
          ${n ? `<span class="obs-tile-meta">${n} תצפיות</span>` : ''}
        </div>
      </button>
      ${open ? detailsHtml(name) : ''}
    </div>`;
}

function onListClick(e: Event): void {
  const target = e.target as HTMLElement;
  const tagBadge = target.closest<HTMLElement>('.sp-tagbadge');
  if (tagBadge) { e.stopPropagation(); openSpeciesTagPicker(tagBadge.dataset.name!); return; }
  const infoBtn = target.closest<HTMLElement>('.species-info-btn');
  if (infoBtn) {
    e.stopPropagation();
    openSpeciesInfoModal(infoBtn.dataset.speciesInfo!, infoBtn.dataset.speciesSci || undefined);
    return;
  }
  const galleryBtn = target.closest<HTMLElement>('.sp-photo-gallery');
  if (galleryBtn) { e.stopPropagation(); void onPickFromGallery(galleryBtn.dataset.name!); return; }
  const deviceBtn = target.closest<HTMLElement>('.sp-photo-device');
  if (deviceBtn) {
    e.stopPropagation();
    deviceBtn.parentElement!.querySelector<HTMLInputElement>('.sp-photo-file')!.click();
    return;
  }
  const obs = target.closest<HTMLElement>('.act-obs');
  if (obs) { e.stopPropagation(); navigate('cards', { filterSpecies: obs.dataset.name! }); return; }
  const report = target.closest<HTMLElement>('.act-report');
  if (report) { navigate('form', { species: report.dataset.name! }); return; }
  const groupHead = target.closest<HTMLElement>('.sp-group-head');
  if (groupHead) {
    const key = groupHead.dataset.group!;
    if (collapsedGroups.has(key)) collapsedGroups.delete(key);
    else collapsedGroups.add(key);
    render();
    return;
  }
  const tileHead = target.closest<HTMLElement>('.sp-tile-head');
  if (tileHead) {
    openKey = openKey === tileHead.dataset.name ? null : tileHead.dataset.name!;
    render();
    return;
  }
  const row = target.closest<HTMLElement>('.sp-row');
  if (row) {
    const card = row.closest<HTMLElement>('.sp-card')!;
    openKey = openKey === card.dataset.name ? null : card.dataset.name!;
    render();
  }
}

/** Lets the user set (or clear) a species' status badge directly from its
 * card/tile, in addition to the same field's editor in Settings. */
function openSpeciesTagPicker(name: string): void {
  const current = getManualSpeciesTag(name);
  const wrap = document.createElement('div');
  wrap.className = 'gallery-assoc-modal';
  wrap.innerHTML = `
    <h3>סיווג "${escapeHtml(name)}"</h3>
    <div class="gallery-assoc-list">
      <button type="button" class="map-sheet-item" data-tag="">
        <span class="map-sheet-item-species">אוטומטי (לפי מספר תצפיות)</span>
      </button>
      ${SPECIES_TAGS.map((tag) => `
        <button type="button" class="map-sheet-item" data-tag="${tag}">
          <span class="map-sheet-item-species">${icon(SPECIES_TAG_ICONS[tag])} ${SPECIES_TAG_LABELS[tag]}</span>
          ${current === tag ? `<span class="map-sheet-item-date">${icon('check')} נבחר</span>` : ''}
        </button>`).join('')}
    </div>
  `;
  const closeModal = showModal(wrap);
  wrap.querySelectorAll<HTMLElement>('[data-tag]').forEach((btn) => {
    btn.addEventListener('click', () => {
      closeModal();
      void doSetSpeciesTag(name, (btn.dataset.tag || '') as SpeciesTag | '');
    });
  });
}

async function doSetSpeciesTag(name: string, tag: SpeciesTag | ''): Promise<void> {
  await updateSpeciesDetails(name, { manualTag: tag });
  toast(tag ? `"${name}" סווג כ${SPECIES_TAG_LABELS[tag]}` : `הסיווג של "${name}" הוחזר לאוטומטי`);
  await activate();
}

/** "תמונה מהגלריה" — tags an existing not-yet-associated Gallery photo with
 * this species directly, via the shared orphan-photo picker. */
async function onPickFromGallery(name: string): Promise<void> {
  const count = await pickFromGalleryForSpecies(name);
  if (!count) return;
  toast(count === 1 ? 'התמונה שויכה למין' : `${count} תמונות שויכו למין`);
  await activate();
}

/** "תמונה מהמכשיר" — uploads new photo(s) straight from the device's file
 * picker (which on mobile also surfaces cloud sources like Google Photos),
 * tagging each one with this species directly. Same dedup-by-content-hash
 * check as the Gallery tab's own upload button. */
async function onPhotoFileChange(e: Event): Promise<void> {
  const fileInput = (e.target as HTMLElement).closest<HTMLInputElement>('.sp-photo-file');
  if (!fileInput) return;
  const name = fileInput.dataset.name!;
  const files = fileInput.files ? Array.from(fileInput.files) : [];
  fileInput.value = '';
  if (!files.length) return;
  let added = 0;
  let skipped = 0;
  for (const file of files) {
    const contentHash = await hashBlob(file);
    if (await findMediaByHash(contentHash)) { skipped++; continue; }
    const { date, source } = await resolvePhotoDate(file);
    await saveMedia({
      id: crypto.randomUUID(), obsId: '', name: file.name || 'image', mime: file.type, blob: file,
      takenAt: date.toISOString(), takenAtSource: source, contentHash, species: name,
    });
    added++;
  }
  if (skipped) toast(added ? `הועלו ${added} תמונות, ${skipped} דולגו (כבר קיימות בגלריה)` : `${skipped} תמונות דולגו — כבר קיימות בגלריה`);
  else if (added) toast(added === 1 ? 'התמונה נוספה ושויכה למין' : `${added} תמונות נוספו ושויכו למין`);
  await activate();
}

async function onDescriptionChange(e: Event): Promise<void> {
  const ta = (e.target as HTMLElement).closest<HTMLTextAreaElement>('.sp-desc-input');
  if (!ta) return;
  const name = ta.dataset.name!;
  descriptions[name] = ta.value;
  await setSpeciesDescription(name, ta.value);
  toast('התיאור נשמר');
}

/** Copies every species name lacking English/scientific/family details to
 * the clipboard, one per line — an exact, unambiguous text list (as opposed
 * to a screenshot, which risks a transcription error for compound Hebrew
 * bird names) to hand off for filling in the reference data. */
async function onCopyMissingDetails(): Promise<void> {
  const missing = names.filter((n) => !detailsFor(n).en).sort((a, b) => a.localeCompare(b, 'he'));
  if (!missing.length) { toast('לכל המינים ברשימה יש כבר פרטים מלאים'); return; }
  try {
    await navigator.clipboard.writeText(missing.join('\n'));
    toast(`הועתקו ${missing.length} שמות מינים ללא פרטים ללוח`);
  } catch {
    toast('ההעתקה ללוח נכשלה — ייתכן שהדפדפן חוסם הרשאת גישה', true, 5000);
  }
}

async function onAdd(): Promise<void> {
  const inp = input(container, '#sp-new');
  const name = inp.value.trim();
  if (!name) return;
  await addSpecies(name);
  inp.value = '';
  openKey = name;
  await activate();
  toast(`"${name}" נוסף לרשימת המינים`);
}
