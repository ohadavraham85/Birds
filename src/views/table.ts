/* views/table.ts — רשימת התצפיות: סינון (חיפוש + מין + פרויקט + טווח תאריכים),
 * מיון לפי עמודה, קיבוץ (פרויקט / מין), סימון מרובה, וייצוא Excel/PDF. */

import {
  listObservations, deleteObservation, saveObservation, listSpecies, addSpecies,
} from '../db/repository';
import { toast, fmtDateTime, fmtCoords, confirmDialog } from '../lib/ui';
import { escapeHtml } from '../lib/markdown';
import { parseCsv, toCsv, mapHeaders, parseCoordinates, parseDateTime, type HeaderMap, type CsvField } from '../lib/csv';
import { exportObservationsPdf } from '../lib/pdf';
import { qs, input, select } from '../lib/dom';
import { speciesNames, totalQuantity, hasSpecies, primarySpecies, speciesLabel, entriesOf } from '../lib/observation';
import { navigate } from '../main';
import type { ViewParams } from './view';
import type { Observation } from '../types';

let container: HTMLElement;
let selected = new Set<string>();
let observations: Observation[] = [];
let filtered: Observation[] = [];
const filters = { q: '', species: '', project: '', from: '', to: '' };
let groupBy: 'none' | 'project' | 'species' = 'none';
let sortBy: 'dateTime' | 'species' | 'quantity' | 'locationName' | 'project' = 'dateTime';
let sortDir: 'asc' | 'desc' = 'desc';

export function init(el: HTMLElement): void {
  container = el;
  container.innerHTML = `
    <h2>רשימת תצפיות</h2>
    <div class="filter-bar">
      <input type="search" id="flt-q" class="filter-search" placeholder="🔍 חיפוש (מין, מיקום, פרויקט, הערות)...">
      <select id="flt-species" class="filter-sel"><option value="">כל המינים</option></select>
      <select id="flt-project" class="filter-sel"><option value="">כל הפרויקטים</option></select>
      <select id="flt-group" class="filter-sel">
        <option value="none">ללא קיבוץ</option>
        <option value="project">קיבוץ לפי פרויקט</option>
        <option value="species">קיבוץ לפי מין</option>
      </select>
      <label class="date-range">מ־<input type="date" id="flt-from" title="מתאריך"></label>
      <label class="date-range">עד<input type="date" id="flt-to" title="עד תאריך"></label>
      <button class="btn btn-sm" id="flt-clear" title="ניקוי סינון">נקה</button>
    </div>
    <div class="table-toolbar">
      <label class="btn btn-sm" style="cursor:pointer">
        ⬆️ ייבוא CSV
        <input type="file" id="csv-input" accept=".csv,text/csv" hidden>
      </label>
      <div class="export-wrap">
        <button class="btn btn-sm btn-primary" id="export-btn">⬇️ ייצוא ▾</button>
        <div class="export-menu" id="export-menu" hidden>
          <button data-fmt="excel">📊 Excel (CSV)</button>
          <button data-fmt="pdf">🧾 PDF</button>
        </div>
      </div>
      <button class="btn btn-sm btn-danger" id="del-btn" disabled>🗑️ מחיקה</button>
      <span class="spacer"></span>
      <span class="sel-count" id="sel-count"></span>
    </div>
    <div class="table-wrap">
      <table class="obs-table">
        <thead>
          <tr id="obs-head">
            <th style="width:36px"><input type="checkbox" id="sel-all" title="בחירת כל המוצג"></th>
            <th class="sortable" data-sort="dateTime">תאריך ושעה<span class="sort-ind"></span></th>
            <th class="sortable" data-sort="species">מין הציפור<span class="sort-ind"></span></th>
            <th class="sortable" data-sort="quantity">כמות<span class="sort-ind"></span></th>
            <th class="sortable" data-sort="locationName">מיקום<span class="sort-ind"></span></th>
            <th>קואורדינטות</th>
            <th class="sortable" data-sort="project">פרויקט<span class="sort-ind"></span></th>
            <th>הערות</th>
            <th></th>
          </tr>
        </thead>
        <tbody id="obs-tbody"></tbody>
      </table>
    </div>
    <p id="table-empty" style="color:var(--ink-soft)" hidden>אין תצפיות להצגה.</p>
  `;

  input(container, '#flt-q').addEventListener('input', (e) => { filters.q = (e.target as HTMLInputElement).value; applyFilters(); });
  select(container, '#flt-species').addEventListener('change', (e) => { filters.species = (e.target as HTMLSelectElement).value; applyFilters(); });
  select(container, '#flt-project').addEventListener('change', (e) => { filters.project = (e.target as HTMLSelectElement).value; applyFilters(); });
  select(container, '#flt-group').addEventListener('change', (e) => { groupBy = (e.target as HTMLSelectElement).value as typeof groupBy; renderRows(); });
  input(container, '#flt-from').addEventListener('change', (e) => { filters.from = (e.target as HTMLInputElement).value; applyFilters(); });
  input(container, '#flt-to').addEventListener('change', (e) => { filters.to = (e.target as HTMLInputElement).value; applyFilters(); });
  qs(container, '#flt-clear').addEventListener('click', clearFilters);
  qs(container, '#obs-head').addEventListener('click', onHeaderClick);

  input(container, '#sel-all').addEventListener('change', (e) => {
    const checked = (e.target as HTMLInputElement).checked;
    filtered.forEach((o) => (checked ? selected.add(o.id) : selected.delete(o.id)));
    renderRows();
  });
  qs(container, '#del-btn').addEventListener('click', () => void onBulkDelete());
  input(container, '#csv-input').addEventListener('change', (e) => void onImportCsv(e));
  qs(container, '#obs-tbody').addEventListener('click', (e) => void onRowClick(e));
  setupExportMenu();
}

