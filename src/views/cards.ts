/* views/cards.ts — מסך יומן (ראשי): כרטיס לכל תצפית עם מיקום לחיץ (מפות),
 * רשימת מינים ממוספרת, הערה ותמונות לכל מין. לחיצה על כרטיס פותחת מסך צפייה
 * (View Mode) בלבד — העריכה עוברת דרך כפתור ייעודי שם. כולל קיבוץ/מיון לפי
 * תאריך, מיקום או פרויקט, וכפתור FAB להוספת תצפית. */

import { listObservations } from '../db/repository';
import { renderObservationCard } from '../lib/obs-card';
import { renderObservationTile } from '../lib/tile-card';
import { speciesNames } from '../lib/observation';
import { escapeHtml } from '../lib/markdown';
import { showModal } from '../lib/ui';
import { icon } from '../lib/icons';
import { viewModeToggleHtml, wireViewModeToggle, syncViewModeToggle, type ViewDisplayMode } from '../lib/view-mode';
import { qs, input, select } from '../lib/dom';
import { navigate } from '../main';
import type { Observation } from '../types';
import type { ViewParams } from './view';

type GroupMode = 'none' | 'day' | 'month' | 'location' | 'project';
type SortDir = 'desc' | 'asc';

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
      <button type="button" class="btn btn-icon" id="j-sort-btn" title="היפוך סדר כרונולוגי" aria-label="היפוך סדר כרונולוגי">${icon('sortArrows')}</button>
      <button type="button" class="btn btn-icon" id="j-expand-all" title="פתיחת כל הקבוצות" aria-label="פתיחת כל הקבוצות">${icon('chevronsDown')}</button>
      <button type="button" class="btn btn-icon" id="j-collapse-all" title="סגירת כל הקבוצות" aria-label="סגירת כל הקבוצות">${icon('chevronsUp')}</button>
      ${viewModeToggleHtml('j-view-mode')}
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
  qs(container, '#j-sort-btn').addEventListener('click', () => {
    sortDir = sortDir === 'desc' ? 'asc' : 'desc';
    render();
  });
  qs(container, '#j-expand-all').addEventListener('click', () => { collapsedGroups = new Set(); render(); });
  qs(container, '#j-collapse-all').addEventListener('click', () => {
    collapsedGroups = new Set(groupsOf(observations.filter(matches)).keys());
    render();
  });
}

/** Drill-down from the stats tab: pre-applies a single-value filter and clears the rest. */
export function setParams(params: ViewParams): void {
  if (!params.filterSpecies && !params.filterLocation && !params.filterProject) return;
  selectedSpecies = params.filterSpecies ? new Set([params.filterSpecies]) : new Set();
  selectedLocations = params.filterLocation ? new Set([params.filterLocation]) : new Set();
  selectedProjects = params.filterProject ? new Set([params.filterProject]) : new Set();
  query = '';
  groupBy = 'none';
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
  qs<HTMLButtonElement>(container, '#j-expand-all').hidden = groupBy === 'none';
  qs<HTMLButtonElement>(container, '#j-collapse-all').hidden = groupBy === 'none';
  const sortBtn = qs(container, '#j-sort-btn');
  sortBtn.innerHTML = icon('sortArrows', sortDir === 'asc' ? 'icon-flip' : '');
  sortBtn.title = sortDir === 'desc' ? 'מוצג: מהחדש לישן' : 'מוצג: מהישן לחדש';
  syncViewModeToggle(container, 'j-view-mode', displayMode);

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
  const card = renderObservationCard(o);
  card.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    if (target.closest('.place-link, .species-imgs img')) return;
    navigate('detail', { viewId: o.id });
  });
  return card;
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
