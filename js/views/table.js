/* views/table.js — מסך רשימת התצפיות (סעיפים 7.3, 8א, 8ב):
 * טבלה עם סינון (חיפוש חופשי + מין + פרויקט), קיבוץ (לפי פרויקט / מין),
 * סימון מרובה, וייצוא (Excel/CSV או PDF) של המסומנים — ואם אין סימון, של הכל.
 */

import { listObservations, deleteObservation, saveObservation, listSpecies, addSpecies } from '../db.js';
import { toast, fmtDateTime, fmtCoords, confirmDialog } from '../ui.js';
import { escapeHtml } from '../markdown.js';
import { parseCsv, toCsv, mapHeaders, parseCoordinates, parseDateTime } from '../csv.js';
import { exportObservationsPdf } from '../pdf.js';

let container = null;
let selected = new Set();
let observations = [];      // all, newest first
let filtered = [];          // after filters, then sorted
const filters = { q: '', species: '', project: '', from: '', to: '' };
let groupBy = 'none';       // 'none' | 'project' | 'species'
let sortBy = 'dateTime';    // column key
let sortDir = 'desc';       // 'asc' | 'desc'

export function init(el) {
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

  container.querySelector('#flt-q').addEventListener('input', (e) => { filters.q = e.target.value; applyFilters(); });
  container.querySelector('#flt-species').addEventListener('change', (e) => { filters.species = e.target.value; applyFilters(); });
  container.querySelector('#flt-project').addEventListener('change', (e) => { filters.project = e.target.value; applyFilters(); });
  container.querySelector('#flt-group').addEventListener('change', (e) => { groupBy = e.target.value; renderRows(); });
  container.querySelector('#flt-from').addEventListener('change', (e) => { filters.from = e.target.value; applyFilters(); });
  container.querySelector('#flt-to').addEventListener('change', (e) => { filters.to = e.target.value; applyFilters(); });
  container.querySelector('#flt-clear').addEventListener('click', clearFilters);
  container.querySelector('#obs-head').addEventListener('click', onHeaderClick);

  container.querySelector('#sel-all').addEventListener('change', (e) => {
    if (e.target.checked) filtered.forEach((o) => selected.add(o.id));
    else filtered.forEach((o) => selected.delete(o.id));
    renderRows();
  });
  container.querySelector('#del-btn').addEventListener('click', onBulkDelete);
  container.querySelector('#csv-input').addEventListener('change', onImportCsv);
  container.querySelector('#obs-tbody').addEventListener('click', onRowClick);
  setupExportMenu();
}

/** Preset filters when navigated to from another view (e.g. a species link). */
export function setParams(params) {
  if (params && 'species' in params) {
    filters.q = ''; filters.project = ''; filters.from = ''; filters.to = '';
    filters.species = params.species || '';
    const q = container?.querySelector('#flt-q'); if (q) q.value = '';
    const from = container?.querySelector('#flt-from'); if (from) from.value = '';
    const to = container?.querySelector('#flt-to'); if (to) to.value = '';
  }
}

export async function activate() {
  observations = await listObservations(); // already sorted: newest first
  selected = new Set([...selected].filter((id) => observations.some((o) => o.id === id)));
  populateFilterOptions();
  applyFilters();
}

/* ---------- filtering ---------- */

function populateFilterOptions() {
  const species = [...new Set(observations.map((o) => o.species).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'he'));
  const projects = [...new Set(observations.map((o) => o.project).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'he'));
  const fill = (sel, items, keep) => {
    const cur = keep;
    sel.innerHTML = `<option value="">${sel.id === 'flt-species' ? 'כל המינים' : 'כל הפרויקטים'}</option>`
      + items.map((v) => `<option value="${escapeHtml(v)}"${v === cur ? ' selected' : ''}>${escapeHtml(v)}</option>`).join('');
  };
  fill(container.querySelector('#flt-species'), species, filters.species);
  fill(container.querySelector('#flt-project'), projects, filters.project);
}