export function setParams(params: ViewParams): void {
  if (params && 'species' in params) {
    filters.q = ''; filters.project = ''; filters.from = ''; filters.to = '';
    filters.species = params.species || '';
    if (container) {
      input(container, '#flt-q').value = '';
      input(container, '#flt-from').value = '';
      input(container, '#flt-to').value = '';
    }
  }
}

export async function activate(): Promise<void> {
  observations = await listObservations();
  selected = new Set([...selected].filter((id) => observations.some((o) => o.id === id)));
  populateFilterOptions();
  applyFilters();
}

/* ---------- filtering ---------- */

function populateFilterOptions(): void {
  const species = [...new Set(observations.flatMap(speciesNames))].sort((a, b) => a.localeCompare(b, 'he'));
  const projects = [...new Set(observations.map((o) => o.project).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'he'));
  const fill = (sel: HTMLSelectElement, items: string[], keep: string, allLabel: string): void => {
    sel.innerHTML = `<option value="">${allLabel}</option>`
      + items.map((v) => `<option value="${escapeHtml(v)}"${v === keep ? ' selected' : ''}>${escapeHtml(v)}</option>`).join('');
  };
  fill(select(container, '#flt-species'), species, filters.species, 'כל המינים');
  fill(select(container, '#flt-project'), projects, filters.project, 'כל הפרויקטים');
}

