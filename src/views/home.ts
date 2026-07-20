/* views/home.ts — מסך הבית: נקודת המוצא והחזרה הראשית של האפליקציה.
 * כולל את "ציפור היום" (מין שנבחר אוטומטית ומשתנה מדי יום, עם תמונה אם יש
 * ופרטים מכרטיס המין; לחיצה פותחת את הכרטיס המלא בטאב "מינים") ואת לוח
 * הסטטיסטיקה (שהיה בעבר טאב נפרד) — מספרי-על, פילוח לפי מין/מיקום/פרויקט
 * ומגמה שנתית, עם סינון לפי שנה/חודש/טווח מותאם, פלטת צבעים מגוונת בגרפים,
 * ולחיצה על כל נתון שמפנה ליומן/ללוח השנה המסונן. חוזרים למסך הזה תמיד
 * באותו מצב סינון/גרפים וגלילה שהיו כשיצאת ממנו (למשל אחרי לחיצה על גרף). */

import { listObservations, listSpeciesRows } from '../db/repository';
import { SPECIES_DETAILS } from '../data/species-data';
import { speciesNames, totalQuantity, entriesOf, entryImages } from '../lib/observation';
import { getImageObjectUrl } from '../lib/media';
import { escapeHtml } from '../lib/markdown';
import { fmtDateTime } from '../lib/ui';
import { icon } from '../lib/icons';
import { qs } from '../lib/dom';
import { navigate } from '../main';
import type { Observation, ObservationImage } from '../types';

type BreakdownKind = 'species' | 'location' | 'project';
type ChartMode = 'bar' | 'pie';
type RangeMode = 'all' | 'year' | 'month' | 'custom';

/** Qualitative, mutually-distinguishable palette (not just shades of the
 * accent color) — reused across bars, donut segments and legends. */
const PALETTE = [
  '#4c72b0', '#dd8452', '#55a868', '#c44e52', '#8172b3',
  '#937860', '#da8bc3', '#8c8c8c', '#ccb974', '#64b5cd',
];
function colorFor(i: number): string {
  return PALETTE[i % PALETTE.length]!;
}

let container: HTMLElement;
let allObservations: Observation[] = [];
let speciesMasterList: string[] = [];

const chartMode: Record<BreakdownKind, ChartMode> = { species: 'pie', location: 'bar', project: 'bar' };
let yearMode: 'bar' | 'line' = 'bar';

let rangeMode: RangeMode = 'all';
let rangeYear = new Date().getFullYear();
let rangeMonth = new Date().getMonth() + 1;
let customFrom = '';
let customTo = '';

/** Preserved across navigating away and back, so returning to Home (via the
 * tab bar, or the generic top-bar back button) restores the exact scroll
 * position the user was at — e.g. right after tapping a chart to drill down. */
let savedScrollTop = 0;
function rememberScroll(): void {
  const main = document.getElementById('main');
  if (main) savedScrollTop = main.scrollTop;
}

export function init(el: HTMLElement): void {
  container = el;
  container.innerHTML = `<h2>בית</h2><div id="home-body"></div>`;
  const body = qs(container, '#home-body');
  body.addEventListener('click', onClick);
  body.addEventListener('change', onChange);
}

export async function activate(): Promise<void> {
  allObservations = await listObservations();
  speciesMasterList = (await listSpeciesRows()).map((r) => r.name);
  render();
  const main = document.getElementById('main');
  requestAnimationFrame(() => { if (main) main.scrollTop = savedScrollTop; });
}

/* ---------- Bird of the Day ---------- */

/** Deterministic by calendar date (not persisted) — same pick all day, a new
 * one at midnight, no server/storage needed. */
function pickBirdOfDay(): string | null {
  if (!speciesMasterList.length) return null;
  const now = new Date();
  const startOfYear = new Date(now.getFullYear(), 0, 0);
  const dayOfYear = Math.floor((now.getTime() - startOfYear.getTime()) / 86400000);
  return speciesMasterList[dayOfYear % speciesMasterList.length]!;
}

