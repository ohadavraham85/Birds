/* views/equipment.ts — הגדרות ← ציוד: מלאי ציוד הצילום והתצפית (מצלמות,
 * עדשות, משקפות, חצובות וכו') כטבלה עם סינון, מיון, עריכה בטופס עם רשימות
 * נפתחות, וייצוא ל-Excel (CSV). */

import { listEquipment, saveEquipment, deleteEquipment } from '../db/repository';
import { EQUIPMENT_SEED } from '../data/equipment-seed';
import { toast, confirmDialog } from '../lib/ui';
import { escapeHtml } from '../lib/markdown';
import { toCsv } from '../lib/csv';
import { wireCombo } from '../lib/combo';
import { qs } from '../lib/dom';
import { icon } from '../lib/icons';
import type { EquipmentItem, EquipmentCategory, EquipmentStatus } from '../types';
import { EQUIPMENT_CATEGORIES, EQUIPMENT_STATUSES, EQUIPMENT_STATUS_LABELS } from '../types';

type SortKey = 'name' | 'category' | 'manufacturer' | 'model' | 'serial' | 'price' | 'purchaseDate' | 'purchasePlace' | 'quantity' | 'status';

const COLUMNS: Array<{ key: SortKey; label: string; num?: boolean }> = [
  { key: 'name', label: 'שם פריט' },
  { key: 'category', label: 'קטגוריה' },
  { key: 'manufacturer', label: 'יצרן' },
  { key: 'model', label: 'דגם' },
  { key: 'serial', label: 'מספר סידורי' },
  { key: 'price', label: 'מחיר (₪)', num: true },
  { key: 'purchaseDate', label: 'תאריך רכישה', num: true },
  { key: 'purchasePlace', label: 'מקום רכישה' },
  { key: 'quantity', label: 'כמות', num: true },
  { key: 'status', label: 'סטטוס' },
];

let root: HTMLElement;
let items: EquipmentItem[] = [];
const filters = { q: '', category: '', manufacturer: '', place: '', status: '' };
let sortKey: SortKey = 'price';
let sortDir: 1 | -1 = -1;

/** Numeric/date columns start high-to-low (most expensive / newest first) on
 * their first click; text columns start A→Z. */
const DESC_FIRST: SortKey[] = ['price', 'purchaseDate', 'quantity'];

/** Sort choices for the phone layout, where there are no column headers to click. */
const SORT_OPTIONS: Array<[SortKey, 1 | -1, string]> = COLUMNS.flatMap(({ key, label }): Array<[SortKey, 1 | -1, string]> => {
  const [desc, asc] =
    key === 'price' || key === 'quantity' ? ['מהגבוה לנמוך', 'מהנמוך לגבוה']
    : key === 'purchaseDate' ? ['מהחדש לישן', 'מהישן לחדש']
    : key === 'category' ? ['בסדר הפוך', 'לפי סדר הקטגוריות']
    : ['ת ← א', 'א ← ת'];
  return DESC_FIRST.includes(key)
    ? [[key, -1, `${label}: ${desc}`], [key, 1, `${label}: ${asc}`]]
    : [[key, 1, `${label}: ${asc}`], [key, -1, `${label}: ${desc}`]];
});

