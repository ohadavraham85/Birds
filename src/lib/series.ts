/* lib/series.ts — shared day-counter math for "מעקב" (a generic tracking
 * series, e.g. nesting/migration/molting): how many days have elapsed since
 * it started, and — if an expected duration is known — how many remain or
 * are overdue. Used by both the observation form (counts against that
 * observation's own date) and the home screen's active-series widget
 * (counts against "now"). */

import { saveSeries } from '../db/repository';
import { escapeHtml } from './markdown';
import { showModal, toast } from './ui';
import { input } from './dom';
import { entriesOf, entryImages } from './observation';
import type { SeriesRow, Observation, ObservationImage } from '../types';

const DAY_MS = 86400000;

/** Elapsed days since the series started, counting the start date itself as
 * day 1 (so "started today" reads as day 1, not day 0). Compares calendar
 * dates only, ignoring time-of-day. Can be zero or negative if `asOf` is
 * before the start date. */
export function seriesDayNumber(series: Pick<SeriesRow, 'startDate'>, asOf: Date = new Date()): number {
  const start = new Date(series.startDate.slice(0, 10));
  const at = new Date(asOf.toISOString().slice(0, 10));
  return Math.round((at.getTime() - start.getTime()) / DAY_MS) + 1;
}

/** "יום 5" if no expected duration is set, otherwise "יום 5 מתוך 14 — נותרו
 * 9 ימים" (or "— באיחור 2 ימים" once the day count runs past it). */
export function seriesDayLabel(series: Pick<SeriesRow, 'startDate' | 'expectedDurationDays'>, asOf: Date = new Date()): string {
  const day = seriesDayNumber(series, asOf);
  const dayPart = `יום ${day}`;
  if (!series.expectedDurationDays) return dayPart;
  const remaining = series.expectedDurationDays - day;
  if (remaining >= 0) return `${dayPart} מתוך ${series.expectedDurationDays} — נותרו ${remaining} ימים`;
  return `${dayPart} מתוך ${series.expectedDurationDays} — באיחור ${-remaining} ימים`;
}

/** True once an active series has run past its own expected duration. */
export function isSeriesOverdue(series: Pick<SeriesRow, 'startDate' | 'expectedDurationDays' | 'status'>, asOf: Date = new Date()): boolean {
  if (series.status !== 'active' || !series.expectedDurationDays) return false;
  return seriesDayNumber(series, asOf) > series.expectedDurationDays;
}

export const SERIES_STATUS_LABELS: Record<SeriesRow['status'], string> = {
  active: 'פעיל', completed: 'הושלם', abandoned: 'ננטש',
};

/** Every photo attached to any observation linked to this series, most
 * recent observation first — used as the cover thumbnail everywhere a
 * series is shown as a row (library list, home widget). Returns candidates
 * rather than a single pick since a photo's blob can be missing locally
 * (still downloading, or never synced); the caller tries each in order via
 * `getImageObjectUrl` until one actually resolves, same pattern as the
 * species tiles' own thumbnail fallback (views/species.ts). */
export function seriesPhotoCandidates(series: Pick<SeriesRow, 'id'>, observations: Observation[]): { img: ObservationImage; obsId: string }[] {
  const linked = observations
    .filter((o) => o.seriesId === series.id)
    .sort((a, b) => b.dateTime.localeCompare(a.dateTime));
  const candidates: { img: ObservationImage; obsId: string }[] = [];
  for (const o of linked) {
    for (const entry of entriesOf(o)) {
      for (const img of entryImages(entry)) candidates.push({ img, obsId: o.id });
    }
  }
  return candidates;
}

export interface CreateSeriesDefaults {
  species?: string;
  /** YYYY-MM-DD */
  startDate?: string;
  expectedDurationDays?: number;
}

/** The "מעקב חדש" modal — shared by every place a new series can be created
 * (the home screen's library/widget, the observation form's link-picker) so
 * the fields/behavior stay identical everywhere. Saves the series itself
 * (status 'active') and resolves it, or resolves null if cancelled —
 * callers decide what to do with the result (link it, refresh a list, etc). */