function localDay(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return '';
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function applyFilters() {
  const q = filters.q.trim().toLowerCase();
  filtered = observations.filter((o) => {
    if (filters.species && o.species !== filters.species) return false;
    if (filters.project && (o.project || '') !== filters.project) return false;
    if (filters.from || filters.to) {
      const day = localDay(o.dateTime);
      if (filters.from && day && day < filters.from) return false;
      if (filters.to && day && day > filters.to) return false;
    }
    if (q) {
      const hay = `${o.species} ${o.locationName || ''} ${o.project || ''} ${o.notes || ''}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
  sortFiltered();
  renderRows();
}

function sortFiltered() {
  const dir = sortDir === 'asc' ? 1 : -1;
  filtered.sort((a, b) => {
    let r;
    if (sortBy === 'quantity') {
      r = (a.quantity ?? 1) - (b.quantity ?? 1);
    } else if (sortBy === 'dateTime') {
      r = (a.dateTime || '') < (b.dateTime || '') ? -1 : (a.dateTime || '') > (b.dateTime || '') ? 1 : 0;
    } else {
      r = String(a[sortBy] || '').localeCompare(String(b[sortBy] || ''), 'he');
    }
    if (r === 0) { // stable tiebreaker: newest first
      r = (a.dateTime || '') < (b.dateTime || '') ? -1 : (a.dateTime || '') > (b.dateTime || '') ? 1 : 0;
    }
    return r * dir;
  });
}

function onHeaderClick(e) {
  const th = e.target.closest('th.sortable');
  if (!th) return;
  const key = th.dataset.sort;
  if (sortBy === key) {
    sortDir = sortDir === 'asc' ? 'desc' : 'asc';
  } else {
    sortBy = key;
    sortDir = key === 'dateTime' ? 'desc' : 'asc'; // dates default newest-first, text A→Z
  }
  sortFiltered();
  renderRows();
}

function updateSortIndicators() {
  container.querySelectorAll('#obs-head th.sortable').forEach((th) => {
    const ind = th.querySelector('.sort-ind');
    if (th.dataset.sort === sortBy) {
      th.classList.add('sorted');
      ind.textContent = sortDir === 'asc' ? ' ▲' : ' ▼';
    } else {
      th.classList.remove('sorted');
      ind.textContent = '';
    }
  });
}

function clearFilters() {
  filters.q = ''; filters.species = ''; filters.project = ''; filters.from = ''; filters.to = '';
  container.querySelector('#flt-q').value = '';
  container.querySelector('#flt-species').value = '';
  container.querySelector('#flt-project').value = '';
  container.querySelector('#flt-from').value = '';
  container.querySelector('#flt-to').value = '';
  applyFilters();
}

/* ---------- rendering ---------- */

function rowHtml(o) {
  return `
    <tr data-id="${o.id}" class="${selected.has(o.id) ? 'selected' : ''}">
      <td><input type="checkbox" class="row-sel" ${selected.has(o.id) ? 'checked' : ''}></td>
      <td class="num">${fmtDateTime(o.dateTime)}</td>
      <td><strong>${escapeHtml(o.species)}</strong></td>
      <td>${o.quantity ?? 1}</td>
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

function groupKey(o) {
  if (groupBy === 'project') return o.project || '(ללא פרויקט)';
  if (groupBy === 'species') return o.species || '(ללא מין)';
  return '';
}

function renderRows() {
  const tbody = container.querySelector('#obs-tbody');
  container.querySelector('#table-empty').hidden = filtered.length > 0;

  if (groupBy === 'none') {
    tbody.innerHTML = filtered.map(rowHtml).join('');
  } else {
    const groups = new Map();
    for (const o of filtered) {
      const k = groupKey(o);
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(o);
    }
    const keys = [...groups.keys()].sort((a, b) => a.localeCompare(b, 'he'));
    tbody.innerHTML = keys.map((k) => {
      const rows = groups.get(k);
      const totalQty = rows.reduce((s, o) => s + (o.quantity ?? 1), 0);
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

function updateToolbar() {
  const n = selected.size;
  container.querySelector('#sel-count').textContent =
    n ? `${n} מסומנות` : (filtered.length !== observations.length ? `${filtered.length} מוצגות` : '');
  container.querySelector('#del-btn').disabled = n === 0;
  const all = container.querySelector('#sel-all');
  const selInView = filtered.filter((o) => selected.has(o.id)).length;
  all.checked = filtered.length > 0 && selInView === filtered.length;
  all.indeterminate = selInView > 0 && selInView < filtered.length;
}

/* ---------- selection & row actions ---------- */

async function onRowClick(e) {
  const groupHead = e.target.closest('tr.group-head');
  if (groupHead && e.target.classList.contains('group-sel')) {
    const key = groupHead.dataset.group;
    const rows = filtered.filter((o) => groupKey(o) === key);
    if (e.target.checked) rows.forEach((o) => selected.add(o.id));
    else rows.forEach((o) => selected.delete(o.id));
    renderRows();
    return;
  }

  const tr = e.target.closest('tr[data-id]');
  if (!tr) return;
  const id = tr.dataset.id;

  if (e.target.classList.contains('row-sel')) {
    e.target.checked ? selected.add(id) : selected.delete(id);
    tr.classList.toggle('selected', e.target.checked);
    updateToolbar();
    // keep group checkbox in sync
    if (groupBy !== 'none') renderRows();
    return;
  }
  if (e.target.closest('.act-edit')) {
    const { navigate } = await import('../app.js');
    navigate('form', { editId: id });
    return;
  }
  if (e.target.closest('.act-del')) {
    if (await confirmDialog('למחוק את התצפית?', 'מחיקה')) {
      await deleteObservation(id);
      selected.delete(id);
      await activate();
      toast('התצפית נמחקה');
    }
  }
}

async function onBulkDelete() {
  if (!selected.size) return;
  if (!(await confirmDialog(`למחוק ${selected.size} תצפיות שנבחרו?`, 'מחיקת הנבחרות'))) return;
  for (const id of selected) await deleteObservation(id);
  selected.clear();
  await activate();
  toast('התצפיות נמחקו');
}

/* ---------- export (Excel / PDF) of selected — or all shown if none selected ---------- */

/** The set to export: selected rows, or the currently filtered rows if none selected. */
function exportSet() {
  if (selected.size) {
    // preserve current (filtered) order
    const chosen = filtered.filter((o) => selected.has(o.id));
    // include selected rows that are filtered out too, appended by date
    const extra = observations.filter((o) => selected.has(o.id) && !filtered.includes(o));
    return [...chosen, ...extra];
  }
  return filtered;
}

function setupExportMenu() {
  const btn = container.querySelector('#export-btn');
  const menu = container.querySelector('#export-menu');
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    menu.hidden = !menu.hidden;
  });
  menu.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-fmt]');
    if (!b) return;
    menu.hidden = true;
    if (b.dataset.fmt === 'excel') exportExcel();
    else exportPdf();
  });
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.export-wrap')) menu.hidden = true;
  });
}

async function exportPdf() {
  const source = exportSet();
  if (!source.length) { toast('אין תצפיות לייצוא', true); return; }
  const btn = container.querySelector('#export-btn');
  const label = btn.textContent;
  btn.disabled = true;
  btn.textContent = '⏳ מפיק דו"ח...';
  try {
    await exportObservationsPdf(source);
  } catch (err) {
    console.error(err);
    toast('הפקת ה-PDF נכשלה: ' + err.message, true, 5000);
  } finally {
    btn.disabled = false;
    btn.textContent = label;
  }
}

function exportExcel() {
  const source = exportSet();
  if (!source.length) { toast('אין תצפיות לייצוא', true); return; }
  const rows = [
    ['תאריך ושעה', 'מיקום', 'קו רוחב', 'קו אורך', 'פרויקט', 'מין הציפור', 'מספר פרטים', 'הערות'],
    ...source.map((o) => [
      o.dateTime, o.locationName || '', o.lat ?? '', o.lng ?? '',
      o.project || '', o.species, o.quantity ?? 1, o.notes || '',
    ]),
  ];
  const blob = new Blob([toCsv(rows)], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `תצפיות-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
  toast(`יוצאו ${source.length} תצפיות ל-Excel/CSV ✓`);
}

/* ---------- CSV import (סעיף 8א) ---------- */

async function onImportCsv(e) {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  let rows;
  try {
    rows = parseCsv(await file.text());
  } catch {
    toast('קריאת הקובץ נכשלה — ודאו שזהו קובץ CSV תקין', true);
    return;
  }
  if (rows.length < 2) {
    toast('הקובץ ריק או חסרה שורת כותרות', true);
    return;
  }
  const map = mapHeaders(rows[0]);
  if (!('species' in map)) {
    toast('לא נמצאה עמודת "מין הציפור" בקובץ (species / מין)', true, 5000);
    return;
  }

  const speciesList = await listSpecies();
  const known = new Set(speciesList);
  let imported = 0;
  let newSpecies = 0;

  for (const r of rows.slice(1)) {
    const val = (f) => (f in map ? String(r[map[f]] ?? '').trim() : '');
    const species = val('species');
    if (!species) continue;
    if (!known.has(species)) {
      await addSpecies(species); // enrich the master list so the row stays valid
      known.add(species);
      newSpecies++;
    }
    let lat = null;
    let lng = null;
    if (map.coordinates != null) ({ lat, lng } = parseCoordinates(val('coordinates')));
    if (map.lat != null && val('lat') !== '') lat = parseFloat(val('lat'));
    if (map.lng != null && val('lng') !== '') lng = parseFloat(val('lng'));

    await saveObservation({
      id: crypto.randomUUID(),
      dateTime: parseDateTime(val('dateTime')) || new Date().toISOString(),
      locationName: val('locationName'),
      lat: Number.isFinite(lat) ? lat : null,
      lng: Number.isFinite(lng) ? lng : null,
      project: val('project'),
      species,
      quantity: Math.max(1, parseInt(val('quantity'), 10) || 1),
      images: [],
      notes: 'notes' in map ? String(r[map.notes] ?? '') : '',
      deleted: false,
    });
    imported++;
  }
  await activate();
  toast(`יובאו ${imported} תצפיות` + (newSpecies ? ` (נוספו ${newSpecies} מינים חדשים לרשימת המאסטר)` : ''), false, 5000);
}
