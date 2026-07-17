/* views/view.ts — shared view contract. */

export interface ViewParams {
  editId?: string;
  viewId?: string;
  species?: string;
  lat?: number;
  lng?: number;
  locationName?: string;
}

export interface View {
  init(el: HTMLElement): void;
  activate(): void | Promise<void>;
  setParams?(params: ViewParams): void;
}
