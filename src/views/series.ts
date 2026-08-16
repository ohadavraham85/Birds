/* views/series.ts — "ספריית מעקבים": a dedicated library of every "מעקב"
 * (tracking series), separate from the journal — a list of series filterable
 * by status, and a detail screen per series showing its own info plus every
 * observation linked to it, chronologically. Reached from the home screen's
 * "מעקבים פעילים" widget ("ספריית מעקבים" button, or tapping a series row). */

import {
  listSeriesRows, listObservations, listSpeciesRows, saveSeries, deleteSeries, getObservation, saveObservation,
} from '../db/repository';
import {
  seriesDayLabel, isSeriesOverdue, SERIES_STATUS_LABELS,
  openCreateSeriesModal, openEditSeriesModal, seriesPhotoCandidates,
} from '../lib/series';
import { renderObservationCard } from '../lib/obs-card';
import { speciesNames, speciesLabel } from '../lib/observation';
import { getImageObjectUrl } from '../lib/media';
import { escapeHtml } from '../lib/markdown';
import { confirmDialog, toast, fmtDateTime, showModal } from '../lib/ui';
import { icon } from '../lib/icons';
import { qs } from '../lib/dom';
import { navigate } from '../main';
import type { ViewParams } from './view';
import type { SeriesRow, Observation } from '../types';

type StatusFilter = 'all' | 'active' | 'completed' | 'abandoned';
type ObsSortDir = 'asc' | 'desc';

let container: HTMLElement;
let mode: 'list' | 'detail' = 'list';
let detailId: string | null = null;
let allSeries: SeriesRow[] = [];
let allObservations: Observation[] = [];
let speciesMasterList: string[] = [];
let statusFilter: StatusFilter = 'all';
/** Chronological order for the observation list on a series' detail page —
 * defaults to oldest-first (day 1, day 2, ...), toggleable to newest-first. */
let obsSortDir: ObsSortDir = 'asc';

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
  // Closes the two overflow menus rendered on a series' detail page whenever
  // a click lands outside either of them — same pattern as the journal's own
  // bulk-export dropdown (views/cards.ts).
  document.addEventListener('click', (e) => {
    if ((e.target as HTMLElement).closest('.export-wrap')) return;
    container.querySelectorAll<HTMLElement>('#series-add-obs-menu, #series-more-menu').forEach((m) => { m.hidden = true; });
  });
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
  renderSeriesThumbnails();
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
        <span class="series-lib-row-lead">
          <span class="series-lib-row-thumb" data-thumb-series="${s.id}">${icon('target')}</span>
          <span class="series-lib-row-main">
            <span class="series-lib-row-name">${overdue ? icon('alert') : ''}${escapeHtml(s.name)}</span>
            ${s.species ? `<span class="series-lib-row-species">${escapeHtml(s.species)}</span>` : ''}
          </span>
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

/** Fills in every round cover thumbnail currently on screen — library rows
 * and the detail page's own header alike (both mark their placeholder with
 * `data-thumb-series`) — with a photo from one of the series' own linked
 * observations (most recent first), falling back to the generic target icon
 * already shown by default if the series has no photos yet, or none of its
 * candidates actually resolve to a blob. */
function renderSeriesThumbnails(): void {
  for (const el of container.querySelectorAll<HTMLElement>('[data-thumb-series]')) {
    const series = allSeries.find((s) => s.id === el.dataset.thumbSeries);
    if (!series) continue;
    const candidates = seriesPhotoCandidates(series, allObservations);
    if (!candidates.length) continue;
    void (async () => {
      for (const { img, obsId } of candidates) {
        const url = await getImageObjectUrl(img, obsId);
        if (!url) continue;
        el.innerHTML = '';
        const imgEl = document.createElement('img');
        imgEl.src = url;
        imgEl.alt = series.name;
        imgEl.loading = 'lazy';
        el.appendChild(imgEl);
        return;
      }
    })();
  }
}

/* ---------- series detail ---------- */

function linkedObservations(seriesId: string): Observation[] {
  const sorted = allObservations
    .filter((o) => o.seriesId === seriesId)
    .sort((a, b) => a.dateTime.localeCompare(b.dateTime));
  return obsSortDir === 'desc' ? sorted.reverse() : sorted;
}

