/* views/series.ts — "ספריית מעקבים": a dedicated library of every "מעקב"
 * (tracking series), separate from the journal — a list of series filterable
 * by status, and a detail screen per series showing its own info plus every
 * observation linked to it, chronologically. Reached from the home screen's
 * "מעקבים פעילים" widget ("ספריית מעקבים" button, or tapping a series row). */

import {
  listSeriesRows, listObservations, listSpeciesRows, saveSeries, deleteSeries,
} from '../db/repository';
import {
  seriesDayLabel, isSeriesOverdue, SERIES_STATUS_LABELS,
  openCreateSeriesModal, openEditSeriesModal,
} from '../lib/series';
import { renderObservationCard } from '../lib/obs-card';
import { escapeHtml } from '../lib/markdown';
import { confirmDialog, toast } from '../lib/ui';
import { icon } from '../lib/icons';
import { qs } from '../lib/dom';
import { navigate } from '../main';
import type { ViewParams } from './view';
import type { SeriesRow, Observation } from '../types';

type StatusFilter = 'all' | 'active' | 'completed' | 'abandoned';

let container: HTMLElement;
let mode: 'list' | 'detail' = 'list';
let detailId: string | null = null;
let allSeries: SeriesRow[] = [];
let allObservations: Observation[] = [];
let speciesMasterList: string[] = [];
let statusFilter: StatusFilter = 'all';

export function init(el: HTMLElement): void {
  container = el;
  container.innerHTML = `
    <div class="series-lib-head">
      <button type="button" class="btn btn-sm" id="series-back-btn" hidden>→ ספריית מעקבים</button>
      <h2 id="series-lib-title">ספריית מעקבים</h2>
    </div>
    <div id="series-lib-body"></div>
  `;
  qs(container, '#series-back-btn').addEventListener('click', () => navigate('series'));
  qs(container, '#series-lib-body').addEventListener('click', (e) => void onClick(e));
}

export function setParams(params: ViewParams): void {
  detailId = params?.seriesId || null;
  mode = detailId ? 'detail' : 'list';
}

export async function activate(): Promise<void> {
  allSeries = await listSeriesRows();
  allObservations = await listObservations();
  speciesMasterList = (await listSpeciesRows()).map((r) => r.name);
  render();
}

function obsCountBySeries(): Map<string, number> {
  const m = new Map<string, number>();
  for (const o of allObservations) {
    if (!o.seriesId) continue;
    m.set(o.seriesId, (m.get(o.seriesId) || 0) + 1);
  }
  return m;
}

