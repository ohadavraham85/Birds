/* views/table.js — מסך רשימת התצפיות (סעיפים 7.3, 8א, 8ב):
 * טבלה ממוינת כרונולוגית (חדש למעלה), סימון מרובה עם תיבות סימון,
 * ייצוא PDF מרוכז של הנבחרות, ייבוא CSV מרוכז וייצוא CSV.
 */

import { listObservations, deleteObservation, saveObservation, listSpecies, addSpecies } from '../db.js';
import { toast, fmtDateTime, fmtCoords, confirmDialog } from '../ui.js';
import { escapeHtml } from '../markdown.js';
import { parseCsv, toCsv, mapHeaders, parseCoordinates, parseDateTime } from '../csv.js';
import { exportObservationsPdf } from '../pdf.js';

let container = null;
let selected = new Set();
let observations = [];

export function init(el) {
  container = el;
  container.innerHTML = `
    <h2>רשימת תצפיות</h2>
    <div class="table-toolbar">
      <label class="btn btn-sm" style="cursor:pointer">
        ⬆️ ייבוא CSV
        <input type="file" id="csv-input" accept=".csv,text/csv" hidden>
      </label>
      <button class="btn btn-sm" id="csv-export-btn">⬇️ ייצוא CSV</button>
      <span class="spacer"></span>
      <span class="sel-count" id="sel-count"></span>
      <button class="btn btn-sm btn-primary" id="pdf-btn" disabled>🧾 ייצוא ל-PDF</button>
      <button class="btn btn-sm btn-danger" id="del-btn" disabled>🗑️ מחיקה</button>
    </div>
    <div class="table-wrap">
      <table class="obs-table">
        <thead>
          <tr>
            <th style="width:36px"><input type="checkbox" id="sel-all" title="בחירת הכל"></th>
            <th>תאריך ושעה</th>
            <th>מין הציפור</th>
            <th>כמות</th>
            <th>מיקום</th>
            <th>קואורדינטות</th>
            <th>פרויקט</th>
            <th>הערות</th>
            <th></th>
          </tr>
        </thead>
        <tbody id="obs-tbody"></tbody>
      </table>
    </div>
    <p id="table-empty" style="color:var(--ink-soft)" hidden>אין עדיין תצפיות.</p>
  `;

  container.querySelector('#sel-all').addEventListener('change', (e) => {
    selected = e.target.checked ? new Set(observations.map((o) => o.id)) : new Set();
    renderRows();
  });
  container.querySelector('#pdf-btn').addEventListener('click', onExportPdf);
  container.querySelector('#del-btn').addEventListener('click', onBulkDelete);
  container.querySelector('#csv-input').addEventListener('change', onImportCsv);
  container.querySelector('#csv-export-btn').addEventListener('click', onExportCsv);
  container.querySelector('#obs-tbody').addEventListener('click', onRowClick);
}

export async function activate() {
  observations = await listObservations(); // already sorted: newest first
  selected = new Set([...selected].filter((id) => observations.some((o) => o.id === id)));
  renderRows();
}

function renderRows() {
  const tbody = container.querySelector('#obs-tbody');
  container.querySelector('#table-empty').hidden = observations.length > 0;
  tbody.innerHTML = observations
    .map((o) => `
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
      </tr>`)
    .join('');
  updateToolbar();
}

function updateToolbar() {
  const n = selected.size;
  container.querySelector('#sel-count').textContent = n ? `${n} נבחרו` : '';
  container.querySelector('#pdf-btn').disabled = n === 0;
  container.querySelector('#del-btn').disabled = n === 0;
  const all = container.querySelector('#sel-all');
  all.checked = n > 0 && n === observations.length;
  all.indeterminate = n > 0 && n < observations.length;
}

async function onRowClick(e) {
  const tr = e.target.closest('tr[data-id]');
  if (!tr) return;
  const id = tr.dataset.id;

  if (e.target.classList.contains('row-sel')) {
    e.target.checked ? selected.add(id) : selected.delete(id);
    tr.classList.toggle('selected', e.target.checked);
    updateToolbar();
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

/* ---------- bulk export to PDF (סעיף 8ב) ---------- */

async function onExportPdf() {
  const chosen = observations.filter((o) => selected.has(o.id));
  if (!chosen.length) return;
  const btn = container.querySelector('#pdf-btn');
  btn.disabled = true;
  btn.textContent = '⏳ מפיק דו"ח...';
  try {
    await exportObservationsPdf(chosen);
  } catch (err) {
    console.error(err);
    toast('הפקת ה-PDF נכשלה: ' + err.message, true, 5000);
  } finally {
    btn.textContent = '🧾 ייצוא ל-PDF';
    updateToolbar();
  }
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

/* ---------- CSV export ---------- */

async function onExportCsv() {
  const source = selected.size ? observations.filter((o) => selected.has(o.id)) : observations;
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
}