function firstPhotoForSpecies(name: string): { img: ObservationImage; obsId: string } | null {
  for (const o of allObservations) {
    for (const entry of entriesOf(o)) {
      if (entry.species !== name) continue;
      const imgs = entryImages(entry);
      if (imgs.length) return { img: imgs[0]!, obsId: o.id };
    }
  }
  return null;
}

function birdOfDayHtml(): string {
  const name = pickBirdOfDay();
  if (!name) return '';
  const d = SPECIES_DETAILS[name] || { he: name, en: '', sci: '', family: '' };
  const seenCount = allObservations.filter((o) => speciesNames(o).includes(name)).length;
  return `
    <button type="button" class="bod-card" id="bod-card" data-name="${escapeHtml(name)}">
      <div class="bod-media" id="bod-media">${icon('bird', 'bod-fallback-icon')}</div>
      <div class="bod-info">
        <span class="bod-eyebrow">${icon('compass')} ציפור היום</span>
        <span class="bod-he">${escapeHtml(d.he)}</span>
        ${d.en ? `<span class="bod-en" dir="ltr">${escapeHtml(d.en)}</span>` : ''}
        ${d.family ? `<span class="bod-family">${escapeHtml(d.family)}</span>` : ''}
        ${seenCount ? `<span class="bod-seen">${icon('journal')} נצפה ${seenCount} פעמים על ידך</span>` : `<span class="bod-seen bod-not-seen">עוד לא נצפה על ידך</span>`}
      </div>
      <span class="bod-chevron">›</span>
    </button>`;
}

function renderBirdOfDayPhoto(): void {
  const name = pickBirdOfDay();
  if (!name) return;
  const media = container.querySelector<HTMLElement>('#bod-media');
  if (!media) return;
  const photo = firstPhotoForSpecies(name);
  if (!photo) return;
  void getImageObjectUrl(photo.img, photo.obsId).then((url) => {
    if (!url) return;
    media.innerHTML = '';
    const el = document.createElement('img');
    el.src = url;
    el.alt = name;
    media.appendChild(el);
  });
}

/* ---------- range filter ---------- */

function filteredObservations(): Observation[] {
  if (rangeMode === 'year') {
    return allObservations.filter((o) => new Date(o.dateTime).getFullYear() === rangeYear);
  }
  if (rangeMode === 'month') {
    return allObservations.filter((o) => {
      const d = new Date(o.dateTime);
      return d.getFullYear() === rangeYear && d.getMonth() + 1 === rangeMonth;
    });
  }
  if (rangeMode === 'custom') {
    return allObservations.filter((o) => {
      const iso = o.dateTime.slice(0, 10);
      return (!customFrom || iso >= customFrom) && (!customTo || iso <= customTo);
    });
  }
  return allObservations;
}

function availableYears(): number[] {
  const years = new Set(allObservations.map((o) => new Date(o.dateTime).getFullYear()).filter((y) => !isNaN(y)));
  const current = new Date().getFullYear();
  years.add(current);
  return [...years].sort((a, b) => b - a);
}

const MONTH_NAMES = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'];

function rangeBarHtml(): string {
  const years = availableYears();
  return `
    <div class="home-range-bar">
      <select id="home-range-mode" class="filter-sel">
        <option value="all" ${rangeMode === 'all' ? 'selected' : ''}>כל הזמן</option>
        <option value="year" ${rangeMode === 'year' ? 'selected' : ''}>שנה</option>
        <option value="month" ${rangeMode === 'month' ? 'selected' : ''}>חודש</option>
        <option value="custom" ${rangeMode === 'custom' ? 'selected' : ''}>טווח מותאם</option>
      </select>
      ${rangeMode === 'year' || rangeMode === 'month' ? `
        <select id="home-range-year" class="filter-sel">
          ${years.map((y) => `<option value="${y}" ${y === rangeYear ? 'selected' : ''}>${y}</option>`).join('')}
        </select>` : ''}
      ${rangeMode === 'month' ? `
        <select id="home-range-month" class="filter-sel">
          ${MONTH_NAMES.map((m, i) => `<option value="${i + 1}" ${i + 1 === rangeMonth ? 'selected' : ''}>${m}</option>`).join('')}
        </select>` : ''}
      ${rangeMode === 'custom' ? `
        <input type="date" id="home-range-from" value="${customFrom}">
        <span class="home-range-sep">–</span>
        <input type="date" id="home-range-to" value="${customTo}">` : ''}
    </div>`;
}

