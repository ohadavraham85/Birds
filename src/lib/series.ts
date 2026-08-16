/* lib/series.ts — shared day-counter math for "מעקב" (a generic tracking
 * series, e.g. nesting/migration/molting): how many days have elapsed since
 * it started, and — if an expected duration is known — how many remain or
 * are overdue. Used by both the observation form (counts against that
 * observation's own date) and the home screen's active-series widget
 * (counts against "now"). */

import type { SeriesRow } from '../types';

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
