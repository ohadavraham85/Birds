/* views/view.ts — shared view contract. */

export interface ViewParams {
  editId?: string;
  viewId?: string;
  species?: string;
  lat?: number;
  lng?: number;
  locationName?: string;
  /** Pre-fills the date (YYYY-MM-DD) when opening a new observation, e.g. from the calendar. */
  date?: string;
  /** Drill-down from the stats tab: pre-applies a single-value advanced filter in the journal. */
  filterSpecies?: string;
  filterLocation?: string;
  filterProject?: string;
  /** Drill-down from the stats tab: opens the calendar in year view for this year. */
  year?: number;
  /** Drill-down from the home screen's stats tiles: pre-applies a date-range
   * filter (YYYY-MM-DD, inclusive) matching whichever range is currently
   * selected there ('' means no bound on that side). */
  filterFrom?: string;
  filterTo?: string;
  /** Drill-down from the home screen's "פרויקטים" tile: opens the journal grouped by project. */
  groupBy?: 'day' | 'month' | 'location' | 'project';
}

export interface View {
  init(el: HTMLElement): void;
  activate(): void | Promise<void>;
  setParams?(params: ViewParams): void;
}
