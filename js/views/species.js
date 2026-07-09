/* views/species.js — טאב "מינים": רשימת המינים עם פרטים לכל מין
 * (שם עברי, אנגלי, מדעי ומשפחה), חיפוש, קיבוץ לפי משפחה, ומספר התצפיות
 * שיש למשתמש לכל מין. כולל הוספה/הסרה של מינים לרשימת המאסטר.
 */

import { listSpecies, addSpecies, removeSpecies, listObservations } from '../db.js';
import { SPECIES_DETAILS } from '../species-data.js';
import { toast, confirmDialog } from '../ui.js';
import { escapeHtml } from '../markdown.js';

let container = null;
let names = [];        // master list names (from DB)
let counts = {};       // species -> observation count
let query = '';
let grouped = true;    // group by family
let openKey = null;    // currently expanded species

export function init(el) {
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
  container.querySelector('#sp-q').addEventListener('input', (e) => { query = e.target.value; render(); });
  container.querySelector('#sp-group').addEventListener('change', (e) => { grouped = e.target.value === 'family'; render(); });
  container.querySelector('#sp-add').addEventListener('click', onAdd);
  container.querySelector('#sp-new').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); onAdd(); } });
  container.querySelector('#sp-list').addEventListener('click', onListClick);
}

export async function activate() {
  names = await listSpecies();
  const obs = await listObservations();
  counts = {};
  for (const o of obs) counts[o.species] = (counts[o.species] || 0) + 1;
  render();
}

function detailsFor(name) {
  return SPECIES_DETAILS[name] || { he: name, en: '', sci: '', family: '' };
}

function matches(name) {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const d = detailsFor(name);
  return `${d.he} ${d.en} ${d.sci} ${d.family}`.toLowerCase().includes(q);
}

function render() {
  const list = names.filter(matches);
  const withDetails = names.filter((n) => detailsFor(n).en).length;
  container.querySelector('#sp-summary').textContent =
    `${names.length} מינים ברשימה · ${withDetails} עם פרטים מלאים` +
    (query ? ` · ${list.length} תואמים לחיפוש` : '');

  const el = container.querySelector('#sp-list');
  if (!list.length) {
    el.innerHTML = '<p style="color:var(--ink-soft)">אין מין תואם.</p>';
    return;
  }

  if (grouped) {
    const groups = new Map();
    for (const n of list) {
      const fam = detailsFor(n).family || '(ללא משפחה)';
      if (!groups.has(fam)) groups.set(fam, []);
      groups.get(fam).push(n);
    }
    const fams = [...groups.keys()].sort((a, b) => a.localeCompare(b, 'he'));
    el.innerHTML = fams.map((fam) => `
      <div class="sp-group">
        <div class="sp-group-head">${escapeHtml(fam)} <span class="sp-group-n">${groups.get(fam).length}</span></div>
        ${groups.get(fam).sort((a, b) => a.localeCompare(b, 'he')).map(cardHtml).join('')}
      </div>`).join('');
  } else {
    el.innerHTML = [...list].sort((a, b) => a.localeCompare(b, 'he')).map(cardHtml).join('');
  }
}

function cardHtml(name) {
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
          ${n ? `<span class="badge">${n} תצפיות</span>` : ''}
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
            <button class="btn btn-sm act-report" data-name="${escapeHtml(name)}">📝 דיווח תצפית</button>
            <button class="btn btn-sm btn-danger act-remove" data-name="${escapeHtml(name)}">🗑️ הסרה מהרשימה</button>
          </div>
        </div>` : ''}
    </div>`;
}

async function onListClick(e) {
  const report = e.target.closest('.act-report');
  if (report) {
    const { navigate } = await import('../app.js');
    navigate('form', { species: report.dataset.name });
    return;
  }
  const remove = e.target.closest('.act-remove');
  if (remove) {
    if (await confirmDialog(`להסיר את "${remove.dataset.name}" מרשימת המינים?`, 'הסרה')) {
      await removeSpecies(remove.dataset.name);
      openKey = null;
      await activate();
      toast('המין הוסר מהרשימה');
    }
    return;
  }
  const card = e.target.closest('.sp-card');
  if (card) {
    openKey = openKey === card.dataset.name ? null : card.dataset.name;
    render();
  }
}

async function onAdd() {
  const input = container.querySelector('#sp-new');
  const name = input.value.trim();
  if (!name) return;
  await addSpecies(name);
  input.value = '';
  openKey = name;
  await activate();
  toast(`"${name}" נוסף לרשימת המינים`);
}
