/* views/cards.js — מסך יומן כרונולוגי (סעיף 7.4): תצוגת כרטיסים רצה עם שם
 * המין, תאריך והערות בפורמט טקסט עשיר (Markdown). */

import { listObservations } from '../db.js';
import { fmtDateTime, fmtCoords, showImageModal } from '../ui.js';
import { renderMarkdown, escapeHtml } from '../markdown.js';
import { getImageObjectUrl } from '../drive.js';

let container = null;

export function init(el) {
  container = el;
}

export async function activate() {
  const all = await listObservations();
  container.innerHTML = '<h2>יומן תצפיות</h2>';
  if (!all.length) {
    container.insertAdjacentHTML('beforeend', '<p style="color:var(--ink-soft)">אין עדיין תצפיות — התחילו בטופס הדיווח 📝</p>');
    return;
  }
  const feed = document.createElement('div');
  feed.className = 'cards-feed';
  container.appendChild(feed);

  for (const o of all) {
    const card = document.createElement('article');
    card.className = 'obs-card';
    card.innerHTML = `
      <div class="card-head">
        <span class="species">${escapeHtml(o.species)}<span class="qty"> × ${o.quantity ?? 1}</span></span>
        ${o.project ? `<span class="badge">${escapeHtml(o.project)}</span>` : ''}
      </div>
      <div class="meta">
        <span>🕒 ${fmtDateTime(o.dateTime)}</span>
        ${o.locationName ? `<span>📍 ${escapeHtml(o.locationName)}</span>` : ''}
        ${fmtCoords(o.lat, o.lng) ? `<span dir="ltr">🧭 ${fmtCoords(o.lat, o.lng)}</span>` : ''}
      </div>
      ${o.notes ? `<div class="notes">${renderMarkdown(o.notes)}</div>` : ''}
    `;
    if (o.images?.length) {
      const imgWrap = document.createElement('div');
      imgWrap.className = 'card-images';
      card.appendChild(imgWrap);
      for (const img of o.images) {
        const el = document.createElement('img');
        el.alt = img.name || 'תמונת תצפית';
        el.loading = 'lazy';
        imgWrap.appendChild(el);
        getImageObjectUrl(img, o.id).then((url) => {
          if (url) {
            el.src = url;
            el.onclick = () => showImageModal(url, o.species);
          } else {
            el.remove();
          }
        });
      }
    }
    feed.appendChild(card);
  }
}
