/* lib/swipe-actions.ts — wraps a journal row so a horizontal drag reveals
 * exactly one action, chosen by direction: dragging the card to the right
 * uncovers an "עריכה" (edit, blue) button at the row's left edge; dragging
 * it to the left uncovers a "מחיקה" (delete, red) button at the right edge.
 * A drag below a small pixel threshold is treated as a plain tap and
 * forwarded to onTap instead. Only one row's actions stay revealed at a
 * time — starting a new drag, or tapping anywhere else, closes any other
 * open row first. Pointer Events unify mouse and touch so the same code
 * drives both. */

import { icon } from './icons';

const OPEN_PX = 84;
const TAP_THRESHOLD = 8;

let openWrapper: HTMLElement | null = null;

function closeOpen(except?: HTMLElement): void {
  if (openWrapper && openWrapper !== except) {
    const front = openWrapper.querySelector<HTMLElement>('.swipe-front');
    if (front) front.style.transform = 'translateX(0)';
    openWrapper.classList.remove('swipe-open-edit', 'swipe-open-delete');
    openWrapper = null;
  }
}

export interface SwipeActionHandlers {
  onEdit: () => void;
  onDelete: () => void;
  /** Receives the originating event so callers can still special-case nested
   * interactive elements (e.g. a link that should follow its own href). */
  onTap?: (e: Event) => void;
}

export function wrapSwipeActions(card: HTMLElement, handlers: SwipeActionHandlers): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'swipe-item';

  const editAction = document.createElement('button');
  editAction.type = 'button';
  editAction.className = 'swipe-action swipe-action-edit';
  editAction.innerHTML = `${icon('edit')}<span>עריכה</span>`;
  editAction.addEventListener('click', (e) => { e.stopPropagation(); closeOpen(); handlers.onEdit(); });

  const deleteAction = document.createElement('button');
  deleteAction.type = 'button';
  deleteAction.className = 'swipe-action swipe-action-delete';
  deleteAction.innerHTML = `${icon('trash')}<span>מחיקה</span>`;
  deleteAction.addEventListener('click', (e) => { e.stopPropagation(); closeOpen(); handlers.onDelete(); });

  const front = document.createElement('div');
  front.className = 'swipe-front';
  front.appendChild(card);

  wrap.append(editAction, deleteAction, front);

  let startX = 0;
  let startY = 0;
  let dx = 0;
  let dragging = false;
  let decided: 'h' | 'v' | null = null;

  front.addEventListener('pointerdown', (e: PointerEvent) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    // A nested interactive element (star button, place-link) must handle its
    // own click natively — setPointerCapture below would otherwise re-target
    // the resulting click event to `front` itself, silently swallowing it.
    if ((e.target as HTMLElement).closest('button, a')) return;
    startX = e.clientX;
    startY = e.clientY;
    dx = 0;
    dragging = true;
    decided = null;
    front.setPointerCapture(e.pointerId);
    front.style.transition = 'none';
  });

  front.addEventListener('pointermove', (e: PointerEvent) => {
    if (!dragging) return;
    const moveX = e.clientX - startX;
    const moveY = e.clientY - startY;
    if (!decided) {
      if (Math.abs(moveX) < TAP_THRESHOLD && Math.abs(moveY) < TAP_THRESHOLD) return;
      decided = Math.abs(moveX) > Math.abs(moveY) ? 'h' : 'v';
      if (decided === 'h') closeOpen(wrap);
    }
    if (decided !== 'h') return;
    e.preventDefault();
    dx = Math.max(-OPEN_PX, Math.min(OPEN_PX, moveX));
    front.style.transform = `translateX(${dx}px)`;
  });

  const endDrag = (): void => {
    if (!dragging) return;
    dragging = false;
    front.style.transition = '';
    if (decided !== 'h') { front.style.transform = 'translateX(0)'; return; }
    if (Math.abs(dx) < OPEN_PX / 2) {
      front.style.transform = 'translateX(0)';
      if (openWrapper === wrap) openWrapper = null;
      return;
    }
    front.style.transform = `translateX(${dx > 0 ? OPEN_PX : -OPEN_PX}px)`;
    wrap.classList.toggle('swipe-open-edit', dx > 0);
    wrap.classList.toggle('swipe-open-delete', dx < 0);
    openWrapper = wrap;
  };
  front.addEventListener('pointerup', endDrag);
  front.addEventListener('pointercancel', endDrag);

  front.addEventListener('click', (e) => {
    if (decided === 'h') { e.stopPropagation(); e.preventDefault(); return; }
    if (openWrapper === wrap) { closeOpen(); e.stopPropagation(); e.preventDefault(); return; }
    handlers.onTap?.(e);
  });

  return wrap;
}
