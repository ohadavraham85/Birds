/* views/home.ts — מסך הבית: נקודת המוצא והחזרה הראשית של האפליקציה.
 * כולל את "ציפור היום" (מין שנבחר אוטומטית ומשתנה מדי יום, עם תמונה אם יש
 * ופרטים מכרטיס המין; לחיצה פותחת את הכרטיס המלא בטאב "מינים") ואת לוח
 * הסטטיסטיקה (שהיה בעבר טאב נפרד) — מספרי-על, פילוח לפי מין/מיקום/תגית
 * ומגמה שנתית, עם סינון לפי שנה/חודש/טווח מותאם, פלטת צבעים מגוונת בגרפים,
 * ולחיצה על כל נתון שמפנה ליומן/ללוח השנה המסונן. חוזרים למסך הזה תמיד
 * באותו מצב סינון/גרפים וגלילה שהיו כשיצאת ממנו (למשל אחרי לחיצה על גרף). */

import { listObservations, listSpeciesRows, listAllMedia } from '../db/repository';
import { getSpeciesDetail } from '../lib/species-details-cache';
import { speciesNames, speciesLabel, entriesOf, entryImages } from '../lib/observation';
import { getImageObjectUrl } from '../lib/media';
import { escapeHtml } from '../lib/markdown';
import { fmtDateTime } from '../lib/ui';
import { icon } from '../lib/icons';
import { loadDraft, clearDraft } from '../lib/draft';
import { openSmartVoiceModal } from '../lib/voice-observation-modal';
import { qs } from '../lib/dom';
import { navigate } from '../main';
import type { Observation, ObservationImage } from '../types';

type BreakdownKind = 'species' | 'location' | 'tag';
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
/** Gallery photos tagged with a species directly (no observation link) —
 * first one per species, used as a fallback photo when a species has no
 * observation photo yet. */
let orphanPhotoBySpecies: Record<string, ObservationImage> = {};

const chartMode: Record<BreakdownKind, ChartMode> = { species: 'pie', location: 'bar', tag: 'bar' };
let yearMode: 'bar' | 'line' = 'bar';

let rangeMode: RangeMode = 'all';
let rangeYear = new Date().getFullYear();
let rangeMonth = new Date().getMonth() + 1;
let customFrom = '';
let customTo = '';

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
  orphanPhotoBySpecies = {};
  for (const m of await listAllMedia()) {
    if (m.obsId || !m.species || orphanPhotoBySpecies[m.species]) continue;
    orphanPhotoBySpecies[m.species] = { localId: m.id, name: m.name, remoteId: m.remoteId };
  }
  render();
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
  const orphan = orphanPhotoBySpecies[name];
  if (orphan) return { img: orphan, obsId: '' };
  return null;
}

