/* lib/dashboard-layout.ts — user-arrangeable dashboard widgets for the Home
 * screen. On a desktop-width screen the widgets sit in a 12-column grid
 * made of small fixed-height rows, packed densely (masonry-style) so
 * widgets of different heights don't leave holes:
 *  - drag the grip at a widget's top to move it — the widget follows the
 *    mouse and a dashed placeholder shows where it will land;
 *  - drag the bottom corner to resize it in both width (snapping to
 *    columns) and height (double-click the corner to go back to fitting
 *    its content).
 * Order and sizes are saved per device. On a phone the grid collapses to
 * one column and the handles are hidden, so the layout there is unchanged. */

import { getSetting, setSetting } from '../db/repository';
import { escapeHtml } from './markdown';

export const DASH_COLUMNS = 12;
const MIN_SPAN = 3;
/** Height of one grid row in px — widget heights snap to multiples of it. */
const ROW_PX = 8;
/** Vertical space left under each widget (the grid itself has no row gap). */
const GAP_PX = 16;
const MIN_ROWS = 10;
const SETTING_KEY = 'dashboardLayout';

export interface DashLayout {
  order: string[];
  spans: Record<string, number>;
  /** Explicit heights (in grid rows) — absent means "fit the content". */
  rows?: Record<string, number>;
}

export interface DashWidget {
  id: string;
  title: string;
  html: string;
  defaultSpan: number;
}

let layout: DashLayout = { order: [], spans: {}, rows: {} };
let resizeObserver: ResizeObserver | null = null;

export async function loadDashLayout(): Promise<void> {
  layout = await getSetting<DashLayout>(SETTING_KEY, { order: [], spans: {}, rows: {} });
  layout.rows ??= {};
}

export async function resetDashLayout(): Promise<void> {
  layout = { order: [], spans: {}, rows: {} };
  await setSetting(SETTING_KEY, layout);
}

function persist(): void {
  void setSetting(SETTING_KEY, layout);
}

function clampSpan(n: number): number {
  return Math.max(MIN_SPAN, Math.min(DASH_COLUMNS, Math.round(n)));
}

/** Widgets in the saved order — any widget the saved layout doesn't know
 * yet (newly added to the app) keeps its default position relative to the
 * ones around it. Empty widgets (nothing to show right now) are skipped. */
export function dashGridHtml(widgets: DashWidget[]): string {
  const rank = (id: string, fallback: number): number => {
    const i = layout.order.indexOf(id);
    return i === -1 ? fallback - 0.5 : i;
  };
  const sorted = widgets
    .map((w, i) => ({ w, r: rank(w.id, i) }))
    .sort((a, b) => a.r - b.r)
    .map(({ w }) => w)
    .filter((w) => w.html.trim());
  return `
    <div class="dash-grid" id="dash-grid">
      ${sorted.map((w) => {
        const span = clampSpan(layout.spans[w.id] ?? w.defaultSpan);
        const rows = layout.rows?.[w.id];
        return `
        <section class="dash-widget${rows ? ' dash-fixed-height' : ''}" data-widget="${escapeHtml(w.id)}" style="--span:${span};${rows ? `--rows:${rows}` : ''}">
          <button type="button" class="dash-drag" title="גרירה להזזת ${escapeHtml(w.title)}" aria-label="הזזת ${escapeHtml(w.title)}">⠿</button>
          <div class="dash-content">${w.html}</div>
          <span class="dash-resize" title="גרירה לשינוי גודל · לחיצה כפולה מחזירה לגובה התוכן" aria-hidden="true"></span>
        </section>`;
      }).join('')}
    </div>`;
}

function isGridMode(grid: HTMLElement): boolean {
  return getComputedStyle(grid).display === 'grid';
}

/** Rows a widget needs to show all its content (plus the gap under it). */
function contentRows(widget: HTMLElement): number {
  const content = widget.querySelector<HTMLElement>('.dash-content')!;
  return Math.max(MIN_ROWS, Math.ceil((content.scrollHeight + GAP_PX) / ROW_PX));
}

/** Sizes every content-fitting widget to its content's height. Fixed-height
 * widgets keep their saved row count (their content scrolls inside). */
function fitRows(grid: HTMLElement): void {
  if (!isGridMode(grid)) return;
  grid.querySelectorAll<HTMLElement>('.dash-widget:not(.dash-fixed-height)').forEach((w) => {
    w.style.setProperty('--rows', String(contentRows(w)));
  });
}

/** Drag-to-move and drag-to-resize, via pointer events on the handles.
 * Move/up are tracked on the window rather than with pointer capture on the
 * handle: moving elements within the grid detaches nodes from the document
 * for an instant, which silently drops any capture they held. Call once per
 * render of the grid. */
export function wireDashGrid(root: ParentNode): void {
  const grid = root.querySelector<HTMLElement>('#dash-grid');
  if (!grid) return;

  // Content can change height after render (images loading, charts
  // redrawing, window width changing) — keep each auto-height widget's row
  // span in step with it.
  resizeObserver?.disconnect();
  resizeObserver = new ResizeObserver(() => fitRows(grid));
  grid.querySelectorAll('.dash-content').forEach((c) => resizeObserver!.observe(c));
  resizeObserver.observe(grid);
  fitRows(grid);

  grid.addEventListener('pointerdown', (e) => {
    const target = e.target as HTMLElement;
    const widget = target.closest<HTMLElement>('.dash-widget');
    if (!widget || e.button !== 0 || !isGridMode(grid)) return;
    if (target.closest('.dash-drag')) startMove(grid, widget, e);
    else if (target.closest('.dash-resize')) startResize(grid, widget, e);
  });
  grid.addEventListener('dblclick', (e) => {
    const handle = (e.target as HTMLElement).closest('.dash-resize');
    const widget = handle?.closest<HTMLElement>('.dash-widget');
    if (!widget) return;
    delete layout.rows![widget.dataset.widget!];
    widget.classList.remove('dash-fixed-height');
    fitRows(grid);
    persist();
  });
}

