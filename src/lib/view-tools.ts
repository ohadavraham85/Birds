/* lib/view-tools.ts — the phone-only ⋯ button next to a view's search box.
 * Everything in the view marked `.view-tool` folds away behind it (see the
 * compact phone layout at the end of app.css), so the top of the screen is
 * just the search. On a wide screen the button is hidden and every tool shows. */

export function toolsToggleHtml(id: string): string {
  return `<button type="button" class="btn btn-icon tools-toggle" id="${id}" title="אפשרויות תצוגה" aria-label="אפשרויות תצוגה" aria-expanded="false"><span aria-hidden="true">⋯</span></button>`;
}

export function wireToolsToggle(view: HTMLElement, id: string): void {
  const btn = view.querySelector<HTMLButtonElement>('#' + id);
  if (!btn) return;
  btn.addEventListener('click', () => {
    const open = view.classList.toggle('tools-open');
    btn.setAttribute('aria-expanded', String(open));
    btn.classList.toggle('active', open);
  });
}

/** Dot on ⋯ while a filter hidden behind it is narrowing the list, so a
 * shorter list never looks like missing data. */
export function markToolsFiltered(view: HTMLElement, id: string, filtered: boolean): void {
  view.querySelector('#' + id)?.classList.toggle('has-filter', filtered);
}
