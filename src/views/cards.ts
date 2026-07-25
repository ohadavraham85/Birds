/* views/cards.ts — מסך יומן (ראשי): כרטיס לכל תצפית עם מיקום לחיץ (מפות),
 * רשימת מינים ממוספרת, הערה ותמונות לכל מין. לחיצה על כרטיס פותחת מסך צפייה
 * (View Mode) בלבד — העריכה עוברת דרך כפתור ייעודי שם. כולל קיבוץ/מיון לפי
 * תאריך, מיקום או פרויקט, וכפתור FAB להוספת תצפית. */

import { listObservations, deleteObservation } from '../db/repository';
import { renderObservationSummary } from '../lib/obs-card';
import { renderObservationTile } from '../lib/tile-card';
import { speciesNames } from '../lib/observation';
import { escapeHtml } from '../lib/markdown';
import { showModal, confirmDialog, toast, withBusyButton } from '../lib/ui';
import { wrapSwipeActions } from '../lib/swipe-actions';
import { openBulkEditModal, applyBulkEdit } from '../lib/bulk-edit';
import { exportObservationsExcel } from '../lib/export-excel';
import { exportObservationsPdf } from '../lib/pdf';
import { icon } from '../lib/icons';
import { viewModeToggleHtml, wireViewModeToggle, syncViewModeToggle, type ViewDisplayMode } from '../lib/view-mode';
import { qs, input, select } from '../lib/dom';
import { navigate } from '../main';
import type { Observation } from '../types';
import type { ViewParams } from './view';

type GroupMode = 'none' | 'day' | 'month' | 'location' | 'project';
type SortDir = 'desc' | 'asc';

const LONG_PRESS_MS = 500;
const LONG_PRESS_MOVE_TOLERANCE = 10;

let container: HTMLElement;
let observations: Observation[] = [];
let groupBy: GroupMode = 'none';
let sortDir: SortDir = 'desc';
let query = '';
let displayMode: ViewDisplayMode = 'list';
let collapsedGroups = new Set<string>();
let selectedProjects = new Set<string>();
let selectedLocations = new Set<string>();
let selectedSpecies = new Set<string>();
let starredOnly = false;
/** Date-range drill-down from the home screen's "תצפיות" stats tile (YYYY-MM-DD, inclusive; '' = unbounded). */
let filterFrom = '';
let filterTo = '';
/** Long-press-activated multi-select mode (list display only) — lets the
 * journal reach the same bulk-edit / bulk-export the table view used to
 * offer, now that the table is no longer directly reachable from the menu. */
let selectionMode = false;
let selectedIds = new Set<string>();