function renderDetail(series: SeriesRow | undefined): string {
  if (!series) {
    return '<p class="hint">המעקב הזה נמחק או לא נמצא.</p>';
  }
  const now = new Date();
  const linked = linkedObservations(series.id);

  const infoCard = `
    <div class="stat-card series-detail-card">
      <div class="stat-card-head">
        <div class="series-detail-head-lead">
          <span class="series-detail-thumb" data-thumb-series="${series.id}">${icon('target')}</span>
          <h3><span class="series-status-badge series-status-${series.status}">${SERIES_STATUS_LABELS[series.status]}</span> ${escapeHtml(series.name)}</h3>
        </div>
      </div>
      ${series.species ? `<p class="series-detail-species">${icon('bird')} ${escapeHtml(series.species)}</p>` : ''}
      <p class="series-detail-day">${series.status === 'active' ? escapeHtml(seriesDayLabel(series, now)) : `התחיל ${escapeHtml(fmtDateOnly(series.startDate))}`}${series.expectedDurationDays && series.status !== 'active' ? ` · משך צפוי: ${series.expectedDurationDays} ימים` : ''}</p>
      ${series.notes ? `<p class="series-detail-notes">${escapeHtml(series.notes)}</p>` : ''}
      <div class="series-detail-actions">
        <div class="export-wrap">
          <button type="button" class="btn btn-sm btn-primary" id="series-add-obs-btn">${icon('plus')} הוספת תצפיות ▾</button>
          <div class="export-menu" id="series-add-obs-menu" hidden>
            <button type="button" id="series-add-obs-new">${icon('plus')} תצפית חדשה</button>
            <button type="button" id="series-add-obs-existing">${icon('link')} שיוך תצפיות קיימות</button>
          </div>
        </div>
        <div class="export-wrap">
          <button type="button" class="btn btn-sm btn-icon" id="series-more-btn" title="פעולות נוספות" aria-label="פעולות נוספות">⋯</button>
          <div class="export-menu" id="series-more-menu" hidden>
            <button type="button" id="series-detail-edit">${icon('edit')} עריכת מעקב</button>
            ${series.status !== 'active' ? `<button type="button" data-series-status="active">${icon('refresh')} החזרה לפעיל</button>` : ''}
            ${series.status !== 'completed' ? `<button type="button" data-series-status="completed">${icon('check')} סימון כהושלם</button>` : ''}
            ${series.status !== 'abandoned' ? `<button type="button" data-series-status="abandoned">✕ סימון כננטש</button>` : ''}
            <button type="button" id="series-detail-open-journal">${icon('journal')} פתיחה ביומן</button>
            <button type="button" id="series-detail-delete">${icon('trash')} מחיקת מעקב</button>
          </div>
        </div>
      </div>
    </div>`;

  const obsHtml = linked.length
    ? `
      <div class="series-detail-obs-head">
        <h3 class="series-detail-obs-title">${linked.length} תצפיות במעקב זה</h3>
        <button type="button" class="btn btn-icon" id="series-obs-sort-btn" title="היפוך סדר כרונולוגי" aria-label="היפוך סדר כרונולוגי">
          ${icon('sortArrows', obsSortDir === 'desc' ? 'icon-flip' : '')}
        </button>
      </div>
      <div class="series-detail-obs-list" id="series-detail-obs-list"></div>`
    : '<p class="hint">אין עדיין תצפיות משויכות למעקב זה — לחצו "הוספת תצפיות" כדי להוסיף תצפית חדשה או לשייך תצפיות קיימות.</p>';

  return infoCard + obsHtml;
}

/** Observation cards are DOM elements (not HTML strings), so they're
 * appended after the innerHTML write above — same two-step pattern used by
 * the journal feed itself (views/cards.ts). */
function mountObservationCards(): void {
  const wrap = container.querySelector<HTMLElement>('#series-detail-obs-list');
  if (!wrap || !detailId) return;
  for (const o of linkedObservations(detailId)) wrap.appendChild(renderObservationCard(o));
}

/* ---------- link existing observations ---------- */

/** Lets you attach observations already in the journal to this series
 * directly from its detail page, without opening the journal — the
 * complement to "תצפית חדשה" for building a series' history retroactively.
 * Only offers observations not already linked to any series (this one or
 * another) — an observation already tracked somewhere is never shown as a
 * candidate here; unlinking it first (bulk-edit in the journal, or the
 * "שיוך תצפיות קיימות" flow on its own series) is a separate, deliberate
 * action. Observations matching the series' own species are listed first. */
