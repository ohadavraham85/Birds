/* views/table.ts — רשימת הנכסים: חיפוש, סינון לפי סוג/סטטוס, מיון לפי עמודה,
 * סימון מרובה למחיקה, וייצוא ל-CSV/Excel. */

import { listAssets, deleteAsset } from '../db/repository';
import { toast, confirmDialog } from '../lib/ui';
import { escapeHtml } from '../lib/markdown';
import { toCsv } from '../lib/csv';
import { qs, input, select } from '../lib/dom';
import { icon } from '../lib/icons';
import { ASSET_TYPE_META, ASSET_STATUS_META, VOLTAGE_META } from '../lib/asset-meta';
import { ASSET_TYPES, ASSET_STATUSES } from '../types';
import { navigate } from '../main';
import type { ViewParams } from './view';
import type { Asset, AssetType, AssetStatus } from '../types';

let container: HTMLElement;
let selected = new Set<string>();
let assets: Asset[] = [];
let filtered: Asset[] = [];
const filters = { q: '', type: '' as AssetType | '', status: '' as AssetStatus | '' };
let sortBy: 'name' | 'type' | 'status' | 'voltage' | 'lastMaintenanceDate' = 'name';
let sortDir: 'asc' | 'desc' = 'asc';

export function init(el: HTMLElement): void {
  container = el;
  container.innerHTML = `
    <h2>רשימת נכסים</h2>
    <div class="filter-bar">
      <input type="search" id="flt-q" class="filter-search" placeholder="חיפוש (שם, מספר נכס, כתובת)...">
      <select id="flt-type" class="filter-sel"><option value="">כל הסוגים</option>
        ${ASSET_TYPES.map((t) => `<option value="${t}">${ASSET_TYPE_META[t].label}</option>`).join('')}
      </select>
      <select id="flt-status" class="filter-sel"><option value="">כל הסטטוסים</option>
        ${ASSET_STATUSES.map((s) => `<option value="${s}">${ASSET_STATUS_META[s].label}</option>`).join('')}
      </select>
      <button class="btn btn-sm" id="flt-clear" title="ניקוי סינון">נקה</button>
    </div>
    <div class="table-toolbar">
      <button class="btn btn-sm btn-primary" id="export-btn">${icon('download')} ייצוא ל-Excel/CSV</button>
      <button class="btn btn-sm" id="add-btn">${icon('plus')} נכס חדש</button>
      <button class="btn btn-sm btn-danger" id="del-btn" disabled>${icon('trash')} מחיקה</button>
      <span class="spacer"></span>
      <span class="sel-count" id="sel-count"></span>
    </div>
    <div class="table-wrap">
      <table class="obs-table">
        <thead>
          <tr id="asset-head">
            <th style="width:36px"><input type="checkbox" id="sel-all" title="בחירת כל המוצג"></th>
            <th class="sortable" data-sort="name">שם / מספר נכס<span class="sort-ind"></span></th>
            <th class="sortable" data-sort="type">סוג<span class="sort-ind"></span></th>
            <th class="sortable" data-sort="status">סטטוס<span class="sort-ind"></span></th>
            <th class="sortable" data-sort="voltage">מתח<span class="sort-ind"></span></th>
            <th>כתובת</th>
            <th class="sortable" data-sort="lastMaintenanceDate">תחזוקה אחרונה<span class="sort-ind"></span></th>
            <th></th>
          </tr>
        </thead>
        <tbody id="asset-tbody"></tbody>
      </table>
    </div>
    <p id="table-empty" style="color:var(--ink-soft)" hidden>אין נכסים להצגה.</p>
  `;

  input(container, '#flt-q').addEventListener('input', (e) => { filters.q = (e.target as HTMLInputElement).value; applyFilters(); });
  select(container, '#flt-type').addEventListener('change', (e) => { filters.type = (e.target as HTMLSelectElement).value as AssetType | ''; applyFilters(); });
  select(container, '#flt-status').addEventListener('change', (e) => { filters.status = (e.target as HTMLSelectElement).value as AssetStatus | ''; applyFilters(); });
  qs(container, '#flt-clear').addEventListener('click', clearFilters);
  qs(container, '#asset-head').addEventListener('click', onHeaderClick);
  qs(container, '#add-btn').addEventListener('click', () => navigate('form'));
  qs(container, '#export-btn').addEventListener('click', onExport);
  qs(container, '#del-btn').addEventListener('click', () => void onBulkDelete());
  input(container, '#sel-all').addEventListener('change', (e) => {
    const checked = (e.target as HTMLInputElement).checked;
    filtered.forEach((a) => (checked ? selected.add(a.id) : selected.delete(a.id)));
    renderRows();
  });
  qs(container, '#asset-tbody').addEventListener('click', (e) => void onRowClick(e));
}

export function setParams(params: ViewParams): void {
  filters.q = '';
  filters.type = params?.filterType ?? '';
  filters.status = params?.filterStatus ?? '';
  if (container) {
    input(container, '#flt-q').value = '';
    select(container, '#flt-type').value = filters.type;
    select(container, '#flt-status').value = filters.status;
  }
}

function clearFilters(): void {
  filters.q = ''; filters.type = ''; filters.status = '';
  input(container, '#flt-q').value = '';
  select(container, '#flt-type').value = '';
  select(container, '#flt-status').value = '';
  applyFilters();
}

function applyFilters(): void {
  const q = filters.q.trim().toLowerCase();
  filtered = assets.filter((a) => {
    if (filters.type && a.type !== filters.type) return false;
    if (filters.status && a.status !== filters.status) return false;
    if (q && !(a.name.toLowerCase().includes(q) || a.code.toLowerCase().includes(q) || (a.address ?? '').toLowerCase().includes(q))) return false;
    return true;
  });
  sortRows();
  renderRows();
}