export function openCreateSeriesModal(speciesList: string[], defaults: CreateSeriesDefaults = {}): Promise<SeriesRow | null> {
  return new Promise((resolve) => {
    const defaultStart = defaults.startDate || new Date().toISOString().slice(0, 10);
    const wrap = document.createElement('div');
    wrap.className = 'series-modal';
    wrap.innerHTML = `
      <h3>מעקב חדש</h3>
      <div class="field">
        <label for="series-name">שם המעקב</label>
        <input type="text" id="series-name" value="${escapeHtml(defaults.species ? `קינון — ${defaults.species}` : '')}" placeholder="לדוגמה: קינון בול״ץ 2026">
      </div>
      <div class="field">
        <label for="series-species">מין (לא חובה)</label>
        <input type="text" id="series-species" value="${escapeHtml(defaults.species || '')}" list="series-species-datalist">
        <datalist id="series-species-datalist">${speciesList.map((s) => `<option value="${escapeHtml(s)}">`).join('')}</datalist>
      </div>
      <div class="field-row two-up">
        <div class="field">
          <label for="series-start">תאריך התחלה</label>
          <input type="date" id="series-start" value="${defaultStart}">
        </div>
        <div class="field">
          <label for="series-duration">משך צפוי (ימים)</label>
          <input type="number" id="series-duration" min="1" value="${defaults.expectedDurationDays ?? ''}">
        </div>
      </div>
      <div class="modal-actions">
        <button type="button" class="btn btn-sm btn-primary" id="series-create-save">יצירה</button>
        <button type="button" class="btn btn-sm" id="series-create-cancel">ביטול</button>
      </div>`;
    const close = showModal(wrap);
    input(wrap, '#series-name').focus();
    let settled = false;
    const finish = (row: SeriesRow | null): void => { if (settled) return; settled = true; resolve(row); };
    wrap.querySelector('#series-create-cancel')?.addEventListener('click', () => { close(); finish(null); });
    wrap.querySelector('#series-create-save')?.addEventListener('click', () => {
      const name = input(wrap, '#series-name').value.trim();
      if (!name) { toast('יש להזין שם למעקב', true); return; }
      const species = input(wrap, '#series-species').value.trim();
      const startDate = input(wrap, '#series-start').value || defaultStart;
      const durationRaw = input(wrap, '#series-duration').value.trim();
      const expectedDurationDays = durationRaw ? Math.max(1, parseInt(durationRaw, 10)) : undefined;
      void (async () => {
        const row: SeriesRow = {
          id: crypto.randomUUID(), name, status: 'active', updatedAt: '',
          ...(species ? { species } : {}),
          startDate: new Date(startDate).toISOString(),
          ...(expectedDurationDays ? { expectedDurationDays } : {}),
        };
        await saveSeries(row);
        close();
        toast(`המעקב "${name}" נוצר ✓`);
        finish(row);
      })();
    });
  });
}

/** Edits an existing series' fields in place (name/species/start
 * date/expected duration/notes) — used by the series library's detail
 * screen. Resolves the updated row, or null if cancelled. */
export function openEditSeriesModal(series: SeriesRow, speciesList: string[]): Promise<SeriesRow | null> {
  return new Promise((resolve) => {
    const wrap = document.createElement('div');
    wrap.className = 'series-modal';
    wrap.innerHTML = `
      <h3>עריכת מעקב</h3>
      <div class="field">
        <label for="series-name">שם המעקב</label>
        <input type="text" id="series-name" value="${escapeHtml(series.name)}">
      </div>
      <div class="field">
        <label for="series-species">מין (לא חובה)</label>
        <input type="text" id="series-species" value="${escapeHtml(series.species || '')}" list="series-species-datalist">
        <datalist id="series-species-datalist">${speciesList.map((s) => `<option value="${escapeHtml(s)}">`).join('')}</datalist>
      </div>
      <div class="field-row two-up">
        <div class="field">
          <label for="series-start">תאריך התחלה</label>
          <input type="date" id="series-start" value="${series.startDate.slice(0, 10)}">
        </div>
        <div class="field">
          <label for="series-duration">משך צפוי (ימים)</label>
          <input type="number" id="series-duration" min="1" value="${series.expectedDurationDays ?? ''}">
        </div>
      </div>
      <div class="field">
        <label for="series-notes">הערות</label>
        <textarea id="series-notes" rows="2">${escapeHtml(series.notes || '')}</textarea>
      </div>
      <div class="modal-actions">
        <button type="button" class="btn btn-sm btn-primary" id="series-edit-save">שמירה</button>
        <button type="button" class="btn btn-sm" id="series-edit-cancel">ביטול</button>
      </div>`;
    const close = showModal(wrap);
    input(wrap, '#series-name').focus();
    let settled = false;
    const finish = (row: SeriesRow | null): void => { if (settled) return; settled = true; resolve(row); };
    wrap.querySelector('#series-edit-cancel')?.addEventListener('click', () => { close(); finish(null); });
    wrap.querySelector('#series-edit-save')?.addEventListener('click', () => {
      const name = input(wrap, '#series-name').value.trim();
      if (!name) { toast('יש להזין שם למעקב', true); return; }
      const species = input(wrap, '#series-species').value.trim();
      const startDate = input(wrap, '#series-start').value || series.startDate.slice(0, 10);
      const durationRaw = input(wrap, '#series-duration').value.trim();
      const expectedDurationDays = durationRaw ? Math.max(1, parseInt(durationRaw, 10)) : undefined;
      const notes = wrap.querySelector<HTMLTextAreaElement>('#series-notes')!.value.trim();
      void (async () => {
        const updated: SeriesRow = {
          ...series, name,
          startDate: new Date(startDate).toISOString(),
          species: species || undefined,
          expectedDurationDays,
          notes: notes || undefined,
        };
        await saveSeries(updated);
        close();
        toast(`המעקב "${name}" עודכן ✓`);
        finish(updated);
      })();
    });
  });
}