export function init(el: HTMLElement): void {
  container = el;
  container.innerHTML = `
    <h2>יומן תצפית</h2>
    <div class="filter-bar">
      <input type="search" id="j-q" class="filter-search" placeholder="חיפוש (מין, מיקום, פרויקט, הערות)...">
      <select id="j-group" class="filter-sel">
        <option value="none">ללא קיבוץ</option>
        <option value="day">קיבוץ לפי יום</option>
        <option value="month">קיבוץ לפי חודש</option>
        <option value="location">קיבוץ לפי מיקום</option>
        <option value="project">קיבוץ לפי פרויקט</option>
      </select>
      <button type="button" class="btn btn-icon j-filter-btn" id="j-filter-btn" title="סינון מתקדם" aria-label="סינון מתקדם">
        ${icon('filter')}<span class="filter-badge" id="j-filter-badge" hidden></span>
      </button>
      <button type="button" class="btn btn-icon j-starred-btn" id="j-starred-btn" title="הצגת מועדפים בלבד" aria-label="הצגת מועדפים בלבד">${icon('star')}</button>
      <button type="button" class="btn btn-icon" id="j-sort-btn" title="היפוך סדר כרונולוגי" aria-label="היפוך סדר כרונולוגי">${icon('sortArrows')}</button>
      <button type="button" class="btn btn-icon" id="j-expand-all" title="פתיחת כל הקבוצות" aria-label="פתיחת כל הקבוצות">${icon('chevronsDown')}</button>
      <button type="button" class="btn btn-icon" id="j-collapse-all" title="סגירת כל הקבוצות" aria-label="סגירת כל הקבוצות">${icon('chevronsUp')}</button>
      ${viewModeToggleHtml('j-view-mode')}
    </div>
    <div class="bulk-toolbar" id="j-bulk-toolbar" hidden>
      <span id="j-bulk-count"></span>
      <button type="button" class="btn btn-sm btn-primary" id="j-bulk-edit">${icon('edit')} עריכה מרוכזת</button>
      <div class="export-wrap">
        <button type="button" class="btn btn-sm" id="j-bulk-export-btn">${icon('download')} ייצוא ▾</button>
        <div class="export-menu" id="j-bulk-export-menu" hidden>
          <button type="button" data-fmt="excel">${icon('grid')} Excel (CSV)</button>
          <button type="button" data-fmt="pdf">${icon('document')} PDF</button>
        </div>
      </div>
      <span class="spacer"></span>
      <button type="button" class="btn btn-sm" id="j-bulk-cancel">ביטול</button>
    </div>
    <div id="cards-feed-wrap"></div>
  `;
  wireViewModeToggle(container, 'j-view-mode', (mode) => { displayMode = mode; render(); });
  input(container, '#j-q').addEventListener('input', (e) => { query = (e.target as HTMLInputElement).value; render(); });
  select(container, '#j-group').addEventListener('change', (e) => {
    groupBy = (e.target as HTMLSelectElement).value as GroupMode;
    render();
  });
  qs(container, '#j-filter-btn').addEventListener('click', openFilterModal);
  qs(container, '#j-starred-btn').addEventListener('click', () => { starredOnly = !starredOnly; render(); });
  qs(container, '#j-sort-btn').addEventListener('click', () => {
    sortDir = sortDir === 'desc' ? 'asc' : 'desc';
    render();
  });
  qs(container, '#j-expand-all').addEventListener('click', () => { collapsedGroups = new Set(); render(); });
  qs(container, '#j-collapse-all').addEventListener('click', () => {
    collapsedGroups = new Set(groupsOf(observations.filter(matches)).keys());
    render();
  });

  qs(container, '#j-bulk-cancel').addEventListener('click', () => { exitSelectionMode(); render(); });
  qs(container, '#j-bulk-edit').addEventListener('click', () => void onBulkEditSelected());
  const bulkExportBtn = qs<HTMLButtonElement>(container, '#j-bulk-export-btn');
  const bulkExportMenu = qs(container, '#j-bulk-export-menu');
  bulkExportBtn.addEventListener('click', (e) => { e.stopPropagation(); bulkExportMenu.hidden = !bulkExportMenu.hidden; });
  bulkExportMenu.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-fmt]');
    if (!b) return;
    bulkExportMenu.hidden = true;
    const selectedObs = observations.filter((o) => selectedIds.has(o.id));
    if (b.dataset.fmt === 'excel') exportObservationsExcel(selectedObs);
    else void withBusyButton(bulkExportBtn, 'מייצא...', () => exportObservationsPdf(selectedObs))
      .catch((err: Error) => toast('הפקת ה-PDF נכשלה: ' + err.message, true, 5000));
  });
  document.addEventListener('click', (e) => {
    if (!bulkExportMenu.hidden && !(e.target as HTMLElement).closest('.export-wrap')) bulkExportMenu.hidden = true;
  });
}

function exitSelectionMode(): void {
  selectionMode = false;
  selectedIds = new Set();
}

async function onBulkEditSelected(): Promise<void> {
  if (!selectedIds.size) return;
  const result = await openBulkEditModal(selectedIds.size, observations);
  if (!result) return;
  const changeParts: string[] = [];
  if ('project' in result) changeParts.push(`פרויקט → "${result.project}"`);
  if ('location' in result) changeParts.push(`מיקום → "${result.location!.name}"`);
  if (!(await confirmDialog(`לעדכן ${selectedIds.size} תצפיות: ${changeParts.join(', ')}? הפעולה אינה הפיכה אוטומטית.`, 'עדכון'))) return;
  const updated = await applyBulkEdit([...selectedIds], result);
  exitSelectionMode();
  await activate();
  toast(`${updated} תצפיות עודכנו ✓`);
}

