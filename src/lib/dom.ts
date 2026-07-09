/* lib/dom.ts — tiny type-safe DOM helpers. */

export function qs<T extends Element = HTMLElement>(root: ParentNode, sel: string): T {
  const el = root.querySelector<T>(sel);
  if (!el) throw new Error('missing element: ' + sel);
  return el;
}

export function qsa<T extends Element = HTMLElement>(root: ParentNode, sel: string): T[] {
  return Array.from(root.querySelectorAll<T>(sel));
}

export function input(root: ParentNode, sel: string): HTMLInputElement {
  return qs<HTMLInputElement>(root, sel);
}

export function select(root: ParentNode, sel: string): HTMLSelectElement {
  return qs<HTMLSelectElement>(root, sel);
}