function sortRows(): void {
  const dir = sortDir === 'asc' ? 1 : -1;
  filtered.sort((a, b) => {
    let av: string, bv: string;
    if (sortBy === 'type') { av = ASSET_TYPE_META[a.type].label; bv = ASSET_TYPE_META[b.type].label; }
    else if (sortBy === 'status') { av = ASSET_STATUS_META[a.status].label; bv = ASSET_STATUS_META[b.status].label; }
    else if (sortBy === 'voltage') { av = VOLTAGE_META[a.voltage].label; bv = VOLTAGE_META[b.voltage].label; }
    else if (sortBy === 'lastMaintenanceDate') { av = a.lastMaintenanceDate ?? ''; bv = b.lastMaintenanceDate ?? ''; }
    else { av = a.name || a.code; bv = b.name || b.code; }
    return av.localeCompare(bv, 'he') * dir;
  });
}

function onHeaderClick(e: Event): void {
  const th = (e.target as HTMLElement).closest<HTMLElement>('.sortable');
  if (!th) return;
  const key = th.dataset.sort as typeof sortBy;
  if (sortBy === key) sortDir = sortDir === 'asc' ? 'desc' : 'asc'; else { sortBy = key; sortDir = 'asc'; }
  sortRows();
  renderRows();
}

function updateSortIndicators(): void {
  container.querySelectorAll<HTMLElement>('.sortable').forEach((th) => {
    const ind = th.querySelector('.sort-ind')!;
    ind.textContent = th.dataset.sort === sortBy ? (sortDir === 'asc' ? ' ▲' : ' ▼') : '';
  });
}

function renderRows(): void {
  const tbody = qs(container, '#asset-tbody');
  qs<HTMLElement>(container, '#table-empty').hidden = filtered.length > 0;
  updateSortIndicators();
  tbody.innerHTML = filtered.map((a) => {
    const t = ASSET_TYPE_META[a.type];
    const s = ASSET_STATUS_META[a.status];
    return `
    <tr data-id="${a.id}">
      <td><input type="checkbox" class="row-sel" data-id="${a.id}" ${selected.has(a.id) ? 'checked' : ''}></td>
      <td>${icon(t.icon)} ${escapeHtml(a.name || '—')}${a.code ? ` <span class="hint">#${escapeHtml(a.code)}</span>` : ''}</td>
      <td>${t.label}</td>
      <td><span class="status-badge" style="background:${s.color}">${s.label}</span></td>
      <td>${VOLTAGE_META[a.voltage].label}</td>
      <td>${escapeHtml(a.address ?? '')}</td>
      <td>${escapeHtml(a.lastMaintenanceDate ?? '')}</td>
      <td>
        <button type="button" class="btn btn-icon row-view" data-id="${a.id}" title="פרטים" aria-label="פרטים">${icon('eye')}</button>
        <button type="button" class="btn btn-icon row-edit" data-id="${a.id}" title="עריכה" aria-label="עריכה">${icon('edit')}</button>
      </td>
    </tr>`;
  }).join('');
  updateSelToolbar();
}

function updateSelToolbar(): void {
  const count = selected.size;
  qs<HTMLButtonElement>(container, '#del-btn').disabled = count === 0;
  qs(container, '#sel-count').textContent = count ? `${count} נבחרו` : '';
  const allChecked = filtered.length > 0 && filtered.every((a) => selected.has(a.id));
  input(container, '#sel-all').checked = allChecked;
}

async function onRowClick(e: Event): Promise<void> {
  const target = e.target as HTMLElement;
  if (target.classList.contains('row-sel')) {
    const id = target.dataset.id!;
    if ((target as HTMLInputElement).checked) selected.add(id); else selected.delete(id);
    updateSelToolbar();
    return;
  }
  const viewBtn = target.closest<HTMLElement>('.row-view');
  if (viewBtn) { navigate('detail', { viewId: viewBtn.dataset.id! }); return; }
  const editBtn = target.closest<HTMLElement>('.row-edit');
  if (editBtn) { navigate('form', { editId: editBtn.dataset.id! }); return; }
}

async function onBulkDelete(): Promise<void> {
  if (!selected.size) return;
  if (!(await confirmDialog(`למחוק ${selected.size} נכסים? הפעולה אינה הפיכה.`, 'מחיקה'))) return;
  for (const id of selected) await deleteAsset(id);
  toast(`${selected.size} נכסים נמחקו`);
  selected = new Set();
  await activate();
}

function onExport(): void {
  if (!filtered.length) { toast('אין נכסים לייצוא', true); return; }
  const rows: unknown[][] = [
    ['מספר נכס', 'שם', 'סוג', 'סטטוס', 'מתח', 'קו רוחב', 'קו אורך', 'כתובת', 'תאריך התקנה', 'תחזוקה אחרונה', 'הערות'],
    ...filtered.map((a) => [
      a.code, a.name, ASSET_TYPE_META[a.type].label, ASSET_STATUS_META[a.status].label, VOLTAGE_META[a.voltage].label,
      a.lat ?? '', a.lng ?? '', a.address ?? '', a.installDate ?? '', a.lastMaintenanceDate ?? '', a.notes ?? '',
    ]),
  ];
  const blob = new Blob([toCsv(rows)], { type: 'text/csv;charset=utf-8' });
  const el = document.createElement('a');
  el.href = URL.createObjectURL(blob);
  el.download = `נכסי-חשמל-${new Date().toISOString().slice(0, 10)}.csv`;
  el.click();
  URL.revokeObjectURL(el.href);
  toast(`יוצאו ${filtered.length} נכסים ✓`);
}

export async function activate(): Promise<void> {
  assets = await listAssets();
  applyFilters();
}
