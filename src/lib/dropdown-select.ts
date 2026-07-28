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
export function wireDropdown(btn: HTMLButtonElement, menu: HTMLElement): () => void {
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    menu.hidden = !menu.hidden;
    btn.setAttribute('aria-expanded', String(!menu.hidden));
  });
  const onOutsideClick = (e: MouseEvent): void => {
    if (!menu.hidden && !menu.contains(e.target as Node) && e.target !== btn) {
      menu.hidden = true;
      btn.setAttribute('aria-expanded', 'false');
    }
  };
  document.addEventListener('click', onOutsideClick);
  return () => document.removeEventListener('click', onOutsideClick);
}