/* ---------- stats dashboard (moved from the old stats tab) ---------- */

function statsHtml(observations: Observation[]): string {
  if (!observations.length) {
    return '<p style="color:var(--ink-soft)">אין תצפיות בטווח שנבחר.</p>';
  }

  const speciesCounts = new Map<string, number>();
  const locationCounts = new Map<string, number>();
  const projectCounts = new Map<string, number>();
  const yearCounts = new Map<string, number>();
  let totalIndividuals = 0;
  let minDate = observations[0]!.dateTime;
  let maxDate = observations[0]!.dateTime;

  for (const o of observations) {
    if (o.dateTime < minDate) minDate = o.dateTime;
    if (o.dateTime > maxDate) maxDate = o.dateTime;

    for (const name of new Set(speciesNames(o))) speciesCounts.set(name, (speciesCounts.get(name) || 0) + 1);
    totalIndividuals += totalQuantity(o);

    const loc = o.locationName.trim();
    if (loc) locationCounts.set(loc, (locationCounts.get(loc) || 0) + 1);
    const proj = o.project.trim();
    if (proj) projectCounts.set(proj, (projectCounts.get(proj) || 0) + 1);

    const year = new Date(o.dateTime).getFullYear();
    if (!isNaN(year)) yearCounts.set(String(year), (yearCounts.get(String(year)) || 0) + 1);
  }
  const tiles = [
    { label: 'תצפיות', value: observations.length },
    { label: 'מינים', value: speciesCounts.size },
    { label: 'פרטים', value: totalIndividuals },
    { label: 'מיקומים', value: locationCounts.size },
    { label: 'פרויקטים', value: projectCounts.size },
  ];

  const tilesHtml = `
    <div class="stat-tiles">
      ${tiles.map((t) => `
        <div class="stat-tile">
          <span class="stat-tile-value">${t.value.toLocaleString('he-IL')}</span>
          <span class="stat-tile-label">${escapeHtml(t.label)}</span>
        </div>`).join('')}
    </div>
    <p class="stat-range">מהתצפית הראשונה (${fmtDateTime(minDate)}) ועד האחרונה (${fmtDateTime(maxDate)})</p>`;

  const years = [...yearCounts.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  const yearChart = yearMode === 'bar' ? yearChartBar(years) : yearChartLine(years);

  const topSpecies = [...speciesCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
  const speciesChart = breakdownChart('species', 'המינים הנפוצים ביותר', topSpecies, 'תצפיות');

  const topLocations = [...locationCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
  const locationsChart = breakdownChart('location', 'מיקומים מובילים', topLocations, 'תצפיות');

  const projects = [...projectCounts.entries()].sort((a, b) => b[1] - a[1]);
  const projectsChart = breakdownChart('project', 'פילוח לפי פרויקט', projects, 'תצפיות');

  return tilesHtml + yearChart + speciesChart + locationsChart + projectsChart;
}

function yearCardHead(title: string): string {
  return `
    <div class="stat-card-head">
      <h3>${escapeHtml(title)}</h3>
      <button type="button" class="btn btn-icon" data-toggle="year" title="החלפת סוג גרף" aria-label="החלפת סוג גרף">
        ${yearMode === 'bar' ? icon('lineChart') : icon('chart')}
      </button>
    </div>`;
}

function yearChartBar(rows: [string, number][]): string {
  if (!rows.length) return '';
  const max = Math.max(...rows.map(([, n]) => n));
  return `
    <div class="stat-card">
      ${yearCardHead('תצפיות לפי שנה')}
      <div class="stat-year-chart">
        ${rows.map(([label, n], i) => `
          <button type="button" class="stat-year-col" data-drill="year" data-value="${escapeHtml(label)}">
            <span class="stat-year-value">${n}</span>
            <div class="stat-year-bar" style="height:${max ? Math.max(4, (n / max) * 100) : 0}%;background:${colorFor(i)}"></div>
            <span class="stat-year-label">${escapeHtml(label)}</span>
          </button>`).join('')}
      </div>
    </div>`;
}

function yearChartLine(rows: [string, number][]): string {
  if (!rows.length) return '';
  const max = Math.max(...rows.map(([, n]) => n));
  const W = 300, H = 130, padX = 20, padTop = 26, padBottom = 22;
  const innerH = H - padTop - padBottom;
  const stepX = rows.length > 1 ? (W - padX * 2) / (rows.length - 1) : 0;
  const points = rows.map(([label, n], i) => ({
    x: padX + i * stepX,
    y: padTop + innerH - (max ? (n / max) * innerH : 0),
    label, n,
  }));
  const pathD = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');

  return `
    <div class="stat-card">
      ${yearCardHead('תצפיות לפי שנה')}
      <svg viewBox="0 0 ${W} ${H}" class="stat-line-chart" preserveAspectRatio="none">
        <path d="${pathD}" fill="none" stroke="var(--accent-700)" stroke-width="2" vector-effect="non-scaling-stroke"/>
        ${points.map((p) => `
          <text x="${p.x}" y="${p.y - 8}" text-anchor="middle" class="stat-line-value">${p.n}</text>
          <circle class="stat-line-dot" data-drill="year" data-value="${escapeHtml(p.label)}" cx="${p.x}" cy="${p.y}" r="9"/>
          <text x="${p.x}" y="${H - 6}" text-anchor="middle" class="stat-line-label">${escapeHtml(p.label)}</text>`).join('')}
      </svg>
    </div>`;
}

const TITLES: Record<BreakdownKind, string> = { species: 'מין', location: 'מיקום', project: 'פרויקט' };

function breakdownChart(kind: BreakdownKind, title: string, rows: [string, number][], unit: string): string {
  if (!rows.length) return '';
  const head = `
    <div class="stat-card-head">
      <h3>${escapeHtml(title)}</h3>
      <button type="button" class="btn btn-icon" data-toggle="${kind}" title="החלפת סוג גרף" aria-label="החלפת סוג גרף">
        ${chartMode[kind] === 'bar' ? icon('pieChart') : icon('chart')}
      </button>
    </div>`;
  const body = chartMode[kind] === 'bar' ? barList(kind, rows, unit) : donut(kind, rows, unit);
  return `<div class="stat-card">${head}${body}</div>`;
}

function barList(kind: BreakdownKind, rows: [string, number][], unit: string): string {
  const max = Math.max(...rows.map(([, n]) => n));
  return `
    <div class="stat-bar-list">
      ${rows.map(([label, n], i) => `
        <button type="button" class="stat-bar-row" data-drill="${kind}" data-value="${escapeHtml(label)}" title="${escapeHtml(TITLES[kind])}: ${escapeHtml(label)}">
          <span class="stat-bar-label">${escapeHtml(label)}</span>
          <div class="stat-bar-track"><div class="stat-bar-fill" style="width:${max ? (n / max) * 100 : 0}%;background:${colorFor(i)}"></div></div>
          <span class="stat-bar-value">${n.toLocaleString('he-IL')} ${escapeHtml(unit)}</span>
        </button>`).join('')}
    </div>`;
}

function donut(kind: BreakdownKind, rows: [string, number][], unit: string): string {
  const total = rows.reduce((sum, [, n]) => sum + n, 0);
  const R = 15.9155;
  let running = 0;
  const segments = rows.map(([label, n], i) => {
    const pct = total ? (n / total) * 100 : 0;
    const offset = -running;
    running += pct;
    return `<circle class="stat-donut-seg" data-drill="${kind}" data-value="${escapeHtml(label)}"
      cx="21" cy="21" r="${R}" fill="none" stroke="${colorFor(i)}" stroke-width="7.5"
      stroke-dasharray="${pct.toFixed(2)} ${(100 - pct).toFixed(2)}" stroke-dashoffset="${offset.toFixed(2)}"><title>${escapeHtml(label)}: ${n}</title></circle>`;
  }).join('');

  return `
    <div class="stat-donut-wrap">
      <svg viewBox="0 0 42 42" class="stat-donut" role="img" aria-label="${escapeHtml(TITLES[kind])}">
        <g transform="rotate(-90 21 21)">
          <circle cx="21" cy="21" r="${R}" fill="none" stroke="var(--accent-50)" stroke-width="7.5"></circle>
          ${segments}
        </g>
      </svg>
      <div class="stat-donut-legend">
        ${rows.map(([label, n], i) => `
          <button type="button" class="stat-donut-legend-row" data-drill="${kind}" data-value="${escapeHtml(label)}">
            <span class="stat-donut-dot" style="background:${colorFor(i)}"></span>
            <span class="stat-donut-legend-label">${escapeHtml(label)}</span>
            <span class="stat-donut-legend-value">${n.toLocaleString('he-IL')} ${escapeHtml(unit)}</span>
          </button>`).join('')}
      </div>
    </div>`;
}

/* ---------- render + events ---------- */

function render(): void {
  qs(container, '#home-body').innerHTML = birdOfDayHtml() + rangeBarHtml() + statsHtml(filteredObservations());
  renderBirdOfDayPhoto();
}

function onClick(e: Event): void {
  const target = e.target as HTMLElement;

  const bod = target.closest<HTMLElement>('#bod-card');
  if (bod) { rememberScroll(); navigate('species', { species: bod.dataset.name! }); return; }

  const toggle = target.closest<HTMLElement>('[data-toggle]');
  if (toggle) {
    const kind = toggle.dataset.toggle as BreakdownKind | 'year';
    if (kind === 'year') yearMode = yearMode === 'bar' ? 'line' : 'bar';
    else chartMode[kind] = chartMode[kind] === 'bar' ? 'pie' : 'bar';
    render();
    return;
  }

  const drill = target.closest<HTMLElement>('[data-drill]');
  if (!drill) return;
  rememberScroll();
  const kind = drill.dataset.drill!;
  const value = drill.dataset.value!;
  if (kind === 'species') navigate('cards', { filterSpecies: value });
  else if (kind === 'location') navigate('cards', { filterLocation: value });
  else if (kind === 'project') navigate('cards', { filterProject: value });
  else if (kind === 'year') navigate('calendar', { year: Number(value) });
}

function onChange(e: Event): void {
  const target = e.target as HTMLElement;
  if (target.id === 'home-range-mode') {
    rangeMode = (target as HTMLSelectElement).value as RangeMode;
    render();
    return;
  }
  if (target.id === 'home-range-year') {
    rangeYear = Number((target as HTMLSelectElement).value);
    render();
    return;
  }
  if (target.id === 'home-range-month') {
    rangeMonth = Number((target as HTMLSelectElement).value);
    render();
    return;
  }
  if (target.id === 'home-range-from' || target.id === 'home-range-to') {
    customFrom = (document.getElementById('home-range-from') as HTMLInputElement)?.value || '';
    customTo = (document.getElementById('home-range-to') as HTMLInputElement)?.value || '';
    render();
  }
}