function fmtDateOnly(iso: string): string {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? '' : d.toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function render(): void {
  const series = detailId ? allSeries.find((s) => s.id === detailId) : undefined;
  qs(container, '#series-back-btn').hidden = mode === 'list';
  qs(container, '#series-lib-title').textContent = mode === 'detail' ? (series?.name || 'מעקב') : 'ספריית מעקבים';
  qs(container, '#series-lib-body').innerHTML = mode === 'detail' ? renderDetail(series) : renderList();
  if (mode === 'detail' && series) mountObservationCards();
}

/* ---------- library (list) ---------- */

function renderList(): string {
  const counts = obsCountBySeries();
  const now = new Date();
  const tabs: { key: StatusFilter; label: string }[] = [
    { key: 'all', label: 'הכל' },
    { key: 'active', label: 'פעיל' },
    { key: 'completed', label: 'הושלם' },
    { key: 'abandoned', label: 'ננטש' },
  ];
  const tabsHtml = `
    <div class="series-lib-tabs">
      ${tabs.map((t) => `<button type="button" class="btn btn-sm${statusFilter === t.key ? ' active' : ''}" data-status-filter="${t.key}">${t.label}</button>`).join('')}
      <button type="button" class="btn btn-sm btn-primary series-lib-add" id="series-lib-add">${icon('plus')} מעקב חדש</button>
    </div>`;

  const filtered = statusFilter === 'all' ? allSeries : allSeries.filter((s) => s.status === statusFilter);
  const sorted = [...filtered].sort((a, b) => {
    if (a.status !== b.status) return a.status === 'active' ? -1 : b.status === 'active' ? 1 : 0;
    if (a.status === 'active') {
      const ao = isSeriesOverdue(a, now) ? 0 : 1;
      const bo = isSeriesOverdue(b, now) ? 0 : 1;
      if (ao !== bo) return ao - bo;
    }
    return b.startDate.localeCompare(a.startDate);
  });

  if (!sorted.length) {
    return `${tabsHtml}<p class="hint">${statusFilter === 'all' ? 'אין עדיין אף מעקב — לחצו על "מעקב חדש" כדי להתחיל.' : 'אין מעקבים בסטטוס זה.'}</p>`;
  }

  const rows = sorted.map((s) => {
    const overdue = isSeriesOverdue(s, now);
    const count = counts.get(s.id) || 0;
    return `
      <button type="button" class="series-lib-row${overdue ? ' overdue' : ''}" data-series-id="${s.id}">
        <span class="series-lib-row-main">
          <span class="series-lib-row-name">${overdue ? icon('alert') : ''}${escapeHtml(s.name)}</span>
          ${s.species ? `<span class="series-lib-row-species">${escapeHtml(s.species)}</span>` : ''}
        </span>
        <span class="series-lib-row-meta">
          <span class="series-status-badge series-status-${s.status}">${SERIES_STATUS_LABELS[s.status]}</span>
          <span class="series-lib-row-day">${escapeHtml(s.status === 'active' ? seriesDayLabel(s, now) : fmtDateOnly(s.startDate))}</span>
          <span class="series-lib-row-count">${count} תצפיות</span>
        </span>
      </button>`;
  }).join('');
  return `${tabsHtml}<div class="series-lib-list">${rows}</div>`;
}

/* ---------- series detail ---------- */

function renderDetail(series: SeriesRow | undefined): string {
  if (!series) {
    return '<p class="hint">המעקב הזה נמחק או לא נמצא.</p>';
  }
  const now = new Date();
  const linked = allObservations
    .filter((o) => o.seriesId === series.id)
    .sort((a, b) => a.dateTime.localeCompare(b.dateTime));

  const infoCard = `
    <div class="stat-card series-detail-card">
      <div class="stat-card-head">
        <h3><span class="series-status-badge series-status-${series.status}">${SERIES_STATUS_LABELS[series.status]}</span> ${escapeHtml(series.name)}</h3>
        <button type="button" class="btn btn-icon" id="series-detail-edit" title="עריכת מעקב" aria-label="עריכת מעקב">${icon('edit')}</button>
      </div>
      ${series.species ? `<p class="series-detail-species">${icon('bird')} ${escapeHtml(series.species)}</p>` : ''}
      <p class="series-detail-day">${series.status === 'active' ? escapeHtml(seriesDayLabel(series, now)) : `התחיל ${escapeHtml(fmtDateOnly(series.startDate))}`}${series.expectedDurationDays && series.status !== 'active' ? ` · משך צפוי: ${series.expectedDurationDays} ימים` : ''}</p>
      ${series.notes ? `<p class="series-detail-notes">${escapeHtml(series.notes)}</p>` : ''}
      <div class="series-detail-actions">
        ${series.status !== 'active' ? `<button type="button" class="btn btn-sm" data-series-status="active">${icon('refresh')} החזרה לפעיל</button>` : ''}
        ${series.status !== 'completed' ? `<button type="button" class="btn btn-sm" data-series-status="completed">${icon('check')} סימון כהושלם</button>` : ''}
        ${series.status !== 'abandoned' ? `<button type="button" class="btn btn-sm" data-series-status="abandoned">✕ סימון כננטש</button>` : ''}
        <button type="button" class="btn btn-sm" id="series-detail-open-journal">${icon('journal')} פתיחה ביומן</button>
        <button type="button" class="btn btn-sm" id="series-detail-add-obs">${icon('plus')} תצפית חדשה למעקב זה</button>
        <button type="button" class="btn btn-sm btn-danger" id="series-detail-delete">${icon('trash')} מחיקת מעקב</button>
      </div>
    </div>`;

  const obsHtml = linked.length
    ? `<h3 class="series-detail-obs-title">${linked.length} תצפיות במעקב זה</h3><div class="series-detail-obs-list" id="series-detail-obs-list"></div>`
    : '<p class="hint">אין עדיין תצפיות משויכות למעקב זה — אפשר להוסיף תצפית חדשה, או לשייך תצפיות קיימות דרך עריכה מרוכזת ביומן.</p>';

  return infoCard + obsHtml;
}

/** Observation cards are DOM elements (not HTML strings), so they're
 * appended after the innerHTML write above — same two-step pattern used by
 * the journal feed itself (views/cards.ts). */
function mountObservationCards(): void {
  const wrap = container.querySelector<HTMLElement>('#series-detail-obs-list');
  if (!wrap || !detailId) return;
  const linked = allObservations
    .filter((o) => o.seriesId === detailId)
    .sort((a, b) => a.dateTime.localeCompare(b.dateTime));
  for (const o of linked) wrap.appendChild(renderObservationCard(o));
}

/* ---------- events ---------- */

async function onClick(e: Event): Promise<void> {
  const target = e.target as HTMLElement;

  const statusTab = target.closest<HTMLElement>('[data-status-filter]');
  if (statusTab) { statusFilter = statusTab.dataset.statusFilter as StatusFilter; render(); return; }

  if (target.closest('#series-lib-add')) {
    const created = await openCreateSeriesModal(speciesMasterList);
    if (!created) return;
    allSeries = await listSeriesRows();
    render();
    return;
  }

  const openRow = target.closest<HTMLElement>('[data-series-id]');
  if (openRow) { navigate('series', { seriesId: openRow.dataset.seriesId! }); return; }

  if (!detailId) return;
  const series = allSeries.find((s) => s.id === detailId);
  if (!series) return;

  if (target.closest('#series-detail-edit')) {
    const updated = await openEditSeriesModal(series, speciesMasterList);
    if (!updated) return;
    allSeries = await listSeriesRows();
    render();
    return;
  }

  const statusBtn = target.closest<HTMLElement>('[data-series-status]');
  if (statusBtn) {
    const status = statusBtn.dataset.seriesStatus as SeriesRow['status'];
    await saveSeries({ ...series, status });
    allSeries = await listSeriesRows();
    render();
    return;
  }

  if (target.closest('#series-detail-open-journal')) { navigate('cards', { filterSeriesId: series.id }); return; }
  if (target.closest('#series-detail-add-obs')) { navigate('form', { prefillSeriesId: series.id, species: series.species }); return; }

  if (target.closest('#series-detail-delete')) {
    if (!(await confirmDialog(`למחוק את המעקב "${series.name}"? התצפיות המקושרות אליו יישארו, אך יאבדו את הקישור.`, 'מחיקת מעקב'))) return;
    await deleteSeries(series.id);
    toast('המעקב נמחק');
    navigate('series');
    return;
  }
}
