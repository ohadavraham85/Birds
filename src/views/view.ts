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
}

export interface View {
  init(el: HTMLElement): void;
  activate(): void | Promise<void>;
  setParams?(params: ViewParams): void;
}
