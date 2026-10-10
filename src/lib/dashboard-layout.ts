/* lib/dashboard-layout.ts — user-arrangeable dashboard widgets for the Home
 * screen: on a desktop-width screen each widget can be dragged to a new
 * spot (grip at its top) and resized (handle at its bottom corner, snapping
 * to a 12-column grid). The order and widths are saved per device. On a
 * phone the grid collapses to one column and the handles are hidden, so the
 * layout there is unchanged. */

import { getSetting, setSetting } from '../db/repository';
import { escapeHtml } from './markdown';

export const DASH_COLUMNS = 12;
const MIN_SPAN = 3;
const SETTING_KEY = 'dashboardLayout';

export interface DashLayout {
  order: string[];
  spans: Record<string, number>;
}

export interface DashWidget {
  id: string;
  title: string;
  html: string;
  defaultSpan: number;
}

let layout: DashLayout = { order: [], spans: {} };

export async function loadDashLayout(): Promise<void> {
  layout = await getSetting<DashLayout>(SETTING_KEY, { order: [], spans: {} });
}

export async function resetDashLayout(): Promise<void> {
  layout = { order: [], spans: {} };
  await setSetting(SETTING_KEY, layout);
}

function persist(): void {
  void setSetting(SETTING_KEY, layout);
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
        return `
        <section class="dash-widget" data-widget="${escapeHtml(w.id)}" style="--span:${span}">
          <button type="button" class="dash-drag" title="גרירה להזזת ${escapeHtml(w.title)}" aria-label="הזזת ${escapeHtml(w.title)}">⠿</button>
          ${w.html}
          <span class="dash-resize" title="גרירה לשינוי גודל" aria-hidden="true"></span>
        </section>`;
      }).join('')}
    </div>`;
}

function clampSpan(n: number): number {
  return Math.max(MIN_SPAN, Math.min(DASH_COLUMNS, Math.round(n)));
}

/** Drag-to-move and drag-to-resize, via pointer events on the handles.
 * Move/up are tracked on the window rather than with pointer capture on the
 * handle: moving the widget within the grid detaches the handle from the
 * document for an instant, which silently drops any capture it held.
 * Call once per render of the grid (handlers live on the grid element, which
 * is replaced on every render, so nothing leaks). */
export function wireDashGrid(root: ParentNode): void {
  const grid = root.querySelector<HTMLElement>('#dash-grid');
  if (!grid) return;
  grid.addEventListener('pointerdown', (e) => {
    const target = e.target as HTMLElement;
    const widget = target.closest<HTMLElement>('.dash-widget');
    if (!widget || e.button !== 0) return;
    if (target.closest('.dash-drag')) startMove(grid, widget, e);
    else if (target.closest('.dash-resize')) startResize(grid, widget, e);
  });
}

function saveFromDom(grid: HTMLElement): void {
  const domOrder = Array.from(grid.querySelectorAll<HTMLElement>('.dash-widget')).map((w) => w.dataset.widget!);
  // Keep widgets that aren't on screen right now (empty) at their old slot.
  const hidden = layout.order.filter((id) => !domOrder.includes(id));
  layout.order = [...domOrder, ...hidden];
  persist();
}

function startMove(grid: HTMLElement, widget: HTMLElement, e: PointerEvent): void {
  e.preventDefault();
  widget.classList.add('dash-dragging');
  grid.classList.add('dash-grid-active');

  const onMove = (ev: PointerEvent): void => {
    widget.style.pointerEvents = 'none';
    const over = document.elementFromPoint(ev.clientX, ev.clientY)?.closest<HTMLElement>('.dash-widget');
    widget.style.pointerEvents = '';
    if (!over || over === widget || !grid.contains(over)) return;
    const r = over.getBoundingClientRect();
    const fullWidth = r.width > grid.clientWidth * 0.75;
    // RTL: the right half of a side-by-side widget comes first.
    const before = fullWidth ? ev.clientY < r.top + r.height / 2 : ev.clientX > r.left + r.width / 2;
    if (before) { if (over.previousElementSibling !== widget) grid.insertBefore(widget, over); }
    else if (over.nextElementSibling !== widget) grid.insertBefore(widget, over.nextElementSibling);
  };
  const onUp = (): void => {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', onUp);
    widget.classList.remove('dash-dragging');
    grid.classList.remove('dash-grid-active');
    saveFromDom(grid);
  };
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
  window.addEventListener('pointercancel', onUp);
}

function startResize(grid: HTMLElement, widget: HTMLElement, e: PointerEvent): void {
  e.preventDefault();
  const startX = e.clientX;
  const startWidth = widget.getBoundingClientRect().width;
  const gap = parseFloat(getComputedStyle(grid).columnGap) || 0;
  const colWidth = (grid.clientWidth - gap * (DASH_COLUMNS - 1)) / DASH_COLUMNS;
  widget.classList.add('dash-resizing');

  const onMove = (ev: PointerEvent): void => {
    // RTL: widgets are anchored on their right edge, so dragging the
    // (left-corner) handle further left makes them wider.
    const width = startWidth + (startX - ev.clientX);
    const span = clampSpan((width + gap) / (colWidth + gap));
    widget.style.setProperty('--span', String(span));
    widget.dataset.spanLabel = `${span}/${DASH_COLUMNS}`;
  };
  const onUp = (): void => {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', onUp);
    widget.classList.remove('dash-resizing');
    delete widget.dataset.spanLabel;
    layout.spans[widget.dataset.widget!] = Number(widget.style.getPropertyValue('--span'));
    saveFromDom(grid);
    // Charts that size themselves from their container's width redraw on resize.
    window.dispatchEvent(new Event('resize'));
  };
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
  window.addEventListener('pointercancel', onUp);
}
