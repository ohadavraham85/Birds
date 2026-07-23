/* lib/combo.ts — generic autocomplete combobox, shared by the observation
 * form and any other view that needs a text input with filterable
 * suggestions (e.g. the table view's bulk-edit modal). */

import { escapeHtml } from './markdown';

export interface ComboOptions {
  /** 'prefix' matches only names starting with the typed text; default is substring-anywhere. */
  matchMode?: 'contains' | 'prefix';
  /** Suggestions shown when the field is empty (e.g. previously-seen species), if different from the full list. */
  getDefault?: () => string[];
  /** Fired when a suggestion is picked (click or Enter) — not on free typing. */
  onSelect?: (value: string) => void;
}

export function wireCombo(inp: HTMLInputElement, list: HTMLElement, getSuggestions: () => string[], opts: ComboOptions = {}): void {
  const toggle = inp.closest('.combo')?.querySelector<HTMLButtonElement>('.combo-toggle');
  const matchMode = opts.matchMode ?? 'contains';
  let hlIndex = -1;
  const highlight = (s: string, q: string): string => {
    const esc = escapeHtml(s);
    return q ? esc.replaceAll(escapeHtml(q), `<mark>${escapeHtml(q)}</mark>`) : esc;
  };
  const render = (showAll = false): void => {
    const q = inp.value.trim();
    let matches: string[];
    if (showAll) matches = getSuggestions();
    else if (!q) matches = opts.getDefault ? opts.getDefault() : getSuggestions();
    else matches = getSuggestions().filter((s) => (matchMode === 'prefix' ? s.startsWith(q) : s.includes(q)));
    matches = matches.slice(0, 60);
    hlIndex = -1;
    if (!matches.length) { list.hidden = true; return; }
    list.innerHTML = matches
      .map((s) => `<button type="button" data-name="${escapeHtml(s)}">${highlight(s, showAll ? '' : q)}</button>`)
      .join('');
    list.hidden = false;
  };
  inp.addEventListener('focus', () => render());
  inp.addEventListener('input', () => render());
  inp.addEventListener('keydown', (e) => {
    const items = Array.from(list.querySelectorAll<HTMLButtonElement>('button'));
    if ((e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      if (list.hidden || !items.length) { render(); if (list.hidden) return; }
      e.preventDefault();
      hlIndex = e.key === 'ArrowDown' ? Math.min(hlIndex + 1, items.length - 1) : Math.max(hlIndex - 1, 0);
      items.forEach((btn, i) => btn.classList.toggle('hl', i === hlIndex));
      items[hlIndex]?.scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter' && !list.hidden && hlIndex >= 0) {
      e.preventDefault();
      inp.value = items[hlIndex]!.dataset.name!;
      list.hidden = true;
      opts.onSelect?.(inp.value);
    } else if (e.key === 'Escape') { list.hidden = true; }
  });
  list.addEventListener('mousedown', (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-name]');
    if (btn) {
      e.preventDefault();
      inp.value = btn.dataset.name!;
      list.hidden = true;
      opts.onSelect?.(inp.value);
    }
  });
  toggle?.addEventListener('mousedown', (e) => {
    e.preventDefault();
    if (list.hidden) { inp.focus(); render(true); } else { list.hidden = true; }
  });
  inp.addEventListener('blur', () => setTimeout(() => { list.hidden = true; }, 150));
}