/** Drill-down from the stats tab / home screen: pre-applies exactly one of a
 * single-value filter, a date range, or a grouping mode, clearing the rest. */
export function setParams(params: ViewParams): void {
  if (params.filterSpecies || params.filterLocation || params.filterProject) {
    selectedSpecies = params.filterSpecies ? new Set([params.filterSpecies]) : new Set();
    selectedLocations = params.filterLocation ? new Set([params.filterLocation]) : new Set();
    selectedProjects = params.filterProject ? new Set([params.filterProject]) : new Set();
    filterFrom = '';
    filterTo = '';
    query = '';
    groupBy = 'none';
    return;
  }
  if (params.filterFrom !== undefined || params.filterTo !== undefined) {
    filterFrom = params.filterFrom || '';
    filterTo = params.filterTo || '';
    selectedSpecies = new Set();
    selectedLocations = new Set();
    selectedProjects = new Set();
    query = '';
    groupBy = 'none';
    return;
  }
  if (params.groupBy) {
    groupBy = params.groupBy;
    selectedSpecies = new Set();
    selectedLocations = new Set();
    selectedProjects = new Set();
    filterFrom = '';
    filterTo = '';
    query = '';
  }
}

export async function activate(): Promise<void> {
  observations = await listObservations();
  render();
}

function matches(o: Observation): boolean {
  const q = query.trim().toLowerCase();
  if (q) {
    const haystack = [o.locationName, o.project, o.notes, ...speciesNames(o)].join(' ').toLowerCase();
    if (!haystack.includes(q)) return false;
  }
  if (selectedProjects.size && !selectedProjects.has(o.project || '(ללא פרויקט)')) return false;
  if (selectedLocations.size && !selectedLocations.has(o.locationName || '(ללא מיקום)')) return false;
  if (selectedSpecies.size && !speciesNames(o).some((s) => selectedSpecies.has(s))) return false;
  if (starredOnly && !o.starred) return false;
  const day = o.dateTime.slice(0, 10);
  if (filterFrom && day < filterFrom) return false;
  if (filterTo && day > filterTo) return false;
  return true;
}

/* ---------- advanced filter modal ---------- */

function openFilterModal(): void {
  const projects = [...new Set(observations.map((o) => o.project || '(ללא פרויקט)'))].sort((a, b) => a.localeCompare(b, 'he'));
  const locations = [...new Set(observations.map((o) => o.locationName || '(ללא מיקום)'))].sort((a, b) => a.localeCompare(b, 'he'));
  const species = [...new Set(observations.flatMap(speciesNames))].sort((a, b) => a.localeCompare(b, 'he'));

  const localSets: Record<'project' | 'location' | 'species', Set<string>> = {
    project: new Set(selectedProjects),
    location: new Set(selectedLocations),
    species: new Set(selectedSpecies),
  };

  const section = (title: string, group: 'project' | 'location' | 'species', values: string[]): string => `
    <div class="filter-modal-section">
      <h4>${escapeHtml(title)}</h4>
      <div class="filter-modal-checks">
        ${values.map((v) => `
          <label class="filter-modal-check">
            <input type="checkbox" data-group="${group}" value="${escapeHtml(v)}" ${localSets[group].has(v) ? 'checked' : ''}>
            <span>${escapeHtml(v)}</span>
          </label>`).join('') || '<p class="hint">אין ערכים</p>'}
      </div>
    </div>`;

  const wrap = document.createElement('div');
  wrap.className = 'filter-modal';
  wrap.innerHTML = `
    <h3>סינון מתקדם</h3>
    ${section('פרויקט', 'project', projects)}
    ${section('מיקום', 'location', locations)}
    ${section('מין', 'species', species)}
    <div class="modal-actions">
      <button type="button" class="btn btn-primary" id="filter-apply">החלת סינון</button>
      <button type="button" class="btn" id="filter-clear">נקה סינון</button>
    </div>
  `;
  const close = showModal(wrap);

  wrap.querySelectorAll<HTMLInputElement>('input[type=checkbox]').forEach((cb) => {
    cb.addEventListener('change', () => {
      const group = cb.dataset.group as 'project' | 'location' | 'species';
      if (cb.checked) localSets[group].add(cb.value);
      else localSets[group].delete(cb.value);
    });
  });
  wrap.querySelector('#filter-apply')!.addEventListener('click', () => {
    selectedProjects = localSets.project;
    selectedLocations = localSets.location;
    selectedSpecies = localSets.species;
    close();
    render();
  });
  wrap.querySelector('#filter-clear')!.addEventListener('click', () => {
    selectedProjects = new Set();
    selectedLocations = new Set();
    selectedSpecies = new Set();
    close();
    render();
  });
}

