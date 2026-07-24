/* lib/ui.ts — shared UI helpers: toast, modal, formatting. */

import { icon } from './icons';

let toastTimer: ReturnType<typeof setTimeout> | undefined;

export function toast(msg: string, isError = false, ms = 3000): void {
  const t = document.getElementById('toast')!;
  t.textContent = msg;
  t.classList.toggle('error', isError);
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, ms);
}

/** Disables `btn` and swaps its label for a spinner + `busyLabel` while `fn`
 * runs (e.g. PDF generation, which can take a few seconds with nothing else
 * on screen to show it's working), restoring the original content and
 * enabled state afterward — even if `fn` throws. */
export async function withBusyButton<T>(btn: HTMLButtonElement, busyLabel: string, fn: () => Promise<T>): Promise<T> {
  const original = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = `${icon('refresh', 'spin')} ${busyLabel}`;
  try {
    return await fn();
  } finally {
    btn.disabled = false;
    btn.innerHTML = original;
  }
}

export function fmtDateTime(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleString('he-IL', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

export function fmtCoords(lat: number | null, lng: number | null): string {
  if (lat == null || lng == null) return '';
  return `${Number(lat).toFixed(5)}, ${Number(lng).toFixed(5)}`;
}

export function toLocalInputValue(date = new Date()): string {
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function fromLocalInputValue(v: string): string | null {
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d.toISOString();
}

export function showModal(content: HTMLElement): () => void {
  const root = document.getElementById('modal-root')!;
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  const box = document.createElement('div');
  box.className = 'modal';
  box.appendChild(content);
  backdrop.appendChild(box);
  const close = (): void => backdrop.remove();
  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(); });
  root.appendChild(backdrop);
  return close;
}

export function confirmDialog(message: string, confirmLabel = 'אישור'): Promise<boolean> {
  return new Promise((resolve) => {
    const wrap = document.createElement('div');
    const p = document.createElement('p');
    p.textContent = message;
    const actions = document.createElement('div');
    actions.className = 'modal-actions';
    const ok = document.createElement('button');
    ok.className = 'btn btn-danger';
    ok.textContent = confirmLabel;
    const cancel = document.createElement('button');
    cancel.className = 'btn';
    cancel.textContent = 'ביטול';
    actions.append(ok, cancel);
    wrap.append(p, actions);
    const close = showModal(wrap);
    ok.onclick = (): void => { close(); resolve(true); };
    cancel.onclick = (): void => { close(); resolve(false); };
  });
}

export function showImageModal(url: string, caption = ''): void {
  const wrap = document.createElement('div');
  const img = document.createElement('img');
  img.className = 'full';
  img.src = url;
  img.alt = caption;
  wrap.appendChild(img);
  if (caption) {
    const p = document.createElement('p');
    p.textContent = caption;
    wrap.appendChild(p);
  }
  showModal(wrap);
}