function localDay(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function applyFilters(): void {
  const q = filters.q.trim().toLowerCase();
  filtered = observations.filter((o) => {
    if (filters.species && !hasSpecies(o, filters.species)) return false;
    if (filters.project && (o.project || '') !== filters.project) return false;
    if (filters.from || filters.to) {
      const day = localDay(o.dateTime);
      if (filters.from && day && day < filters.from) return false;
      if (filters.to && day && day > filters.to) return false;
    }
    if (q) {
      const hay = `${speciesNames(o).join(' ')} ${o.locationName || ''} ${o.project || ''} ${o.notes || ''}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
  sortFiltered();
  renderRows();
}

function sortFiltered(): void {
  const dir = sortDir === 'asc' ? 1 : -1;
  const byDate = (a: Observation, b: Observation): number =>
    (a.dateTime || '') < (b.dateTime || '') ? -1 : (a.dateTime || '') > (b.dateTime || '') ? 1 : 0;
  filtered.sort((a, b) => {
    let r: number;
    if (sortBy === 'quantity') r = totalQuantity(a) - totalQuantity(b);
    else if (sortBy === 'dateTime') r = byDate(a, b);
    else if (sortBy === 'species') r = primarySpecies(a).localeCompare(primarySpecies(b), 'he');
    else r = String(a[sortBy] || '').localeCompare(String(b[sortBy] || ''), 'he');
    if (r === 0) r = byDate(a, b);
    return r * dir;
  });
}

function onHeaderClick(e: Event): void {
  const th = (e.target as HTMLElement).closest<HTMLElement>('th.sortable');
  if (!th) return;
  const key = th.dataset.sort as typeof sortBy;
  if (sortBy === key) sortDir = sortDir === 'asc' ? 'desc' : 'asc';
  else { sortBy = key; sortDir = key === 'dateTime' ? 'desc' : 'asc'; }
  sortFiltered();
  renderRows();
}

function updateSortIndicators(): void {
  container.querySelectorAll<HTMLElement>('#obs-head th.sortable').forEach((th) => {
    const ind = th.querySelector('.sort-ind')!;
    if (th.dataset.sort === sortBy) { th.classList.add('sorted'); ind.textContent = sortDir === 'asc' ? ' ▲' : ' ▼'; }
    else { th.classList.remove('sorted'); ind.textContent = ''; }
  });
}

function clearFilters(): void {
  filters.q = ''; filters.species = ''; filters.project = ''; filters.from = ''; filters.to = '';
  input(container, '#flt-q').value = '';
  select(container, '#flt-species').value = '';
  select(container, '#flt-project').value = '';
  input(container, '#flt-from').value = '';
  input(container, '#flt-to').value = '';
  applyFilters();
}

/* ---------- rendering ---------- */

function rowHtml(o: Observation): string {
  return `
    <tr data-id="${o.id}" class="${selected.has(o.id) ? 'selected' : ''}">
      <td><input type="checkbox" class="row-sel" ${selected.has(o.id) ? 'checked' : ''}></td>
      <td class="num">${fmtDateTime(o.dateTime)}</td>
      <td><strong>${escapeHtml(speciesLabel(o))}</strong></td>
      <td>${totalQuantity(o)}</td>
      <td>${escapeHtml(o.locationName || '')}</td>
      <td class="num">${fmtCoords(o.lat, o.lng)}</td>
      <td>${o.project ? `<span class="badge">${escapeHtml(o.project)}</span>` : ''}</td>
      <td class="notes-cell" title="${escapeHtml(o.notes || '')}">${escapeHtml((o.notes || '').replace(/\s+/g, ' '))}</td>
      <td class="row-actions">
        <button class="btn btn-sm act-edit" title="עריכה">✏️</button>
        <button class="btn btn-sm act-del" title="מחיקה">🗑️</button>
      </td>
    </tr>`;
}

function groupKeys(o: Observation): string[] {
  if (groupBy === 'project') return [o.project || '(ללא פרויקט)'];
  if (groupBy === 'species') return speciesNames(o).length ? speciesNames(o) : ['(ללא מין)'];
  return [];
}

function renderRows(): void {
  const tbody = qs(container, '#obs-tbody');
  qs(container, '#table-empty').hidden = filtered.length > 0;

  if (groupBy === 'none') {
    tbody.innerHTML = filtered.map(rowHtml).join('');
  } else {
    const groups = new Map<string, Observation[]>();
    for (const o of filtered) {
      for (const k of groupKeys(o)) (groups.get(k) ?? groups.set(k, []).get(k)!).push(o);
    }
    const keys = [...groups.keys()].sort((a, b) => a.localeCompare(b, 'he'));
    tbody.innerHTML = keys.map((k) => {
      const rows = groups.get(k)!;
      const totalQty = rows.reduce((s, o) => s + totalQuantity(o), 0);
      const allSel = rows.every((o) => selected.has(o.id));
      return `
        <tr class="group-head" data-group="${escapeHtml(k)}">
          <td><input type="checkbox" class="group-sel" ${allSel ? 'checked' : ''}></td>
          <td colspan="8">
            <span class="group-title">${escapeHtml(k)}</span>
            <span class="group-meta">${rows.length} תצפיות · ${totalQty} פרטים</span>
          </td>
        </tr>` + rows.map(rowHtml).join('');
    }).join('');
  }
  updateSortIndicators();
  updateToolbar();
}

function updateToolbar(): void {
  const n = selected.size;
  qs(container, '#sel-count').textContent =
    n ? `${n} מסומנות` : (filtered.length !== observations.length ? `${filtered.length} מוצגות` : '');
  qs<HTMLButtonElement>(container, '#del-btn').disabled = n === 0;
  const all = input(container, '#sel-all');
  const selInView = filtered.filter((o) => selected.has(o.id)).length;
  all.checked = filtered.length > 0 && selInView === filtered.length;
  all.indeterminate = selInView > 0 && selInView < filtered.length;
}

/* ---------- selection & row actions ---------- */

async function onRowClick(e: Event): Promise<void> {
  const target = e.target as HTMLElement;
  const groupHead = target.closest<HTMLElement>('tr.group-head');
  if (groupHead && target.classList.contains('group-sel')) {
    const key = groupHead.dataset.group!;
    const rows = filtered.filter((o) => groupKeys(o).includes(key));
    const checked = (target as HTMLInputElement).checked;
    rows.forEach((o) => (checked ? selected.add(o.id) : selected.delete(o.id)));
    renderRows();
    return;
  }
  const tr = target.closest<HTMLElement>('tr[data-id]');
  if (!tr) return;
  const id = tr.dataset.id!;

  if (target.classList.contains('row-sel')) {
    (target as HTMLInputElement).checked ? selected.add(id) : selected.delete(id);
    tr.classList.toggle('selected', (target as HTMLInputElement).checked);
    updateToolbar();
    if (groupBy !== 'none') renderRows();
    return;
  }
  if (target.closest('.act-edit')) { navigate('form', { editId: id }); return; }
  if (target.closest('.act-del')) {
    if (await confirmDialog('למחוק את התצפית?', 'מחיקה')) {
      await deleteObservation(id);
      selected.delete(id);
      await activate();
      toast('התצפית נמחקה');
    }
  }
}

async function onBulkDelete(): Promise<void> {
  if (!selected.size) return;
  if (!(await confirmDialog(`למחוק ${selected.size} תצפיות שנבחרו?`, 'מחיקת הנבחרות'))) return;
  for (const id of selected) await deleteObservation(id);
  selected.clear();
  await activate();
  toast('התצפיות נמחקו');
}

/* ---------- export ---------- */

function exportSet(): Observation[] {
  if (selected.size) {
    const chosen = filtered.filter((o) => selected.has(o.id));
    const extra = observations.filter((o) => selected.has(o.id) && !filtered.includes(o));
    return [...chosen, ...extra];
  }
  return filtered;
}

function setupExportMenu(): void {
  const btn = qs<HTMLButtonElement>(container, '#export-btn');
  const menu = qs(container, '#export-menu');
  btn.addEventListener('click', (e) => { e.stopPropagation(); menu.hidden = !menu.hidden; });
  menu.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-fmt]');
    if (!b) return;
    menu.hidden = true;
    if (b.dataset.fmt === 'excel') exportExcel();
    else void exportPdf();
  });
  document.addEventListener('click', (e) => {
    if (!(e.target as HTMLElement).closest('.export-wrap')) menu.hidden = true;
  });
}

async function exportPdf(): Promise<void> {
  const source = exportSet();
  if (!source.length) { toast('אין תצפיות לייצוא', true); return; }
  const btn = qs<HTMLButtonElement>(container, '#export-btn');
  const label = btn.textContent;
  btn.disabled = true;
  btn.textContent = '⏳ מפיק דו"ח...';
  try {
    await exportObservationsPdf(source);
  } catch (err) {
    toast('הפקת ה-PDF נכשלה: ' + (err as Error).message, true, 5000);
  } finally {
    btn.disabled = false;
    btn.textContent = label;
  }
}

function exportExcel(): void {
  const source = exportSet();
  if (!source.length) { toast('אין תצפיות לייצוא', true); return; }
  // one row per species entry so multi-species observations expand cleanly
  const rows: unknown[][] = [
    ['תאריך ושעה', 'מיקום', 'קו רוחב', 'קו אורך', 'פרויקט', 'מין הציפור', 'מספר פרטים', 'הערות'],
    ...source.flatMap((o) => {
      const entries = entriesOf(o).length ? entriesOf(o) : [{ species: '', quantity: 1 }];
      return entries.map((e) => [o.dateTime, o.locationName || '', o.lat ?? '', o.lng ?? '', o.project || '', e.species, e.quantity ?? 1, o.notes || '']);
    }),
  ];
  const blob = new Blob([toCsv(rows)], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `תצפיות-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
  toast(`יוצאו ${source.length} תצפיות ל-Excel/CSV ✓`);
}

/* ---------- CSV import ---------- */

async function onImportCsv(e: Event): Promise<void> {
  const fileInput = e.target as HTMLInputElement;
  const file = fileInput.files?.[0];
  fileInput.value = '';
  if (!file) return;
  let rows: string[][];
  try { rows = parseCsv(await file.text()); }
  catch { toast('קריאת הקובץ נכשלה — ודאו שזהו קובץ CSV תקין', true); return; }
  if (rows.length < 2) { toast('הקובץ ריק או חסרה שורת כותרות', true); return; }

  const map: HeaderMap = mapHeaders(rows[0]!);
  if (!('species' in map)) { toast('לא נמצאה עמודת "מין הציפור" בקובץ (species / מין)', true, 5000); return; }

  const known = new Set(await listSpecies());
  let imported = 0;
  let newSpecies = 0;
  const val = (r: string[], f: CsvField): string => (map[f] != null ? String(r[map[f]!] ?? '').trim() : '');

  for (const r of rows.slice(1)) {
    const species = val(r, 'species');
    if (!species) continue;
    if (!known.has(species)) { await addSpecies(species); known.add(species); newSpecies++; }
    let lat: number | null = null;
    let lng: number | null = null;
    if (map.coordinates != null) ({ lat, lng } = parseCoordinates(val(r, 'coordinates')));
    if (map.lat != null && val(r, 'lat') !== '') lat = parseFloat(val(r, 'lat'));
    if (map.lng != null && val(r, 'lng') !== '') lng = parseFloat(val(r, 'lng'));

    await saveObservation({
      id: crypto.randomUUID(),
      dateTime: parseDateTime(val(r, 'dateTime')) || new Date().toISOString(),
      locationName: val(r, 'locationName'),
      lat: Number.isFinite(lat) ? lat : null,
      lng: Number.isFinite(lng) ? lng : null,
      project: val(r, 'project'),
      entries: [{ species, quantity: Math.max(1, parseInt(val(r, 'quantity'), 10) || 1) }],
      images: [],
      notes: map.notes != null ? String(r[map.notes] ?? '') : '',
      deleted: false,
      updatedAt: '',
    });
    imported++;
  }
  await activate();
  toast(`יובאו ${imported} תצפיות` + (newSpecies ? ` (נוספו ${newSpecies} מינים חדשים לרשימת המאסטר)` : ''), false, 5000);
}
