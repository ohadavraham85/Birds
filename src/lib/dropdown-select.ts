/* lib/dropdown-select.ts — a compact toggle-button + checklist-panel
 * control: click the button to reveal a hidden panel (e.g. tag/observer
 * checkboxes), click outside to close it again. Used wherever showing every
 * option inline would crowd the surrounding UI — the bulk-edit modal and the
 * observation form's tags/observers pickers. */

/** Wires the open/close behavior. Returns a cleanup function that removes
 * the document-level outside-click listener — call it when the panel that
 * hosts `btn`/`menu` is torn down (e.g. a modal closing), so repeat opens
 * don't leak listeners. Views that are only ever initialized once (like the
 * observation form) can safely ignore the return value. */
/** `onToggle`, when given, fires with the panel's new open/closed state on
 * every change this function itself drives (button click, outside click) —
 * used e.g. by the observation form's per-species menu to temporarily lift
 * that row above its own stacking context (see `.sp-menu-open` in
 * app.css), since a row further down the list would otherwise always paint
 * over an open dropdown from a row above it. Doesn't fire for a close driven
 * from outside this module (e.g. a caller setting `menu.hidden` directly) —
 * callers doing that should also update whatever `onToggle` would have. */
export function wireDropdown(btn: HTMLButtonElement, menu: HTMLElement, onToggle?: (open: boolean) => void): () => void {
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    menu.hidden = !menu.hidden;
    btn.setAttribute('aria-expanded', String(!menu.hidden));
    onToggle?.(!menu.hidden);
  });
  const onOutsideClick = (e: MouseEvent): void => {
    if (!menu.hidden && !menu.contains(e.target as Node) && e.target !== btn) {
      menu.hidden = true;
      btn.setAttribute('aria-expanded', 'false');
      onToggle?.(false);
    }
  };
  document.addEventListener('click', onOutsideClick);
  return () => document.removeEventListener('click', onOutsideClick);
}