export function equipmentHtml(): string {
  return `
    <div class="settings-card">
      <div class="eq-filters">
        <input type="search" id="eq-q" class="filter-search" placeholder="חיפוש (שם, דגם, מספר סידורי, הערות)...">
        <select id="eq-f-category" class="filter-sel"></select>
        <select id="eq-f-manufacturer" class="filter-sel"></select>
        <select id="eq-f-place" class="filter-sel"></select>
        <select id="eq-f-status" class="filter-sel"></select>
        <select id="eq-sort" class="filter-sel eq-sort" aria-label="מיון"></select>
        <button type="button" class="btn btn-sm" id="eq-clear">ניקוי סינון</button>
      </div>
      <div class="table-toolbar">
        <button type="button" class="btn btn-primary btn-sm" id="eq-add">${icon('plus')} הוספת פריט</button>
        <button type="button" class="btn btn-sm" id="eq-export">${icon('download')} ייצוא ל-Excel</button>
        <button type="button" class="btn btn-sm" id="eq-seed">${icon('upload')} ייבוא הרשימה מהגיליון (27 פריטים)</button>
        <span class="spacer"></span>
        <span class="sel-count" id="eq-summary"></span>
      </div>
      <div class="table-wrap eq-table-wrap">
        <table class="obs-table eq-table">
          <thead><tr>
            ${COLUMNS.map((c) => `<th class="sortable" data-key="${c.key}">${c.label} <span class="sort-ind"></span></th>`).join('')}
            <th>קישורים</th>
          </tr></thead>
          <tbody id="eq-body"></tbody>
        </table>
      </div>
      <div class="eq-cards" id="eq-cards"></div>
      <p class="hint eq-hint-table">לחיצה על שורה פותחת אותה לעריכה. לחיצה על כותרת עמודה ממיינת לפיה.</p>
      <p class="hint eq-hint-cards">לחיצה על פריט פותחת אותו לעריכה.</p>
    </div>
  `;
}

export function wireEquipment(container: HTMLElement): void {
  root = container;
  const bindFilter = (sel: string, key: keyof typeof filters, ev: 'input' | 'change'): void => {
    qs<HTMLInputElement | HTMLSelectElement>(root, sel).addEventListener(ev, (e) => {
      filters[key] = (e.target as HTMLInputElement).value;
      renderTable();
    });
  };
  qs<HTMLInputElement>(root, '#eq-q').value = filters.q;
  bindFilter('#eq-q', 'q', 'input');
  bindFilter('#eq-f-category', 'category', 'change');
  bindFilter('#eq-f-manufacturer', 'manufacturer', 'change');
  bindFilter('#eq-f-place', 'place', 'change');
  bindFilter('#eq-f-status', 'status', 'change');
  qs(root, '#eq-clear').addEventListener('click', () => {
    filters.q = filters.category = filters.manufacturer = filters.place = filters.status = '';
    qs<HTMLInputElement>(root, '#eq-q').value = '';
    renderTable();
  });
  qs(root, '#eq-add').addEventListener('click', () => openEditor(null));
  qs(root, '#eq-export').addEventListener('click', exportCsv);
  qs(root, '#eq-seed').addEventListener('click', () => void onSeed());
  qs(root, '.eq-table thead').addEventListener('click', (e) => {
    const th = (e.target as HTMLElement).closest<HTMLElement>('th[data-key]');
    if (!th) return;
    const key = th.dataset.key as SortKey;
    if (sortKey === key) sortDir = sortDir === 1 ? -1 : 1;
    else { sortKey = key; sortDir = DESC_FIRST.includes(key) ? -1 : 1; }
    renderTable();
  });
  qs<HTMLSelectElement>(root, '#eq-sort').addEventListener('change', (e) => {
    const [key, dir] = (e.target as HTMLSelectElement).value.split(':');
    sortKey = key as SortKey;
    sortDir = Number(dir) as 1 | -1;
    renderTable();
  });
  const onItemClick = (e: Event): void => {
    if ((e.target as HTMLElement).closest('a')) return; // invoice/photo links open on their own
    const el = (e.target as HTMLElement).closest<HTMLElement>('[data-id]');
    const item = el && items.find((i) => i.id === el.dataset.id);
    if (item) openEditor(item);
  };
  qs(root, '#eq-body').addEventListener('click', onItemClick);
  qs(root, '#eq-cards').addEventListener('click', onItemClick);
  void reload();
}

async function reload(): Promise<void> {
  items = await listEquipment();
  qs(root, '#eq-seed').style.display = items.length ? 'none' : '';
  renderTable();
}

/* ---------- filtering / sorting / rendering ---------- */

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values.map((v) => v.trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'he'));
}

function fillSelect(sel: string, values: Array<[string, string]>, current: string, allLabel: string): void {
  const el = qs<HTMLSelectElement>(root, sel);
  el.innerHTML = `<option value="">${allLabel}</option>` +
    values.map(([v, label]) => `<option value="${escapeHtml(v)}"${v === current ? ' selected' : ''}>${escapeHtml(label)}</option>`).join('');
}