function birdOfDayHtml(): string {
  const name = pickBirdOfDay();
  if (!name) return '';
  const d = getSpeciesDetail(name);
  const seenCount = allObservations.filter((o) => speciesNames(o).includes(name)).length;
  return `
    <button type="button" class="bod-card" id="bod-card" data-name="${escapeHtml(name)}">
      <span class="bod-eyebrow">${icon('compass')} ציפור היום</span>
      <div class="bod-media" id="bod-media">${icon('bird', 'bod-fallback-icon')}</div>
      <div class="bod-info">
        <div class="bod-info-main">
          <span class="bod-he">${escapeHtml(d.he)}</span>
          ${d.en ? `<span class="bod-en" dir="ltr">${escapeHtml(d.en)}</span>` : ''}
          ${d.family ? `<span class="bod-family">${escapeHtml(d.family)}</span>` : ''}
          ${seenCount ? `<span class="bod-seen">${icon('journal')} נצפה ${seenCount} פעמים על ידך</span>` : `<span class="bod-seen bod-not-seen">עוד לא נצפה על ידך</span>`}
        </div>
        <span class="bod-chevron">›</span>
      </div>
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

/* ---------- On This Day ---------- */

/** The most recent past-year observation whose month/day matches today, if any. */
function pickOnThisDay(): Observation | null {
  const today = new Date();
  const mm = today.getMonth();
  const dd = today.getDate();
  const matches = allObservations.filter((o) => {
    const d = new Date(o.dateTime);
    return d.getMonth() === mm && d.getDate() === dd && d.getFullYear() < today.getFullYear();
  });
  if (!matches.length) return null;
  matches.sort((a, b) => new Date(b.dateTime).getFullYear() - new Date(a.dateTime).getFullYear());
  return matches[0]!;
}

function firstPhotoForObservation(o: Observation): { img: ObservationImage; obsId: string } | null {
  for (const entry of entriesOf(o)) {
    const imgs = entryImages(entry);
    if (imgs.length) return { img: imgs[0]!, obsId: o.id };
  }
  return null;
}

function yearsAgoLabel(dateTime: string): string {
  const years = new Date().getFullYear() - new Date(dateTime).getFullYear();
  return years === 1 ? 'לפני שנה' : `לפני ${years} שנים`;
}

function onThisDayHtml(): string {
  const obs = pickOnThisDay();
  if (!obs) return '';
  const name = speciesLabel(obs) || 'ללא מין';
  const dateLabel = new Date(obs.dateTime).toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit', year: 'numeric' });
  return `
    <button type="button" class="otd-card" id="otd-card" data-id="${obs.id}">
      <div class="otd-media" id="otd-media">${icon('clock', 'otd-fallback-icon')}</div>
      <div class="otd-info">
        <span class="otd-eyebrow">${icon('clock')} בתאריך זה בהיסטוריה</span>
        <span class="otd-when">${yearsAgoLabel(obs.dateTime)}, ${dateLabel}</span>
        <span class="otd-species">${escapeHtml(name)}</span>
        ${obs.locationName ? `<span class="otd-location">${escapeHtml(obs.locationName)}</span>` : ''}
      </div>
      <span class="otd-chevron">›</span>
    </button>`;
}

function renderOnThisDayPhoto(): void {
  const obs = pickOnThisDay();
  if (!obs) return;
  const media = container.querySelector<HTMLElement>('#otd-media');
  if (!media) return;
  const photo = firstPhotoForObservation(obs);
  if (!photo) return;
  void getImageObjectUrl(photo.img, photo.obsId).then((url) => {
    if (!url) return;
    media.innerHTML = '';
    const el = document.createElement('img');
    el.src = url;
    el.alt = '';
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

/** Converts whichever range filter is currently selected on the home screen
 * into concrete YYYY-MM-DD bounds, so the "תצפיות" stats tile can hand the
 * journal an equivalent date-range filter (empty strings = unbounded). */
function activeRangeAsDates(): { from: string; to: string } {
  const pad = (n: number): string => String(n).padStart(2, '0');
  if (rangeMode === 'year') return { from: `${rangeYear}-01-01`, to: `${rangeYear}-12-31` };
  if (rangeMode === 'month') {
    const lastDay = new Date(rangeYear, rangeMonth, 0).getDate();
    return { from: `${rangeYear}-${pad(rangeMonth)}-01`, to: `${rangeYear}-${pad(rangeMonth)}-${pad(lastDay)}` };
  }
  if (rangeMode === 'custom') return { from: customFrom, to: customTo };
  return { from: '', to: '' };
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
  const tagCounts = new Map<string, number>();
  const yearCounts = new Map<string, number>();
  let minDate = observations[0]!.dateTime;
  let maxDate = observations[0]!.dateTime;

  for (const o of observations) {
    if (o.dateTime < minDate) minDate = o.dateTime;
    if (o.dateTime > maxDate) maxDate = o.dateTime;

    for (const name of new Set(speciesNames(o))) speciesCounts.set(name, (speciesCounts.get(name) || 0) + 1);

    const loc = o.locationName.trim();
    if (loc) locationCounts.set(loc, (locationCounts.get(loc) || 0) + 1);
    for (const tag of new Set(o.tags)) tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1);

    const year = new Date(o.dateTime).getFullYear();
    if (!isNaN(year)) yearCounts.set(String(year), (yearCounts.get(String(year)) || 0) + 1);
  }
  const tiles: { label: string; value: number; tile?: 'species' | 'location' | 'observations' | 'tag' }[] = [
    { label: 'תצפיות', value: observations.length, tile: 'observations' },
    { label: 'מינים', value: speciesCounts.size, tile: 'species' },
    { label: 'מיקומים', value: locationCounts.size, tile: 'location' },
    { label: 'תגיות', value: tagCounts.size, tile: 'tag' },
  ];

  const tileHtml = (t: (typeof tiles)[number]): string => {
    const inner = `
      <span class="stat-tile-value">${t.value.toLocaleString('he-IL')}</span>
      <span class="stat-tile-label">${escapeHtml(t.label)}</span>`;
    return t.tile
      ? `<button type="button" class="stat-tile stat-tile-link" data-tile="${t.tile}">${inner}</button>`
      : `<div class="stat-tile">${inner}</div>`;
  };

  const tilesHtml = `
    <div class="stat-tiles">
      ${tiles.map(tileHtml).join('')}
    </div>
    <p class="stat-range">מהתצפית הראשונה (${fmtDateTime(minDate)}) ועד האחרונה (${fmtDateTime(maxDate)})</p>`;

  const years = [...yearCounts.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  const yearChart = yearMode === 'bar' ? yearChartBar(years) : yearChartLine(years);

  const topSpecies = [...speciesCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
  const speciesChart = breakdownChart('species', 'המינים הנפוצים ביותר', topSpecies, 'תצפיות');

  const topLocations = [...locationCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
  const locationsChart = breakdownChart('location', 'מיקומים מובילים', topLocations, 'תצפיות');

  const tags = [...tagCounts.entries()].sort((a, b) => b[1] - a[1]);
  const tagsChart = breakdownChart('tag', 'פילוח לפי תגית', tags, 'תצפיות');

  return tilesHtml + yearChart + goalsHtml() + speciesChart + familyChartHtml(observations) + locationsChart + tagsChart;
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

/* ---------- birding goals ---------- */

/** Fixed annual target the user asked for; the monthly breakdown below is
 * derived from real history rather than an even 200/12 split, so pacing
 * feedback matches this birder's own seasonal pattern (e.g. spring nesting
 * season naturally carries a bigger share of the year's observations). */
const ANNUAL_GOAL = 200;

/** Fixed pass/fail semantics for goal charts — deliberately not the
 * qualitative PALETTE, so "met" always reads as green and "missed" as red
 * regardless of which month/slice it is. */
const GOAL_COLORS = { met: '#2f9e44', missed: '#e03131', upcoming: '#ced4da' } as const;

let goalsViewMode: 'yearly' | 'monthly' = 'yearly';

interface GoalsData {
  busiestYear: number;
  busiestYearTotal: number;
  /** Observation counts per calendar month (index 0=Jan..11=Dec) during the
   * busiest year — used as this birder's own monthly pace target. */
  monthlyGoals: number[];
  currentYear: number;
  currentYearTotal: number;
  currentYearMonthly: number[];
  /** Index (0=Jan..11=Dec) of the current calendar month — months after this
   * one haven't happened yet this year and can't be scored met/missed. */
  currentMonth: number;
}

function computeGoals(): GoalsData | null {
  const yearCounts = new Map<number, number>();
  for (const o of allObservations) {
    const y = new Date(o.dateTime).getFullYear();
    if (!isNaN(y)) yearCounts.set(y, (yearCounts.get(y) || 0) + 1);
  }
  if (!yearCounts.size) return null;

  let busiestYear = 0;
  let busiestYearTotal = -1;
  for (const [y, n] of yearCounts) {
    if (n > busiestYearTotal) { busiestYear = y; busiestYearTotal = n; }
  }

  const monthlyGoals = new Array(12).fill(0) as number[];
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentYearMonthly = new Array(12).fill(0) as number[];
  let currentYearTotal = 0;
  for (const o of allObservations) {
    const d = new Date(o.dateTime);
    if (d.getFullYear() === busiestYear) monthlyGoals[d.getMonth()]!++;
    if (d.getFullYear() === currentYear) { currentYearMonthly[d.getMonth()]!++; currentYearTotal++; }
  }

  return { busiestYear, busiestYearTotal, monthlyGoals, currentYear, currentYearTotal, currentYearMonthly, currentMonth: now.getMonth() };
}

/** Per-month pass/fail against that month's historical-pace goal — months
 * that haven't happened yet this year, or that never had a target in the
 * reference year, are neither met nor missed. */
function monthStatus(g: GoalsData, i: number): 'met' | 'missed' | 'upcoming' {
  if (i > g.currentMonth) return 'upcoming';
  const goal = g.monthlyGoals[i]!;
  if (goal === 0) return 'upcoming';
  return g.currentYearMonthly[i]! >= goal ? 'met' : 'missed';
}

function goalsHtml(): string {
  const g = computeGoals();
  if (!g) return '';
  const total = g.monthlyGoals.reduce((a, b) => a + b, 0);
  const R = 15.9155;
  let running = 0;
  const segments = g.monthlyGoals.map((n, i) => {
    if (!n) return '';
    const pct = total ? (n / total) * 100 : 0;
    const offset = -running;
    running += pct;
    const status = monthStatus(g, i);
    return `<circle class="stat-donut-seg" cx="21" cy="21" r="${R}" fill="none" stroke="${GOAL_COLORS[status]}" stroke-width="7.5"
      stroke-dasharray="${pct.toFixed(2)} ${(100 - pct).toFixed(2)}" stroke-dashoffset="${offset.toFixed(2)}"><title>${escapeHtml(MONTH_NAMES[i]!)}: יעד ${n}, בפועל ${g.currentYearMonthly[i]}</title></circle>`;
  }).join('');

  const legend = MONTH_NAMES.map((name, i) => {
    const goal = g.monthlyGoals[i]!;
    const actual = g.currentYearMonthly[i]!;
    const status = monthStatus(g, i);
    return `
      <div class="goal-legend-row goal-${status}">
        <span class="stat-donut-dot" style="background:${GOAL_COLORS[status]}"></span>
        <span class="goal-legend-label">${escapeHtml(name)}</span>
        <span class="goal-legend-value" dir="ltr">${actual} / ${goal}</span>
      </div>`;
  }).join('');

  return `
    <div class="stat-card">
      <div class="stat-card-head"><h3>${icon('target')} יעדי צפרות</h3></div>
      <p class="goal-sub">פילוח היעד החודשי מבוסס על השנה הפעילה ביותר שלך — ${g.busiestYear} (${g.busiestYearTotal} תצפיות)</p>
      <div class="stat-donut-wrap">
        <svg viewBox="0 0 42 42" class="stat-donut" role="img" aria-label="יעדי צפרות חודשיים">
          <g transform="rotate(-90 21 21)">
            <circle cx="21" cy="21" r="${R}" fill="none" stroke="var(--accent-50)" stroke-width="7.5"></circle>
            ${segments}
          </g>
          <text x="21" y="19.5" text-anchor="middle" font-size="7" font-weight="700" fill="var(--accent-900)">${ANNUAL_GOAL}</text>
          <text x="21" y="25" text-anchor="middle" font-size="3.4" fill="var(--ink-soft)">יעד שנתי</text>
        </svg>
        <div class="stat-donut-legend goal-legend">
          ${legend}
        </div>
      </div>
      <p class="goal-progress">התקדמות ${g.currentYear}: <span dir="ltr">${g.currentYearTotal} / ${ANNUAL_GOAL}</span> תצפיות</p>
      ${attainmentHtml(g)}
    </div>`;
}

/** Small secondary donut: how many (elapsed) months hit their monthly goal
 * vs missed it. Toggles between a whole-year tally and a close-up of just
 * the current month's own progress. */
function attainmentHtml(g: GoalsData): string {
  const R = 12;
  const toggleBtn = `<button type="button" class="btn btn-icon" data-toggle="goalsView" title="החלפת תצוגה שנתית/חודשית" aria-label="החלפת תצוגה שנתית/חודשית">${icon('calendar')}</button>`;

  if (goalsViewMode === 'monthly') {
    const i = g.currentMonth;
    const goal = g.monthlyGoals[i]!;
    const actual = g.currentYearMonthly[i]!;
    if (!goal) {
      return `
        <div class="stat-card goal-attainment-card">
          <div class="stat-card-head"><h4>עמידה ביעד — ${escapeHtml(MONTH_NAMES[i]!)}</h4>${toggleBtn}</div>
          <p class="goal-sub">לחודש זה אין יעד (לא נצפו תצפיות בחודש זה בשנה הפעילה ביותר).</p>
        </div>`;
    }
    const pct = Math.min(100, (actual / goal) * 100);
    const met = actual >= goal;
    const color = met ? GOAL_COLORS.met : GOAL_COLORS.missed;
    return `
      <div class="stat-card goal-attainment-card">
        <div class="stat-card-head"><h4>עמידה ביעד — ${escapeHtml(MONTH_NAMES[i]!)}</h4>${toggleBtn}</div>
        <div class="stat-donut-wrap">
          <svg viewBox="0 0 42 42" class="stat-donut stat-donut-sm" role="img" aria-label="עמידה ביעד החודש">
            <g transform="rotate(-90 21 21)">
              <circle cx="21" cy="21" r="${R}" fill="none" stroke="var(--accent-50)" stroke-width="6"></circle>
              <circle cx="21" cy="21" r="${R}" fill="none" stroke="${color}" stroke-width="6"
                stroke-dasharray="${pct.toFixed(2)} ${(100 - pct).toFixed(2)}"><title>${actual} / ${goal}</title></circle>
            </g>
            <text x="21" y="23" text-anchor="middle" direction="ltr" font-size="7" font-weight="700" fill="var(--accent-900)">${actual}/${goal}</text>
          </svg>
          <div class="stat-donut-legend">
            <div class="goal-legend-row goal-${met ? 'met' : 'missed'}">
              <span class="stat-donut-dot" style="background:${color}"></span>
              <span class="goal-legend-label">${met ? 'עומד ביעד החודש' : 'מתחת ליעד החודש'}</span>
              <span class="goal-legend-value" dir="ltr">${actual} / ${goal}</span>
            </div>
          </div>
        </div>
      </div>`;
  }

  const statuses = Array.from({ length: 12 }, (_, i) => monthStatus(g, i));
  const met = statuses.filter((s) => s === 'met').length;
  const missed = statuses.filter((s) => s === 'missed').length;
  const total = met + missed;
  if (!total) {
    return `
      <div class="stat-card goal-attainment-card">
        <div class="stat-card-head"><h4>עמידה ביעד חודשי</h4>${toggleBtn}</div>
        <p class="goal-sub">עדיין אין חודשים עם יעד להשוואה השנה.</p>
      </div>`;
  }
  const metPct = (met / total) * 100;
  const segMet = met ? `<circle cx="21" cy="21" r="${R}" fill="none" stroke="${GOAL_COLORS.met}" stroke-width="6"
    stroke-dasharray="${metPct.toFixed(2)} ${(100 - metPct).toFixed(2)}"><title>עמדו ביעד: ${met}</title></circle>` : '';
  const segMissed = missed ? `<circle cx="21" cy="21" r="${R}" fill="none" stroke="${GOAL_COLORS.missed}" stroke-width="6"
    stroke-dasharray="${(100 - metPct).toFixed(2)} ${metPct.toFixed(2)}" stroke-dashoffset="${(-metPct).toFixed(2)}"><title>לא עמדו ביעד: ${missed}</title></circle>` : '';

  return `
    <div class="stat-card goal-attainment-card">
      <div class="stat-card-head"><h4>עמידה ביעד חודשי</h4>${toggleBtn}</div>
      <div class="stat-donut-wrap">
        <svg viewBox="0 0 42 42" class="stat-donut stat-donut-sm" role="img" aria-label="עמידה ביעד חודשי לאורך השנה">
          <g transform="rotate(-90 21 21)">
            <circle cx="21" cy="21" r="${R}" fill="none" stroke="var(--accent-50)" stroke-width="6"></circle>
            ${segMet}${segMissed}
          </g>
          <text x="21" y="23" text-anchor="middle" direction="ltr" font-size="7" font-weight="700" fill="var(--accent-900)">${met}/${total}</text>
        </svg>
        <div class="stat-donut-legend">
          <div class="goal-legend-row goal-met">
            <span class="stat-donut-dot" style="background:${GOAL_COLORS.met}"></span>
            <span class="goal-legend-label">עמדו ביעד</span>
            <span class="goal-legend-value">${met}</span>
          </div>
          <div class="goal-legend-row goal-missed">
            <span class="stat-donut-dot" style="background:${GOAL_COLORS.missed}"></span>
            <span class="goal-legend-label">לא עמדו ביעד</span>
            <span class="goal-legend-value">${missed}</span>
          </div>
        </div>
      </div>
    </div>`;
}

/** Species breakdown by taxonomic family (from the field-guide data bundled
 * with the app) — clicking a slice opens the species tab, which already
 * groups by family by default. */
function familyChartHtml(observations: Observation[]): string {
  const familyCounts = new Map<string, number>();
  for (const o of observations) {
    for (const name of new Set(speciesNames(o))) {
      const family = getSpeciesDetail(name).family || '(ללא משפחה)';
      familyCounts.set(family, (familyCounts.get(family) || 0) + 1);
    }
  }
  const rows = [...familyCounts.entries()].sort((a, b) => b[1] - a[1]);
  if (!rows.length) return '';

  const total = rows.reduce((sum, [, n]) => sum + n, 0);
  const R = 15.9155;
  let running = 0;
  const segments = rows.map(([label, n], i) => {
    const pct = total ? (n / total) * 100 : 0;
    const offset = -running;
    running += pct;
    return `<circle class="stat-donut-seg" data-drill="family" data-value="${escapeHtml(label)}"
      cx="21" cy="21" r="${R}" fill="none" stroke="${colorFor(i)}" stroke-width="7.5"
      stroke-dasharray="${pct.toFixed(2)} ${(100 - pct).toFixed(2)}" stroke-dashoffset="${offset.toFixed(2)}"><title>${escapeHtml(label)}: ${n}</title></circle>`;
  }).join('');

  return `
    <div class="stat-card">
      <div class="stat-card-head"><h3>${icon('bird')} פילוח לפי משפחות</h3></div>
      <div class="stat-donut-wrap">
        <svg viewBox="0 0 42 42" class="stat-donut" role="img" aria-label="פילוח מינים לפי משפחה">
          <g transform="rotate(-90 21 21)">
            <circle cx="21" cy="21" r="${R}" fill="none" stroke="var(--accent-50)" stroke-width="7.5"></circle>
            ${segments}
          </g>
        </svg>
        <div class="stat-donut-legend">
          ${rows.map(([label, n], i) => `
            <button type="button" class="stat-donut-legend-row" data-drill="family" data-value="${escapeHtml(label)}">
              <span class="stat-donut-dot" style="background:${colorFor(i)}"></span>
              <span class="stat-donut-legend-label">${escapeHtml(label)}</span>
              <span class="stat-donut-legend-value">${n.toLocaleString('he-IL')} תצפיות</span>
            </button>`).join('')}
        </div>
      </div>
    </div>`;
}

const TITLES: Record<BreakdownKind, string> = { species: 'מין', location: 'מיקום', tag: 'תגית' };

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

/** A recovery banner for a new observation that was being composed when the
 * app got interrupted (incoming call, switching away to write a message,
 * etc.) — mobile browsers can fully discard a backgrounded tab, wiping all
 * in-memory state; the draft was auto-saved to localStorage so it survives
 * that. See lib/draft.ts and views/form.ts's draft auto-save. */
function draftBannerHtml(): string {
  const draft = loadDraft();
  if (!draft) return '';
  const time = new Date(draft.savedAt).toLocaleString('he-IL', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  const speciesCount = draft.fields.entries.filter((e) => e.species).length;
  const trackNote = draft.track && draft.track.points.length >= 2 ? ` · מסלול GPS (${draft.track.points.length} נקודות)` : '';
  const title = draft.editId ? 'עריכת תצפית פתוחה שלא נשמרה' : 'תצפית פתוחה שלא נשמרה';
  return `
    <div class="draft-banner">
      <div class="draft-banner-text">
        <b>${icon('alert')} ${title}</b>
        <span>מ-${escapeHtml(time)}${speciesCount ? ` · ${speciesCount} מינים` : ''}${trackNote}</span>
      </div>
      <div class="draft-banner-actions">
        <button type="button" class="btn btn-sm btn-primary" data-draft-action="resume" data-draft-edit-id="${draft.editId ? escapeHtml(draft.editId) : ''}">המשך</button>
        <button type="button" class="btn btn-sm" data-draft-action="discard">מחק</button>
      </div>
    </div>`;
}

function smartVoiceButtonHtml(): string {
  return `<button type="button" class="btn btn-block voice-ai-btn" id="smart-voice-btn">${icon('sparkles')} תצפית קולית חכמה</button>`;
}

function render(): void {
  qs(container, '#home-body').innerHTML = draftBannerHtml() + smartVoiceButtonHtml() + birdOfDayHtml() + onThisDayHtml() + rangeBarHtml() + statsHtml(filteredObservations());
  renderBirdOfDayPhoto();
  renderOnThisDayPhoto();
}

function onClick(e: Event): void {
  const target = e.target as HTMLElement;

  if (target.closest('#smart-voice-btn')) { openSmartVoiceModal(); return; }

  const draftAction = target.closest<HTMLElement>('[data-draft-action]');
  if (draftAction) {
    if (draftAction.dataset.draftAction === 'resume') {
      const editId = draftAction.dataset.draftEditId;
      navigate('form', editId ? { editId, resumeDraft: true } : { resumeDraft: true });
    } else { clearDraft(); render(); }
    return;
  }

  const bod = target.closest<HTMLElement>('#bod-card');
  if (bod) { navigate('species', { species: bod.dataset.name! }); return; }

  const otd = target.closest<HTMLElement>('#otd-card');
  if (otd) { navigate('detail', { viewId: otd.dataset.id! }); return; }

  const tile = target.closest<HTMLElement>('[data-tile]');
  if (tile) {
    const kind = tile.dataset.tile!;
    if (kind === 'species') navigate('species');
    else if (kind === 'location') navigate('map');
    else if (kind === 'observations') { const { from, to } = activeRangeAsDates(); navigate('cards', { filterFrom: from, filterTo: to }); }
    else if (kind === 'tag') navigate('cards', { groupBy: 'tag' });
    return;
  }

  const toggle = target.closest<HTMLElement>('[data-toggle]');
  if (toggle) {
    const kind = toggle.dataset.toggle as BreakdownKind | 'year' | 'goalsView';
    if (kind === 'year') yearMode = yearMode === 'bar' ? 'line' : 'bar';
    else if (kind === 'goalsView') goalsViewMode = goalsViewMode === 'yearly' ? 'monthly' : 'yearly';
    else chartMode[kind] = chartMode[kind] === 'bar' ? 'pie' : 'bar';
    render();
    return;
  }

  const drill = target.closest<HTMLElement>('[data-drill]');
  if (!drill) return;
  const kind = drill.dataset.drill!;
  const value = drill.dataset.value!;
  if (kind === 'species') navigate('cards', { filterSpecies: value });
  else if (kind === 'location') navigate('cards', { filterLocation: value });
  else if (kind === 'tag') navigate('cards', { filterTag: value });
  else if (kind === 'year') navigate('cards', { year: Number(value) });
  else if (kind === 'family') navigate('species');
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