function dayKey(iso: string): string {
  const d = new Date(iso);
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function monthKey(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function groupOf(o: Observation): { key: string; label: string } {
  switch (groupBy) {
    case 'day': {
      const key = dayKey(o.dateTime);
      const label = new Date(o.dateTime).toLocaleDateString('he-IL', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
      return { key, label };
    }
    case 'month': {
      const key = monthKey(o.dateTime);
      const label = new Date(o.dateTime).toLocaleDateString('he-IL', { month: 'long', year: 'numeric' });
      return { key, label };
    }
    case 'location': {
      const label = o.locationName || '(ללא מיקום)';
      return { key: label, label };
    }
    case 'project': {
      const label = o.project || '(ללא פרויקט)';
      return { key: label, label };
    }
    default:
      return { key: '', label: '' };
  }
}

function groupsOf(list: Observation[]): Map<string, { label: string; items: Observation[] }> {
  const groups = new Map<string, { label: string; items: Observation[] }>();
  for (const o of list) {
    const { key, label } = groupOf(o);
    (groups.get(key) ?? groups.set(key, { label, items: [] }).get(key)!).items.push(o);
  }
  return groups;
}

function render(): void {
  input(container, '#j-q').value = query;
  select(container, '#j-group').value = groupBy;
  const filterCount = selectedProjects.size + selectedLocations.size + selectedSpecies.size;
  const badge = qs(container, '#j-filter-badge');
  badge.hidden = !filterCount;
  badge.textContent = String(filterCount);
  qs(container, '#j-filter-btn').classList.toggle('active', !!filterCount);
  qs(container, '#j-starred-btn').classList.toggle('active', starredOnly);
  qs<HTMLButtonElement>(container, '#j-expand-all').hidden = groupBy === 'none';
  qs<HTMLButtonElement>(container, '#j-collapse-all').hidden = groupBy === 'none';
  const sortBtn = qs(container, '#j-sort-btn');
  sortBtn.innerHTML = icon('sortArrows', sortDir === 'asc' ? 'icon-flip' : '');
  sortBtn.title = sortDir === 'desc' ? 'מוצג: מהחדש לישן' : 'מוצג: מהישן לחדש';
  syncViewModeToggle(container, 'j-view-mode', displayMode);
  qs(container, '#j-bulk-toolbar').hidden = !selectionMode;
  qs(container, '#j-bulk-count').textContent = selectionMode ? `${selectedIds.size} נבחרו` : '';

  const wrap = qs(container, '#cards-feed-wrap');
  wrap.innerHTML = '';
  if (!observations.length) {
    wrap.innerHTML = '<p style="color:var(--ink-soft)">אין עדיין תצפיות — הוסיפו תצפית עם כפתור ההוספה.</p>';
    return;
  }

  // observations is DB-sorted newest-first; asc just reverses that.
  const filtered = observations.filter(matches);
  const list = sortDir === 'asc' ? [...filtered].reverse() : filtered;
  if (!list.length) {
    wrap.innerHTML = '<p style="color:var(--ink-soft)">אין תצפיות תואמות לסינון.</p>';
    return;
  }

  const feed = document.createElement('div');
  feed.className = 'cards-feed';
  wrap.appendChild(feed);

  if (groupBy === 'none') {
    appendItems(feed, list);
    return;
  }

  const groups = groupsOf(list);
  const keys = [...groups.keys()].sort((a, b) => {
    if (groupBy !== 'day' && groupBy !== 'month') return a.localeCompare(b, 'he');
    const cmp = a < b ? -1 : a > b ? 1 : 0;
    return sortDir === 'desc' ? -cmp : cmp;
  });
  for (const key of keys) {
    const group = groups.get(key)!;
    const collapsed = collapsedGroups.has(key);
    const head = document.createElement('button');
    head.type = 'button';
    head.className = 'cards-group-head';
    head.dataset.group = key;
    head.innerHTML = `
      <span>${escapeHtml(group.label)} <span class="cards-group-n">${group.items.length}</span></span>
      <span class="sp-caret">${collapsed ? '▼' : '▲'}</span>`;
    head.addEventListener('click', () => {
      if (collapsedGroups.has(key)) collapsedGroups.delete(key);
      else collapsedGroups.add(key);
      render();
    });
    feed.appendChild(head);
    if (!collapsed) appendItems(feed, group.items);
  }
}

/** Renders `items` either as full cards (list mode) or into a tile grid (square/rect mode). */
function appendItems(feed: HTMLElement, items: Observation[]): void {
  if (displayMode === 'list') {
    for (const o of items) feed.appendChild(cardWithClick(o));
    return;
  }
  const grid = document.createElement('div');
  grid.className = `obs-tile-grid obs-tile-grid-${displayMode}`;
  for (const o of items) grid.appendChild(tileWithClick(o));
  feed.appendChild(grid);
}

function cardWithClick(o: Observation): HTMLElement {
  if (selectionMode) return selectableCard(o);
  const card = renderObservationSummary(o);
  const wrapped = wrapSwipeActions(card, {
    onTap: (e) => {
      const target = e.target as HTMLElement;
      if (target.closest('.place-link')) return;
      navigate('detail', { viewId: o.id });
    },
    onEdit: () => navigate('form', { editId: o.id }),
    onDelete: () => void onSwipeDelete(o),
  });
  attachLongPress(wrapped, () => {
    selectionMode = true;
    selectedIds.add(o.id);
    render();
  });
  return wrapped;
}

/** A simplified, checkbox-style row shown once selection mode is active —
 * tapping anywhere toggles the observation instead of opening its detail
 * view or revealing swipe actions. */
function selectableCard(o: Observation): HTMLElement {
  const card = renderObservationSummary(o);
  const checked = selectedIds.has(o.id);
  const wrap = document.createElement('div');
  wrap.className = `select-item${checked ? ' select-item-checked' : ''}`;
  wrap.innerHTML = `<span class="select-check">${icon('check')}</span>`;
  wrap.appendChild(card);
  wrap.addEventListener('click', () => {
    if (selectedIds.has(o.id)) selectedIds.delete(o.id); else selectedIds.add(o.id);
    if (!selectedIds.size) selectionMode = false;
    render();
  });
  return wrap;
}

/** Fires `onLongPress` after a ~500ms hold that doesn't move much and isn't
 * released early — independent of swipe-actions.ts's own gesture handling,
 * since both listen on the same element without interfering with each other. */
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

async function onSwipeDelete(o: Observation): Promise<void> {
  if (!(await confirmDialog('למחוק את התצפית?', 'מחיקה'))) return;
  await deleteObservation(o.id);
  observations = observations.filter((x) => x.id !== o.id);
  render();
}

function tileWithClick(o: Observation): HTMLElement {
  const tile = renderObservationTile(o, displayMode === 'rect' ? 'rect' : 'square');
  tile.addEventListener('click', () => navigate('detail', { viewId: o.id }));
  return tile;
}

// Called by the FAB in the app chrome.
export function newObservation(): void {
  navigate('form');
}
