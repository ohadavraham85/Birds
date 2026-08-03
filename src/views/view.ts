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
  /** Clicking a tag badge anywhere jumps here, filtering to that one tag. */
  filterTag?: string;
  /** Drill-down from the stats tab: opens the journal's embedded calendar
   * view (see views/cards.ts) in year view, for this year. */
  year?: number;
  /** Drill-down from the home screen's stats tiles: pre-applies a date-range
   * filter (YYYY-MM-DD, inclusive) matching whichever range is currently
   * selected there ('' means no bound on that side). */
  filterFrom?: string;
  filterTo?: string;
  /** Drill-down from the home screen's "תגיות" tile: opens the journal grouped by tag. */
  groupBy?: 'day' | 'month' | 'location' | 'tag';
  /** From the home screen's draft-recovery banner: restore an auto-saved
   * in-progress new observation (fields + GPS track captured so far). */
  resumeDraft?: boolean;
  /** From the home screen's AI smart-voice observation flow: pre-fills
   * multiple species entries (each with its own quantity/note), replacing
   * the single-species `species` field above when present. */
  prefillEntries?: { species: string; quantity: number; note?: string }[];
  /** From the AI smart-voice flow: pre-selects these tag names (must already
   * exist — the form's tag picker doesn't auto-create from a prefill). */
  prefillTags?: string[];
  /** From the AI smart-voice flow: pre-fills the general notes field. */
  prefillNotes?: string;
  /** From the Gallery's "תצפית חדשה" action on an unassociated photo: the
   * media id to claim and attach as the first species row's photo. */
  prefillMediaId?: string;
}

export interface View {
  init(el: HTMLElement): void;
  activate(): void | Promise<void>;
  setParams?(params: ViewParams): void;
  /** Called right before navigation switches to a different view — lets a
   * view release anything that must not keep running once it's hidden (e.g.
   * form.ts stopping an in-progress GPS track recording). */
  deactivate?(): void;
}
