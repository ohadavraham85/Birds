/* views/stats.ts — טאב סטטיסטיקה: מספרי-על (תצפיות, מינים, פרטים, מיקומים,
 * פרויקטים, טווח תאריכים) ופילוח: המינים הנפוצים ביותר, מיקומים מובילים,
 * פרויקטים (עמודות/עוגה, לבחירה), ותצפיות לפי שנה (עמודות/גרף קו). כל שורה,
 * פרוסה או נקודה ניתנת ללחיצה ומובילה ליומן מסונן (או ללוח השנה לשנה שנבחרה). */

import { listObservations } from '../db/repository';
import { speciesNames, totalQuantity } from '../lib/observation';
import { escapeHtml } from '../lib/markdown';
import { fmtDateTime } from '../lib/ui';
import { icon } from '../lib/icons';
import { qs } from '../lib/dom';
import { navigate } from '../main';
import type { Observation } from '../types';

type BreakdownKind = 'species' | 'location' | 'project';
type ChartMode = 'bar' | 'pie';

let container: HTMLElement;
let lastObservations: Observation[] = [];
const chartMode: Record<BreakdownKind, ChartMode> = { species: 'bar', location: 'bar', project: 'bar' };
let yearMode: 'bar' | 'line' = 'bar';

export function init(el: HTMLElement): void {
  container = el;
  container.innerHTML = '<h2>סטטיסטיקה</h2><div id="stats-body"></div>';
  qs(container, '#stats-body').addEventListener('click', onStatsClick);
}

export async function activate(): Promise<void> {
  lastObservations = await listObservations();
  renderBody();
}

function onStatsClick(e: Event): void {
  const toggle = (e.target as HTMLElement).closest<HTMLElement>('[data-toggle]');
  if (toggle) {
    const kind = toggle.dataset.toggle as BreakdownKind | 'year';
    if (kind === 'year') yearMode = yearMode === 'bar' ? 'line' : 'bar';
    else chartMode[kind] = chartMode[kind] === 'bar' ? 'pie' : 'bar';
    renderBody();
    return;
  }
  const drill = (e.target as HTMLElement).closest<HTMLElement>('[data-drill]');
  if (!drill) return;
  const kind = drill.dataset.drill!;
  const value = drill.dataset.value!;
  if (kind === 'species') navigate('cards', { filterSpecies: value });
  else if (kind === 'location') navigate('cards', { filterLocation: value });
  else if (kind === 'project') navigate('cards', { filterProject: value });
  else if (kind === 'year') navigate('calendar', { year: Number(value) });
}

function renderBody(): void {
  qs(container, '#stats-body').innerHTML = render(lastObservations);
}

function render(observations: Observation[]): string {
  if (!observations.length) {
    return '<p style="color:var(--ink-soft)">אין עדיין תצפיות — לאחר הוספת תצפיות יופיעו כאן נתונים וגרפים.</p>';
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

/* ---------- year trend: bar / line toggle ---------- */

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
        ${rows.map(([label, n]) => `
          <button type="button" class="stat-year-col" data-drill="year" data-value="${escapeHtml(label)}">
            <span class="stat-year-value">${n}</span>
            <div class="stat-year-bar" style="height:${max ? Math.max(4, (n / max) * 100) : 0}%"></div>
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

/* ---------- species / location / project: bar / pie toggle ---------- */

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
      ${rows.map(([label, n]) => `
        <button type="button" class="stat-bar-row" data-drill="${kind}" data-value="${escapeHtml(label)}" title="${escapeHtml(TITLES[kind])}: ${escapeHtml(label)}">
          <span class="stat-bar-label">${escapeHtml(label)}</span>
          <div class="stat-bar-track"><div class="stat-bar-fill" style="width:${max ? (n / max) * 100 : 0}%"></div></div>
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
    const shade = rows.length > 1 ? i / (rows.length - 1) : 0;
    const mix = Math.round(85 - shade * 65);
    const color = `color-mix(in srgb, var(--accent-700) ${mix}%, var(--accent-50))`;
    return `<circle class="stat-donut-seg" data-drill="${kind}" data-value="${escapeHtml(label)}"
      cx="21" cy="21" r="${R}" fill="none" stroke="${color}" stroke-width="7.5"
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
        ${rows.map(([label, n], i) => {
          const shade = rows.length > 1 ? i / (rows.length - 1) : 0;
          const mix = Math.round(85 - shade * 65);
          return `
            <button type="button" class="stat-donut-legend-row" data-drill="${kind}" data-value="${escapeHtml(label)}">
              <span class="stat-donut-dot" style="background:color-mix(in srgb, var(--accent-700) ${mix}%, var(--accent-50))"></span>
              <span class="stat-donut-legend-label">${escapeHtml(label)}</span>
              <span class="stat-donut-legend-value">${n.toLocaleString('he-IL')} ${escapeHtml(unit)}</span>
            </button>`;
        }).join('')}
      </div>
    </div>`;
}
