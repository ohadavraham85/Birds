/* views/view.ts — shared view contract. */

export interface ViewParams {
  editId?: string;
  species?: string;
}

export interface View {
  init(el: HTMLElement): void;
  activate(): void | Promise<void>;
  setParams?(params: ViewParams): void;
}
