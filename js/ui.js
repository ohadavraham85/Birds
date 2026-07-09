/* ui.js — small shared UI helpers: toast, modal, formatting. */

let toastTimer = null;

export function toast(msg, isError = false, ms = 3000) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.toggle('error', isError);
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, ms);
}

export function fmtDateTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d)) return iso;
  return d.toLocaleString('he-IL', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

export function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d)) return iso;
  return d.toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

export function fmtCoords(lat, lng) {
  if (lat == null || lng == null || lat === '' || lng === '') return '';
  return `${Number(lat).toFixed(5)}, ${Number(lng).toFixed(5)}`;
}

/** Local-time value for <input type="datetime-local">. */
export function toLocalInputValue(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function fromLocalInputValue(v) {
  const d = new Date(v);
  return isNaN(d) ? null : d.toISOString();
}

/** Simple modal. `content` is an HTMLElement; returns a close() function. */
export function showModal(content) {
  const root = document.getElementById('modal-root');
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  const box = document.createElement('div');
  box.className = 'modal';
  box.appendChild(content);
  backdrop.appendChild(box);
  const close = () => backdrop.remove();
  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(); });
  root.appendChild(backdrop);
  return close;
}

export function confirmDialog(message, confirmLabel = 'אישור') {
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
    ok.onclick = () => { close(); resolve(true); };
    cancel.onclick = () => { close(); resolve(false); };
  });
}

/** View an image full-size in a modal. */
export function showImageModal(url, caption = '') {
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