function saveOrder(grid: HTMLElement): void {
  const domOrder = Array.from(grid.querySelectorAll<HTMLElement>('.dash-widget')).map((w) => w.dataset.widget!);
  // Keep widgets that aren't on screen right now (empty) at their old slot.
  const hidden = layout.order.filter((id) => !domOrder.includes(id));
  layout.order = [...domOrder, ...hidden];
  persist();
}

function onDrag(move: (ev: PointerEvent) => void, end: () => void): void {
  const up = (): void => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    window.removeEventListener('pointercancel', up);
    end();
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
  window.addEventListener('pointercancel', up);
}

function startMove(grid: HTMLElement, widget: HTMLElement, e: PointerEvent): void {
  e.preventDefault();
  const rect = widget.getBoundingClientRect();
  const offsetX = e.clientX - rect.left;
  const offsetY = e.clientY - rect.top;

  // A dashed slot the same size as the widget, standing in its grid cell —
  // it's what moves around the grid while the widget itself floats with
  // the mouse, so you always see exactly where it will land.
  const placeholder = document.createElement('div');
  placeholder.className = 'dash-placeholder';
  placeholder.style.setProperty('--span', widget.style.getPropertyValue('--span'));
  placeholder.style.setProperty('--rows', widget.style.getPropertyValue('--rows'));
  grid.insertBefore(placeholder, widget);

  Object.assign(widget.style, {
    position: 'fixed', left: `${rect.left}px`, top: `${rect.top}px`,
    width: `${rect.width}px`, height: `${rect.height}px`, zIndex: '1000',
  });
  widget.classList.add('dash-floating');
  grid.classList.add('dash-grid-active');

  onDrag((ev) => {
    widget.style.left = `${ev.clientX - offsetX}px`;
    widget.style.top = `${ev.clientY - offsetY}px`;
    const hit = document.elementFromPoint(ev.clientX, ev.clientY);
    const over = hit?.closest<HTMLElement>('.dash-widget, .dash-placeholder');
    if (over && over !== placeholder && grid.contains(over)) {
      const r = over.getBoundingClientRect();
      const fullWidth = r.width > grid.clientWidth * 0.75;
      // RTL: the right half of a side-by-side widget comes first.
      const before = fullWidth ? ev.clientY < r.top + r.height / 2 : ev.clientX > r.left + r.width / 2;
      if (before) { if (over.previousElementSibling !== placeholder) grid.insertBefore(placeholder, over); }
      else if (over.nextElementSibling !== placeholder) grid.insertBefore(placeholder, over.nextElementSibling);
    } else if (hit === grid || (hit && !grid.contains(hit) && ev.clientY > grid.getBoundingClientRect().bottom)) {
      // Past the last widget — drop at the end.
      if (grid.lastElementChild !== placeholder) grid.appendChild(placeholder);
    }
  }, () => {
    grid.insertBefore(widget, placeholder);
    placeholder.remove();
    for (const p of ['position', 'left', 'top', 'width', 'height', 'zIndex'] as const) widget.style[p] = '';
    widget.classList.remove('dash-floating');
    grid.classList.remove('dash-grid-active');
    saveOrder(grid);
  });
}

function startResize(grid: HTMLElement, widget: HTMLElement, e: PointerEvent): void {
  e.preventDefault();
  const startX = e.clientX;
  const startY = e.clientY;
  const startRect = widget.getBoundingClientRect();
  const gap = parseFloat(getComputedStyle(grid).columnGap) || 0;
  const colWidth = (grid.clientWidth - gap * (DASH_COLUMNS - 1)) / DASH_COLUMNS;
  const id = widget.dataset.widget!;
  widget.classList.add('dash-resizing', 'dash-fixed-height');
  grid.classList.add('dash-grid-active');

  onDrag((ev) => {
    // RTL: widgets are anchored on their right edge, so dragging the
    // (left-corner) handle further left makes them wider.
    const width = startRect.width + (startX - ev.clientX);
    const span = clampSpan((width + gap) / (colWidth + gap));
    const rows = Math.max(MIN_ROWS, Math.round((startRect.height + (ev.clientY - startY)) / ROW_PX));
    widget.style.setProperty('--span', String(span));
    widget.style.setProperty('--rows', String(rows));
    widget.dataset.sizeLabel = `${span}/${DASH_COLUMNS} · ${rows * ROW_PX - GAP_PX}px`;
  }, () => {
    widget.classList.remove('dash-resizing');
    grid.classList.remove('dash-grid-active');
    delete widget.dataset.sizeLabel;
    layout.spans[id] = Number(widget.style.getPropertyValue('--span'));
    layout.rows![id] = Number(widget.style.getPropertyValue('--rows'));
    fitRows(grid);
    saveOrder(grid);
  });
}
