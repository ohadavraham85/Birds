/* views/view.ts — shared view contract. */

import type { AssetType, AssetStatus } from '../types';

export interface ViewParams {
  /** Editing an existing asset (form.ts). */
  editId?: string;
  /** Viewing an existing asset's detail screen. */
  viewId?: string;
  /** Pre-fills coordinates when opening a new asset from the map. */
  lat?: number;
  lng?: number;
  /** Drill-down filters applied when landing on the list view. */
  filterType?: AssetType;
  filterStatus?: AssetStatus;
}

export interface View {
  init(el: HTMLElement): void;
  activate(): void | Promise<void>;
  setParams?(params: ViewParams): void;
  /** Called right before navigation switches to a different view — lets a
   * view release anything that must not keep running once it's hidden (e.g.
   * map.ts stopping its GPS watch). */
  deactivate?(): void;
}
