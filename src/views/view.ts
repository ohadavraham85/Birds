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
}

export interface View {
  init(el: HTMLElement): void;
  activate(): void | Promise<void>;
  setParams?(params: ViewParams): void;
}
