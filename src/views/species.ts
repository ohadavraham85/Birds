/* views/species.ts — טאב "מינים": רשימת המינים עם פרטים (עברית/אנגלית/מדעי/משפחה),
 * חיפוש, קיבוץ לפי משפחה, מספר תצפיות לכל מין, תמונות מהתצפיות, תיאור אישי
 * לכל מין, וקישור לתצפיות. */

import { listSpeciesRows, addSpecies, setSpeciesDescription, listObservations } from '../db/repository';
import { SPECIES_DETAILS } from '../data/species-data';
import { toast, showImageModal, fmtDateTime, showModal } from '../lib/ui';
import { escapeHtml } from '../lib/markdown';
import { speciesNames, entriesOf, entryImages } from '../lib/observation';
import { getImageObjectUrl } from '../lib/media';
import { qs, input, select } from '../lib/dom';
import { icon } from '../lib/icons';
import { viewModeToggleHtml, wireViewModeToggle, syncViewModeToggle, type ViewDisplayMode } from '../lib/view-mode';
import { navigate } from '../main';
import type { ViewParams } from './view';
import type { SpeciesDetail, ObservationImage } from '../types';

type SortMode = 'family' | 'alpha' | 'recent' | 'seen' | 'project';
type SortDir = 'asc' | 'desc';

let container: HTMLElement;
let names: string[] = [];
let counts: Record<string, number> = {};
let descriptions: Record<string, string> = {};
let imagesByName: Record<string, { img: ObservationImage; obsId: string }[]> = {};
let lastObserved: Record<string, string> = {};
/** Every project name a species has been logged under, across all its observations — a species can span several projects, unlike location/family which are single-valued. */
let projectsByName: Record<string, Set<string>> = {};
let query = '';
let sortMode: SortMode = 'family';
/** 'asc' reproduces each mode's original default ordering; 'desc' reverses it — see the toggle button's dynamic tooltip for what's actually shown. */
let sortDir: SortDir = 'asc';
let selectedProjects = new Set<string>();
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
        <option value="project">קיבוץ לפי פרויקט</option>
        <option value="alpha">לפי א״ב</option>
        <option value="recent">לפי תצפית אחרונה</option>
      </select>
      <button type="button" class="btn btn-icon sp-filter-btn" id="sp-filter-btn" title="סינון לפי פרויקט" aria-label="סינון לפי פרויקט">
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
  input(container, '#sp-new').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); void onAdd(); } });
  qs(container, '#sp-list').addEventListener('click', onListClick);
  qs(container, '#sp-list').addEventListener('change', (e) => void onDescriptionChange(e));
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
  projectsByName = {};
  for (const o of obs) {
    const project = o.project || '(ללא פרויקט)';
    for (const name of speciesNames(o)) {
      counts[name] = (counts[name] || 0) + 1;
      if (!lastObserved[name] || o.dateTime > lastObserved[name]!) lastObserved[name] = o.dateTime;
      (projectsByName[name] ??= new Set()).add(project);
    }
    for (const entry of entriesOf(o)) {
      const imgs = entryImages(entry);
      if (entry.species && imgs.length) {
        (imagesByName[entry.species] ??= []).push(...imgs.map((img) => ({ img, obsId: o.id })));
      }
    }
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
  return SPECIES_DETAILS[name] || { he: name, en: '', sci: '', family: '' };
}

