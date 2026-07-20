/* views/species.ts — טאב "מינים": רשימת המינים עם פרטים (עברית/אנגלית/מדעי/משפחה),
 * חיפוש, קיבוץ לפי משפחה, מספר תצפיות לכל מין, תמונות מהתצפיות, תיאור אישי
 * לכל מין, וקישור לתצפיות. */

import { listSpeciesRows, addSpecies, setSpeciesDescription, listObservations } from '../db/repository';
import { SPECIES_DETAILS } from '../data/species-data';
import { toast, showImageModal, fmtDateTime } from '../lib/ui';
import { escapeHtml } from '../lib/markdown';
import { speciesNames, entriesOf, entryImages } from '../lib/observation';
import { getImageObjectUrl } from '../lib/media';
import { qs, input, select } from '../lib/dom';
import { icon } from '../lib/icons';
import { viewModeToggleHtml, wireViewModeToggle, syncViewModeToggle, type ViewDisplayMode } from '../lib/view-mode';
import { navigate } from '../main';
import type { ViewParams } from './view';
import type { SpeciesDetail, ObservationImage } from '../types';

type SortMode = 'family' | 'alpha' | 'recent' | 'seen';

let container: HTMLElement;
let names: string[] = [];
let counts: Record<string, number> = {};
let descriptions: Record<string, string> = {};
let imagesByName: Record<string, { img: ObservationImage; obsId: string }[]> = {};
let lastObserved: Record<string, string> = {};
let query = '';
let sortMode: SortMode = 'family';
let displayMode: ViewDisplayMode = 'list';
let openKey: string | null = null;
let collapsedGroups = new Set<string>();

export function init(el: HTMLElement): void {
  container = el;
  container.innerHTML = `
    <h2>רשימת המינים</h2>
    <div class="filter-bar">
      <input type="search" id="sp-q" class="filter-search" placeholder="חיפוש מין (עברית / אנגלית / מדעי / משפחה)...">
      <select id="sp-group" class="filter-sel">
        <option value="family">קיבוץ לפי משפחה</option>
        <option value="seen">נצפה / לא נצפה</option>
        <option value="alpha">לפי א״ב</option>
        <option value="recent">לפי תצפית אחרונה</option>
      </select>
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
  qs(container, '#sp-add').addEventListener('click', () => void onAdd());
  input(container, '#sp-new').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); void onAdd(); } });
  qs(container, '#sp-list').addEventListener('click', onListClick);
  qs(container, '#sp-list').addEventListener('change', (e) => void onDescriptionChange(e));
}

/** Opens a specific species' card directly (e.g. from the home screen's
 * "Bird of the Day" widget) instead of the default collapsed list. */
export function setParams(params: ViewParams): void {
  if (params.species) openKey = params.species;
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
  for (const o of obs) {
    for (const name of speciesNames(o)) {
      counts[name] = (counts[name] || 0) + 1;
      if (!lastObserved[name] || o.dateTime > lastObserved[name]!) lastObserved[name] = o.dateTime;
    }
    for (const entry of entriesOf(o)) {
      const imgs = entryImages(entry);
      if (entry.species && imgs.length) {
        (imagesByName[entry.species] ??= []).push(...imgs.map((img) => ({ img, obsId: o.id })));
      }
    }
  }
  render();
}

function detailsFor(name: string): SpeciesDetail {
  return SPECIES_DETAILS[name] || { he: name, en: '', sci: '', family: '' };
}

function matches(name: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const d = detailsFor(name);
  return `${d.he} ${d.en} ${d.sci} ${d.family}`.toLowerCase().includes(q);
}

function itemsHtml(list: string[]): string {
  if (displayMode === 'list') return list.map(cardHtml).join('');
  return `<div class="obs-tile-grid obs-tile-grid-${displayMode}">${list.map((n) => tileHtml(n, displayMode)).join('')}</div>`;
}

function render(): void {
  syncViewModeToggle(container, 'sp-view-mode', displayMode);
  const list = names.filter(matches);
  const withDetails = names.filter((n) => detailsFor(n).en).length;
  qs(container, '#sp-summary').textContent =
    `${names.length} מינים ברשימה · ${withDetails} עם פרטים מלאים` + (query ? ` · ${list.length} תואמים לחיפוש` : '');

  const el = qs(container, '#sp-list');
  if (!list.length) { el.innerHTML = '<p style="color:var(--ink-soft)">אין מין תואם.</p>'; return; }

  if (sortMode === 'family' || sortMode === 'seen') {
    const groups = new Map<string, string[]>();
    for (const n of list) {
      const key = sortMode === 'family' ? (detailsFor(n).family || '(ללא משפחה)') : (counts[n] ? 'נצפה' : 'לא נצפה');
      (groups.get(key) ?? groups.set(key, []).get(key)!).push(n);
    }
    const keys = sortMode === 'seen'
      ? ['נצפה', 'לא נצפה'].filter((k) => groups.has(k))
      : [...groups.keys()].sort((a, b) => a.localeCompare(b, 'he'));
    el.innerHTML = keys.map((key) => {
      const items = groups.get(key)!.sort((a, b) => a.localeCompare(b, 'he'));
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
      if (la && lb) return la < lb ? 1 : la > lb ? -1 : 0;
      if (la) return -1;
      if (lb) return 1;
      return a.localeCompare(b, 'he');
    });
    el.innerHTML = itemsHtml(sorted);
  } else {
    el.innerHTML = itemsHtml([...list].sort((a, b) => a.localeCompare(b, 'he')));
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
  if (obs) { e.stopPropagation(); navigate('table', { species: obs.dataset.name! }); return; }
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