function openLinkExistingObservationsModal(series: SeriesRow): void {
  const candidates = allObservations
    .filter((o) => !o.seriesId)
    .sort((a, b) => {
      const am = series.species && speciesNames(a).includes(series.species) ? 0 : 1;
      const bm = series.species && speciesNames(b).includes(series.species) ? 0 : 1;
      return am !== bm ? am - bm : b.dateTime.localeCompare(a.dateTime);
    });
  const selected = new Set<string>();

  const wrap = document.createElement('div');
  wrap.className = 'series-modal series-link-obs-modal';
  const rowHtml = (o: Observation): string => `
    <label class="filter-modal-check series-link-obs-row">
      <input type="checkbox" class="series-link-obs-check" value="${o.id}">
      <span class="series-link-obs-summary">
        <strong>${escapeHtml(speciesLabel(o) || 'ללא מין')}</strong>
        <span class="hint">${escapeHtml(fmtDateTime(o.dateTime))}${o.locationName ? ` · ${escapeHtml(o.locationName)}` : ''}</span>
      </span>
    </label>`;
  wrap.innerHTML = `
    <h3>שיוך תצפיות קיימות</h3>
    <input type="search" id="series-link-obs-q" placeholder="חיפוש (מין, מיקום)..." class="filter-search">
    <div class="series-link-obs-list" id="series-link-obs-list">
      ${candidates.length ? candidates.map(rowHtml).join('') : '<p class="hint">אין תצפיות פנויות לשיוך — כל התצפיות ביומן כבר משויכות למעקב כלשהו.</p>'}
    </div>
    <div class="modal-actions">
      <button type="button" class="btn btn-sm btn-primary" id="series-link-obs-apply" disabled>שיוך תצפיות (<span id="series-link-obs-count">0</span>)</button>
      <button type="button" class="btn btn-sm" id="series-link-obs-cancel">ביטול</button>
    </div>`;
  const close = showModal(wrap);

  const applyBtn = wrap.querySelector<HTMLButtonElement>('#series-link-obs-apply')!;
  const countEl = wrap.querySelector('#series-link-obs-count')!;
  const updateCount = (): void => {
    countEl.textContent = String(selected.size);
    applyBtn.disabled = !selected.size;
  };
  wrap.querySelector('#series-link-obs-list')!.addEventListener('change', (e) => {
    const cb = (e.target as HTMLElement).closest<HTMLInputElement>('.series-link-obs-check');
    if (!cb) return;
    if (cb.checked) selected.add(cb.value); else selected.delete(cb.value);
    updateCount();
  });
  const searchInput = wrap.querySelector<HTMLInputElement>('#series-link-obs-q')!;
  searchInput.addEventListener('input', () => {
    const q = searchInput.value.trim().toLowerCase();
    wrap.querySelectorAll<HTMLElement>('.series-link-obs-row').forEach((row) => {
      row.hidden = !!q && !row.textContent!.toLowerCase().includes(q);
    });
  });
  wrap.querySelector('#series-link-obs-cancel')?.addEventListener('click', () => close());
  applyBtn.addEventListener('click', () => {
    void (async () => {
      let linked = 0;
      for (const id of selected) {
        const obs = await getObservation(id);
        if (!obs) continue;
        obs.seriesId = series.id;
        await saveObservation(obs);
        linked++;
      }
      close();
      allObservations = await listObservations();
      render();
      toast(`${linked} תצפיות שויכו למעקב ✓`);
    })();
  });
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

  if (target.closest('#series-obs-sort-btn')) { obsSortDir = obsSortDir === 'asc' ? 'desc' : 'asc'; render(); return; }

  if (target.closest('#series-add-obs-btn')) {
    e.stopPropagation();
    qs(container, '#series-add-obs-menu').hidden = !qs(container, '#series-add-obs-menu').hidden;
    const moreMenu = container.querySelector<HTMLElement>('#series-more-menu');
    if (moreMenu) moreMenu.hidden = true;
    return;
  }
  if (target.closest('#series-more-btn')) {
    e.stopPropagation();
    qs(container, '#series-more-menu').hidden = !qs(container, '#series-more-menu').hidden;
    const addMenu = container.querySelector<HTMLElement>('#series-add-obs-menu');
    if (addMenu) addMenu.hidden = true;
    return;
  }

  if (target.closest('#series-add-obs-new')) { navigate('form', { prefillSeriesId: series.id, species: series.species }); return; }
  if (target.closest('#series-add-obs-existing')) { openLinkExistingObservationsModal(series); return; }

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

  if (target.closest('#series-detail-delete')) {
    if (!(await confirmDialog(`למחוק את המעקב "${series.name}"? התצפיות המקושרות אליו יישארו, אך יאבדו את הקישור.`, 'מחיקת מעקב'))) return;
    await deleteSeries(series.id);
    toast('המעקב נמחק');
    navigate('series');
    return;
  }
}