function matches(name: string): boolean {
  const q = query.trim().toLowerCase();
  if (q) {
    const d = detailsFor(name);
    if (!`${d.he} ${d.en} ${d.sci} ${d.family}`.toLowerCase().includes(q)) return false;
  }
  if (selectedProjects.size) {
    const projects = projectsByName[name] ?? new Set(['(ללא פרויקט)']);
    if (![...projects].some((p) => selectedProjects.has(p))) return false;
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

/* ---------- advanced filter modal (by project) ---------- */

function openFilterModal(): void {
  const projects = [...new Set(Object.values(projectsByName).flatMap((s) => [...s]))].sort((a, b) => a.localeCompare(b, 'he'));
  const localSet = new Set(selectedProjects);

  const wrap = document.createElement('div');
  wrap.className = 'filter-modal';
  wrap.innerHTML = `
    <h3>סינון לפי פרויקט</h3>
    <div class="filter-modal-section">
      <div class="filter-modal-checks">
        ${projects.map((p) => `
          <label class="filter-modal-check">
            <input type="checkbox" value="${escapeHtml(p)}" ${localSet.has(p) ? 'checked' : ''}>
            <span>${escapeHtml(p)}</span>
          </label>`).join('') || '<p class="hint">אין פרויקטים עדיין</p>'}
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
    selectedProjects = localSet;
    close();
    render();
  });
  wrap.querySelector('#filter-clear')!.addEventListener('click', () => {
    selectedProjects = new Set();
    close();
    render();
  });
}

function render(): void {
  syncViewModeToggle(container, 'sp-view-mode', displayMode);
  const filterCount = selectedProjects.size;
  const badge = qs(container, '#sp-filter-badge');
  badge.hidden = !filterCount;
  badge.textContent = String(filterCount);
  qs(container, '#sp-filter-btn').classList.toggle('active', !!filterCount);
  const sortBtn = qs(container, '#sp-sort-btn');
  sortBtn.innerHTML = icon('sortArrows', sortDir === 'desc' ? 'icon-flip' : '');
  sortBtn.title = sortDir === 'asc' ? 'מוצג: סדר רגיל' : 'מוצג: סדר הפוך';

  const list = names.filter(matches);
  const withDetails = names.filter((n) => detailsFor(n).en).length;
  qs(container, '#sp-summary').textContent =
    `${names.length} מינים ברשימה · ${withDetails} עם פרטים מלאים` + (query || filterCount ? ` · ${list.length} תואמים לסינון` : '');

  const el = qs(container, '#sp-list');
  if (!list.length) { el.innerHTML = '<p style="color:var(--ink-soft)">אין מין תואם.</p>'; return; }

  if (sortMode === 'family' || sortMode === 'seen' || sortMode === 'project') {
    const groups = new Map<string, string[]>();
    for (const n of list) {
      const keys = sortMode === 'family' ? [detailsFor(n).family || '(ללא משפחה)']
        : sortMode === 'seen' ? [counts[n] ? 'נצפה' : 'לא נצפה']
        : [...(projectsByName[n] ?? new Set(['(ללא פרויקט)']))];
      for (const key of keys) (groups.get(key) ?? groups.set(key, []).get(key)!).push(n);
    }
    const keys = sortMode === 'seen'
      ? (sortDir === 'asc' ? ['נצפה', 'לא נצפה'] : ['לא נצפה', 'נצפה']).filter((k) => groups.has(k))
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
  } else {
    el.innerHTML = itemsHtml(sortAlpha(list));
  }
  renderOpenPhotos();
  renderTileThumbnails();
}

/** Fills the open card's photo gallery (thumbnails resolved async, like the journal cards). */
function renderOpenPhotos(): void {
  if (!openKey) return;
  const wrap = [...container.querySelectorAll<HTMLElement>('.sp-photos')].find((w) => w.dataset.name === openKey);
  if (!wrap) return;
  const photos = imagesByName[openKey] || [];
  wrap.innerHTML = '';
  for (const { img, obsId } of photos) {
    const el = document.createElement('img');
    el.loading = 'lazy';
    el.alt = openKey;
    wrap.appendChild(el);
    void getImageObjectUrl(img, obsId).then((url) => {
      if (url) { el.src = url; el.onclick = (): void => showImageModal(url, openKey || ''); }
      else el.remove();
    });
  }
}

/** Fills each closed tile's thumbnail (square/rect view modes) with the species' first available photo. */
function renderTileThumbnails(): void {
  for (const media of container.querySelectorAll<HTMLElement>('.sp-tile-media[data-name]')) {
    const name = media.dataset.name!;
    const first = (imagesByName[name] || [])[0];
    if (!first) continue;
    void getImageObjectUrl(first.img, first.obsId).then((url) => {
      if (!url) return;
      media.innerHTML = '';
      const el = document.createElement('img');
      el.src = url;
      el.alt = name;
      el.loading = 'lazy';
      media.appendChild(el);
    });
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
        <div class="sp-photos-label">${icon('camera')} ${photoCount} תמונות מהתצפיות</div>
        <div class="sp-photos" data-name="${escapeHtml(name)}"></div>` : ''}
      <div class="field sp-desc-field">
        <label for="sp-desc-${escapeHtml(name)}">תיאור אישי</label>
        <textarea id="sp-desc-${escapeHtml(name)}" class="sp-desc-input" data-name="${escapeHtml(name)}"
          placeholder="הוסיפו כאן תיאור, סימני זיהוי, מיקומים מועדפים...">${escapeHtml(desc)}</textarea>
      </div>
      <div class="sp-actions">
        ${n ? `<button class="btn btn-sm btn-primary act-obs" data-name="${escapeHtml(name)}">${icon('list')} הצגת ${n} התצפיות</button>` : ''}
        <button class="btn btn-sm act-report" data-name="${escapeHtml(name)}">${icon('plus')} דיווח תצפית</button>
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

async function onDescriptionChange(e: Event): Promise<void> {
  const ta = (e.target as HTMLElement).closest<HTMLTextAreaElement>('.sp-desc-input');
  if (!ta) return;
  const name = ta.dataset.name!;
  descriptions[name] = ta.value;
  await setSpeciesDescription(name, ta.value);
  toast('התיאור נשמר');
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
