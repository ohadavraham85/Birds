/* lib/view-mode.ts — shared "how to browse this list" toggle (list / square
 * tiles / rectangular tiles), reused by the journal, species and table tabs
 * so all three offer the same switcher in the same place. */

import { icon } from './icons';
import { qs } from './dom';

export type ViewDisplayMode = 'list' | 'square' | 'rect' | 'table';

/** `includeTable` adds a 4th "spreadsheet" button — opt-in per view (only the
 * journal uses it so far) so species/table tabs keep their existing 3-mode
 * toggle unchanged. */
export function viewModeToggleHtml(id: string, opts: { includeTable?: boolean } = {}): string {
  return `
    <div class="view-mode-toggle" id="${id}">
      <button type="button" class="btn btn-icon" data-mode="list" title="תצוגת רשימה" aria-label="תצוגת רשימה">${icon('list')}</button>
      <button type="button" class="btn btn-icon" data-mode="square" title="תצוגת אריחים מרובעים" aria-label="תצוגת אריחים מרובעים">${icon('grid')}</button>
      <button type="button" class="btn btn-icon" data-mode="rect" title="תצוגת אריחים מלבניים" aria-label="תצוגת אריחים מלבניים">${icon('gridRect')}</button>
      ${opts.includeTable ? `<button type="button" class="btn btn-icon" data-mode="table" title="תצוגת גיליון טבלאי" aria-label="תצוגת גיליון טבלאי">${icon('table')}</button>` : ''}
    </div>`;
}

export function wireViewModeToggle(container: HTMLElement, id: string, onChange: (mode: ViewDisplayMode) => void): void {
  qs(container, `#${id}`).addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-mode]');
    if (btn) onChange(btn.dataset.mode as ViewDisplayMode);
  });
}

export function syncViewModeToggle(container: HTMLElement, id: string, mode: ViewDisplayMode): void {
  qs(container, `#${id}`).querySelectorAll<HTMLButtonElement>('button[data-mode]').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.mode === mode);
  });
}
