/* views/species.ts — טאב "מינים": רשימת המינים עם פרטים (עברית/אנגלית/מדעי/משפחה),
 * חיפוש, קיבוץ לפי משפחה, מספר תצפיות לכל מין, וקישור לתצפיות. */

import { listSpecies, addSpecies, removeSpecies, listObservations } from '../db/repository';
import { SPECIES_DETAILS } from '../data/species-data';
import { toast, confirmDialog } from '../lib/ui';
import { escapeHtml } from '../lib/markdown';
import { speciesNames } from '../lib/observation';
import { qs, input, select } from '../lib/dom';
import { navigate } from '../main';
import type { SpeciesDetail } from '../types';

let container: HTMLElement;
let names: string[] = [];
let counts: Record<string, number> = {};
let query = '';
let grouped = true;
let openKey: string | null = null;

export function init(el: HTMLElement): void {
  container = el;
  container.innerHTML = `
    <h2>רשימת המינים</h2>
    <div class="filter-bar">
      <input type="search" id="sp-q" class="filter-search" placeholder="🔍 חיפוש מין (עברית / אנגלית / מדעי / משפחה)...">
      <select id="sp-group" class="filter-sel">
        <option value="family">קיבוץ לפי משפחה</option>
        <option value="none">לפי א״ב</option>
      </select>
    </div>
    <div class="add-species-row">
      <input type="text" id="sp-new" placeholder="הוספת מין חדש לרשימה...">
      <button class="btn" id="sp-add">➕ הוספה</button>
    </div>
    <p class="sp-summary" id="sp-summary"></p>
    <div id="sp-list" class="sp-cards"></div>
  `;
  input(container, '#sp-q').addEventListener('input', (e) => { query = (e.target as HTMLInputElement).value; render(); });
  select(container, '#sp-group').addEventListener('change', (e) => { grouped = (e.target as HTMLSelectElement).value === 'family'; render(); });
  qs(container, '#sp-add').addEventListener('click', () => void onAdd());
  input(container, '#sp-new').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); void onAdd(); } });
  qs(container, '#sp-list').addEventListener('click', (e) => void onListClick(e));
}

export async function activate(): Promise<void> {
  names = await listSpecies();
  const obs = await listObservations();
  counts = {};
  for (const o of obs) for (const name of speciesNames(o)) counts[name] = (counts[name] || 0) + 1;
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

function render(): void {
  const list = names.filter(matches);
  const withDetails = names.filter((n) => detailsFor(n).en).length;
  qs(container, '#sp-summary').textContent =
    `${names.length} מינים ברשימה · ${withDetails} עם פרטים מלאים` + (query ? ` · ${list.length} תואמים לחיפוש` : '');

  const el = qs(container, '#sp-list');
  if (!list.length) { el.innerHTML = '<p style="color:var(--ink-soft)">אין מין תואם.</p>'; return; }

  if (grouped) {
    const groups = new Map<string, string[]>();
    for (const n of list) {
      const fam = detailsFor(n).family || '(ללא משפחה)';
      (groups.get(fam) ?? groups.set(fam, []).get(fam)!).push(n);
    }
    const fams = [...groups.keys()].sort((a, b) => a.localeCompare(b, 'he'));
    el.innerHTML = fams.map((fam) => `
      <div class="sp-group">
        <div class="sp-group-head">${escapeHtml(fam)} <span class="sp-group-n">${groups.get(fam)!.length}</span></div>
        ${groups.get(fam)!.sort((a, b) => a.localeCompare(b, 'he')).map(cardHtml).join('')}
      </div>`).join('');
  } else {
    el.innerHTML = [...list].sort((a, b) => a.localeCompare(b, 'he')).map(cardHtml).join('');
  }
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
      ${open ? `
        <div class="sp-details">
          ${d.sci ? `<div><b>שם מדעי:</b> <i dir="ltr">${escapeHtml(d.sci)}</i></div>` : ''}
          ${d.en ? `<div><b>שם אנגלי:</b> <span dir="ltr">${escapeHtml(d.en)}</span></div>` : ''}
          ${d.family ? `<div><b>משפחה:</b> ${escapeHtml(d.family)}</div>` : ''}
          ${!d.en && !d.sci && !d.family ? '<div style="color:var(--ink-soft)">אין פרטים נוספים למין זה.</div>' : ''}
          <div class="sp-actions">
            ${n ? `<button class="btn btn-sm btn-primary act-obs" data-name="${escapeHtml(name)}">📋 הצגת ${n} התצפיות</button>` : ''}
            <button class="btn btn-sm act-report" data-name="${escapeHtml(name)}">📝 דיווח תצפית</button>
            <button class="btn btn-sm btn-danger act-remove" data-name="${escapeHtml(name)}">🗑️ הסרה מהרשימה</button>
          </div>
        </div>` : ''}
    </div>`;
}

async function onListClick(e: Event): Promise<void> {
  const target = e.target as HTMLElement;
  const obs = target.closest<HTMLElement>('.act-obs');
  if (obs) { e.stopPropagation(); navigate('table', { species: obs.dataset.name! }); return; }
  const report = target.closest<HTMLElement>('.act-report');
  if (report) { navigate('form', { species: report.dataset.name! }); return; }
  const remove = target.closest<HTMLElement>('.act-remove');
  if (remove) {
    if (await confirmDialog(`להסיר את "${remove.dataset.name}" מרשימת המינים?`, 'הסרה')) {
      await removeSpecies(remove.dataset.name!);
      openKey = null;
      await activate();
      toast('המין הוסר מהרשימה');
    }
    return;
  }
  const card = target.closest<HTMLElement>('.sp-card');
  if (card) { openKey = openKey === card.dataset.name ? null : card.dataset.name!; render(); }
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
