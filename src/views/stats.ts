/* views/stats.ts — טאב סטטיסטיקה: מספרי-על (תצפיות, מינים, פרטים, מיקומים,
 * פרויקטים, טווח תאריכים) ופילוח בגרפי עמודות פשוטים: המינים הנפוצים ביותר,
 * מיקומים מובילים, פרויקטים, ותצפיות לפי שנה. */

import { listObservations } from '../db/repository';
import { speciesNames, totalQuantity } from '../lib/observation';
import { escapeHtml } from '../lib/markdown';
import { fmtDateTime } from '../lib/ui';
import { qs } from '../lib/dom';
import type { Observation } from '../types';

let container: HTMLElement;

export function init(el: HTMLElement): void {
  container = el;
  container.innerHTML = '<h2>סטטיסטיקה</h2><div id="stats-body"></div>';
}

export async function activate(): Promise<void> {
  const observations = await listObservations();
  qs(container, '#stats-body').innerHTML = render(observations);
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
  const yearChart = barChartVertical('תצפיות לפי שנה', years);

  const topSpecies = [...speciesCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
  const speciesChart = barChartHorizontal('המינים הנפוצים ביותר', topSpecies, 'תצפיות');

  const topLocations = [...locationCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
  const locationsChart = barChartHorizontal('מיקומים מובילים', topLocations, 'תצפיות');

  const projects = [...projectCounts.entries()].sort((a, b) => b[1] - a[1]);
  const projectsChart = barChartHorizontal('פילוח לפי פרויקט', projects, 'תצפיות');

  return tilesHtml + yearChart + speciesChart + locationsChart + projectsChart;
}

function barChartVertical(title: string, rows: [string, number][]): string {
  if (!rows.length) return '';
  const max = Math.max(...rows.map(([, n]) => n));
  return `
    <div class="stat-card">
      <h3>${escapeHtml(title)}</h3>
      <div class="stat-year-chart">
        ${rows.map(([label, n]) => `
          <div class="stat-year-col">
            <span class="stat-year-value">${n}</span>
            <div class="stat-year-bar" style="height:${max ? Math.max(4, (n / max) * 100) : 0}%"></div>
            <span class="stat-year-label">${escapeHtml(label)}</span>
          </div>`).join('')}
      </div>
    </div>`;
}

function barChartHorizontal(title: string, rows: [string, number][], unit: string): string {
  if (!rows.length) return '';
  const max = Math.max(...rows.map(([, n]) => n));
  return `
    <div class="stat-card">
      <h3>${escapeHtml(title)}</h3>
      <div class="stat-bar-list">
        ${rows.map(([label, n]) => `
          <div class="stat-bar-row">
            <span class="stat-bar-label" title="${escapeHtml(label)}">${escapeHtml(label)}</span>
            <div class="stat-bar-track"><div class="stat-bar-fill" style="width:${max ? (n / max) * 100 : 0}%"></div></div>
            <span class="stat-bar-value">${n.toLocaleString('he-IL')} ${escapeHtml(unit)}</span>
          </div>`).join('')}
      </div>
    </div>`;
}