function filteredItems(): EquipmentItem[] {
  const q = filters.q.trim().toLowerCase();
  return items.filter((i) => {
    if (filters.category && i.category !== filters.category) return false;
    if (filters.manufacturer && i.manufacturer.trim() !== filters.manufacturer) return false;
    if (filters.place && i.purchasePlace.trim() !== filters.place) return false;
    if (filters.status && i.status !== filters.status) return false;
    if (q) {
      const hay = [i.name, i.category, i.manufacturer, i.model, i.serial, i.purchasePlace, i.notes].join(' ').toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

function compare(a: EquipmentItem, b: EquipmentItem): number {
  if (sortKey === 'price' || sortKey === 'quantity') {
    const av = a[sortKey], bv = b[sortKey];
    if (av == null && bv == null) return 0;
    if (av == null) return 1; // blanks always last
    if (bv == null) return -1;
    return (av - bv) * sortDir;
  }
  if (sortKey === 'category') {
    const d = EQUIPMENT_CATEGORIES.indexOf(a.category) - EQUIPMENT_CATEGORIES.indexOf(b.category);
    return (d || a.name.localeCompare(b.name, 'he')) * sortDir;
  }
  const av = sortKey === 'status' ? EQUIPMENT_STATUS_LABELS[a.status] : a[sortKey];
  const bv = sortKey === 'status' ? EQUIPMENT_STATUS_LABELS[b.status] : b[sortKey];
  if (!av && !bv) return 0;
  if (!av) return 1;
  if (!bv) return -1;
  return av.localeCompare(bv, 'he') * sortDir;
}

function fmtDate(iso: string): string {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

function fmtPrice(n: number | null): string {
  return n == null ? '' : n.toLocaleString('he-IL');
}

function renderTable(): void {
  fillSelect('#eq-f-category', EQUIPMENT_CATEGORIES.map((c) => [c, c]), filters.category, 'כל הקטגוריות');
  fillSelect('#eq-f-manufacturer', uniqueSorted(items.map((i) => i.manufacturer)).map((m) => [m, m]), filters.manufacturer, 'כל היצרנים');
  fillSelect('#eq-f-place', uniqueSorted(items.map((i) => i.purchasePlace)).map((p) => [p, p]), filters.place, 'כל מקומות הרכישה');
  fillSelect('#eq-f-status', EQUIPMENT_STATUSES.map((s) => [s, EQUIPMENT_STATUS_LABELS[s]]), filters.status, 'כל הסטטוסים');

  const sortSel = qs<HTMLSelectElement>(root, '#eq-sort');
  const current = `${sortKey}:${sortDir}`;
  const opts = SORT_OPTIONS.map(([k, d, label]) => [`${k}:${d}`, `מיון: ${label}`]);
  if (!opts.some(([v]) => v === current)) {
    const col = COLUMNS.find((c) => c.key === sortKey)!;
    opts.unshift([current, `מיון: ${col.label} ${sortDir === 1 ? '▲' : '▼'}`]);
  }
  sortSel.innerHTML = opts.map(([v, l]) => `<option value="${v}"${v === current ? ' selected' : ''}>${escapeHtml(l!)}</option>`).join('');

  const rows = filteredItems().sort(compare);
  root.querySelectorAll<HTMLElement>('.eq-table th[data-key]').forEach((th) => {
    const on = th.dataset.key === sortKey;
    th.classList.toggle('sorted', on);
    th.querySelector('.sort-ind')!.textContent = on ? (sortDir === 1 ? '▲' : '▼') : '';
  });

  qs(root, '#eq-body').innerHTML = rows.length
    ? rows.map((i) => `
      <tr data-id="${escapeHtml(i.id)}" class="eq-row${i.status !== 'active' ? ' eq-inactive' : ''}">
        <td><strong>${escapeHtml(i.name)}</strong></td>
        <td>${escapeHtml(i.category)}</td>
        <td>${escapeHtml(i.manufacturer)}</td>
        <td dir="auto">${escapeHtml(i.model)}</td>
        <td dir="ltr" class="eq-serial">${escapeHtml(i.serial)}</td>
        <td class="num">${fmtPrice(i.price)}</td>
        <td class="num">${fmtDate(i.purchaseDate)}</td>
        <td>${escapeHtml(i.purchasePlace)}</td>
        <td class="num">${i.quantity ?? ''}</td>
        <td><span class="eq-status eq-status-${i.status}">${EQUIPMENT_STATUS_LABELS[i.status]}</span></td>
        <td class="row-actions">
          ${i.invoiceLink ? `<a class="btn btn-icon" href="${escapeHtml(i.invoiceLink)}" target="_blank" rel="noopener" title="חשבונית">${icon('document')}</a>` : ''}
          ${i.photoLink ? `<a class="btn btn-icon" href="${escapeHtml(i.photoLink)}" target="_blank" rel="noopener" title="תמונה">${icon('camera')}</a>` : ''}
        </td>
      </tr>`).join('')
    : `<tr><td colspan="${COLUMNS.length + 1}" class="hint" style="text-align:center;padding:18px">${items.length ? 'אין פריטים שתואמים לסינון.' : 'הרשימה ריקה — הוסיפו פריט או ייבאו את הרשימה מהגיליון.'}</td></tr>`;

  const links = (i: EquipmentItem): string =>
    (i.invoiceLink ? `<a class="btn btn-icon" href="${escapeHtml(i.invoiceLink)}" target="_blank" rel="noopener" title="חשבונית">${icon('document')}</a>` : '') +
    (i.photoLink ? `<a class="btn btn-icon" href="${escapeHtml(i.photoLink)}" target="_blank" rel="noopener" title="תמונה">${icon('camera')}</a>` : '');
  const meta = (label: string, value: string, ltr = false): string =>
    value ? `<span><small>${label}</small> <span${ltr ? ' dir="ltr"' : ''}>${escapeHtml(value)}</span></span>` : '';
  qs(root, '#eq-cards').innerHTML = rows.length
    ? rows.map((i) => `
      <div class="eq-card${i.status !== 'active' ? ' eq-inactive' : ''}" data-id="${escapeHtml(i.id)}" role="button" tabindex="0">
        <div class="eq-card-head">
          <div class="eq-card-title">
            <strong>${escapeHtml(i.name)}</strong>
            <span class="eq-card-sub" dir="auto">${escapeHtml([i.manufacturer, i.model].filter(Boolean).join(' · '))}</span>
          </div>
          <div class="eq-card-price">${i.price != null ? `₪${fmtPrice(i.price)}` : '<span class="hint">ללא מחיר</span>'}</div>
        </div>
        <div class="eq-card-meta">
          <span class="eq-card-cat">${escapeHtml(i.category)}</span>
          ${i.status !== 'active' ? `<span class="eq-status eq-status-${i.status}">${EQUIPMENT_STATUS_LABELS[i.status]}</span>` : ''}
          ${meta('נרכש', fmtDate(i.purchaseDate))}
          ${meta('ב-', i.purchasePlace)}
          ${i.quantity != null && i.quantity !== 1 ? meta('כמות', String(i.quantity)) : ''}
          ${meta('מס׳ סידורי', i.serial, true)}
        </div>
        ${links(i) ? `<div class="eq-card-links">${links(i)}</div>` : ''}
      </div>`).join('')
    : `<p class="hint" style="text-align:center;padding:18px">${items.length ? 'אין פריטים שתואמים לסינון.' : 'הרשימה ריקה — הוסיפו פריט או ייבאו את הרשימה מהגיליון.'}</p>`;

  const total = rows.reduce((sum, i) => sum + (i.price ?? 0), 0);
  qs(root, '#eq-summary').textContent = `${rows.length} פריטים${rows.length !== items.length ? ` מתוך ${items.length}` : ''} · סה"כ ₪${total.toLocaleString('he-IL')}`;
}

/* ---------- add / edit ---------- */

function openEditor(item: EquipmentItem | null): void {
  const v = item ?? {
    id: '', name: '', category: 'אחר' as EquipmentCategory, manufacturer: '', model: '', serial: '',
    price: null, purchaseDate: '', purchasePlace: '', quantity: 1, status: 'active' as EquipmentStatus,
    invoiceLink: '', photoLink: '', notes: '', updatedAt: '',
  };
  const combo = (id: string, label: string, value: string, placeholder = ''): string => `
    <div class="field">
      <label for="${id}">${label}</label>
      <div class="combo with-arrow">
        <input type="text" id="${id}" value="${escapeHtml(value)}" placeholder="${placeholder}" autocomplete="off">
        <button type="button" class="combo-toggle" tabindex="-1" aria-label="הצגת אפשרויות">▾</button>
        <div class="combo-list" hidden></div>
      </div>
    </div>`;

  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.innerHTML = `
    <div class="modal bulk-edit-modal eq-modal">
      <h3>${item ? `עריכת פריט — ${escapeHtml(item.name)}` : 'הוספת פריט ציוד'}</h3>
      ${combo('eq-name', 'שם פריט *', v.name, 'למשל: עדשה, משקפת...')}
      <div class="eq-grid">
        <div class="field">
          <label for="eq-category">קטגוריה</label>
          <select id="eq-category">${EQUIPMENT_CATEGORIES.map((c) => `<option${c === v.category ? ' selected' : ''}>${c}</option>`).join('')}</select>
        </div>
        <div class="field">
          <label for="eq-status">סטטוס</label>
          <select id="eq-status">${EQUIPMENT_STATUSES.map((s) => `<option value="${s}"${s === v.status ? ' selected' : ''}>${EQUIPMENT_STATUS_LABELS[s]}</option>`).join('')}</select>
        </div>
      </div>
      <div class="eq-grid">
        ${combo('eq-manufacturer', 'יצרן', v.manufacturer)}
        <div class="field"><label for="eq-model">דגם</label><input type="text" id="eq-model" value="${escapeHtml(v.model)}"></div>
      </div>
      <div class="eq-grid">
        <div class="field"><label for="eq-serial">מספר סידורי</label><input type="text" id="eq-serial" dir="ltr" value="${escapeHtml(v.serial)}"></div>
        <div class="field"><label for="eq-qty">כמות</label><input type="number" id="eq-qty" min="0" step="1" value="${v.quantity ?? ''}"></div>
      </div>
      <div class="eq-grid">
        <div class="field"><label for="eq-price">מחיר רכישה (₪)</label><input type="number" id="eq-price" min="0" step="any" value="${v.price ?? ''}"></div>
        <div class="field"><label for="eq-date">תאריך רכישה</label><input type="date" id="eq-date" value="${escapeHtml(v.purchaseDate)}"></div>
      </div>
      ${combo('eq-place', 'מקום רכישה', v.purchasePlace)}
      <div class="field"><label for="eq-invoice">קישור לחשבונית</label><input type="url" id="eq-invoice" dir="ltr" placeholder="https://..." value="${escapeHtml(v.invoiceLink)}"></div>
      <div class="field"><label for="eq-photo">קישור לתמונה</label><input type="url" id="eq-photo" dir="ltr" placeholder="https://..." value="${escapeHtml(v.photoLink)}"></div>
      <div class="field"><label for="eq-notes">הערות</label><textarea id="eq-notes">${escapeHtml(v.notes)}</textarea></div>
      <div class="modal-actions">
        <button class="btn btn-primary" id="eq-save">שמירה</button>
        <button class="btn" id="eq-cancel">ביטול</button>
        ${item ? `<button class="btn btn-danger" id="eq-del">${icon('trash')} מחיקה</button>` : ''}
      </div>
    </div>`;
  document.getElementById('modal-root')!.appendChild(backdrop);
  const close = (): void => backdrop.remove();
  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(); });

  const wire = (id: string, values: () => string[]): void => {
    const inp = qs<HTMLInputElement>(backdrop, `#${id}`);
    wireCombo(inp, inp.parentElement!.querySelector<HTMLElement>('.combo-list')!, values);
  };
  wire('eq-name', () => uniqueSorted(items.map((i) => i.name)));
  wire('eq-manufacturer', () => uniqueSorted(items.map((i) => i.manufacturer)));
  wire('eq-place', () => uniqueSorted(items.map((i) => i.purchasePlace)));
  // Picking a known item name pre-selects the category it was last filed under.
  const nameInp = qs<HTMLInputElement>(backdrop, '#eq-name');
  nameInp.addEventListener('change', () => {
    if (item) return;
    const known = items.find((i) => i.name === nameInp.value.trim());
    if (known) qs<HTMLSelectElement>(backdrop, '#eq-category').value = known.category;
  });

  qs(backdrop, '#eq-cancel').addEventListener('click', close);
  backdrop.querySelector('#eq-del')?.addEventListener('click', () => {
    void (async () => {
      if (!(await confirmDialog(`למחוק את "${item!.name}"?`, 'מחיקה'))) return;
      await deleteEquipment(item!.id);
      close();
      toast('הפריט נמחק');
      await reload();
    })();
  });
  qs(backdrop, '#eq-save').addEventListener('click', () => {
    void (async () => {
      const val = (id: string): string => qs<HTMLInputElement>(backdrop, `#${id}`).value.trim();
      const num = (id: string): number | null => { const s = val(id); return s === '' || Number.isNaN(Number(s)) ? null : Number(s); };
      const name = val('eq-name');
      if (!name) { toast('יש להזין שם פריט', true); return; }
      await saveEquipment({
        id: item?.id || crypto.randomUUID(),
        name,
        category: qs<HTMLSelectElement>(backdrop, '#eq-category').value as EquipmentCategory,
        status: qs<HTMLSelectElement>(backdrop, '#eq-status').value as EquipmentStatus,
        manufacturer: val('eq-manufacturer'),
        model: val('eq-model'),
        serial: val('eq-serial'),
        quantity: num('eq-qty'),
        price: num('eq-price'),
        purchaseDate: val('eq-date'),
        purchasePlace: val('eq-place'),
        invoiceLink: val('eq-invoice'),
        photoLink: val('eq-photo'),
        notes: qs<HTMLTextAreaElement>(backdrop, '#eq-notes').value.trim(),
        updatedAt: '',
      });
      close();
      toast(item ? 'הפריט עודכן ✓' : 'הפריט נוסף ✓');
      await reload();
    })();
  });
}

/* ---------- import seed / export ---------- */

async function onSeed(): Promise<void> {
  if (items.length && !(await confirmDialog('הרשימה כבר מכילה פריטים — לייבא בכל זאת?', 'ייבוא'))) return;
  for (const [name, category, manufacturer, model, price, purchaseDate, purchasePlace, quantity] of EQUIPMENT_SEED) {
    await saveEquipment({
      id: crypto.randomUUID(), name, category, manufacturer, model, serial: '', price, purchaseDate,
      purchasePlace, quantity, status: 'active', invoiceLink: '', photoLink: '', notes: '', updatedAt: '',
    });
  }
  toast(`יובאו ${EQUIPMENT_SEED.length} פריטים ✓`);
  await reload();
}

function exportCsv(): void {
  const rows = filteredItems().sort(compare);
  if (!rows.length) { toast('אין פריטים לייצוא', true); return; }
  const csv = toCsv([
    ['שם פריט', 'קטגוריה', 'יצרן', 'דגם', 'מספר סידורי', 'מחיר רכישה', 'תאריך רכישה', 'מקום רכישה', 'כמות', 'סטטוס', 'חשבונית רכישה', 'תמונה', 'הערות'],
    ...rows.map((i) => [
      i.name, i.category, i.manufacturer, i.model, i.serial, i.price ?? '', fmtDate(i.purchaseDate),
      i.purchasePlace, i.quantity ?? '', EQUIPMENT_STATUS_LABELS[i.status], i.invoiceLink, i.photoLink, i.notes,
    ]),
  ]);
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  a.download = `מלאי-ציוד-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
  toast(`יוצאו ${rows.length} פריטים ל-Excel/CSV ✓`);
}
