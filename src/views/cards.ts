/* views/cards.ts — מסך יומן (ראשי): כרטיס לכל תצפית עם מיקום לחיץ (מפות),
 * רשימת מינים ממוספרת, הערה ותמונות לכל מין, וכפתור ייצוא ל-PDF. כולל FAB
 * להוספת תצפית. */

import { listObservations } from '../db/repository';
import { fmtDateTime, fmtCoords, showImageModal, toast } from '../lib/ui';
import { renderMarkdown, escapeHtml } from '../lib/markdown';
import { getImageObjectUrl } from '../lib/media';
import { entriesOf, entryImages } from '../lib/observation';
import { exportObservationsPdf } from '../lib/pdf';
import { navigate } from '../main';
import type { Observation } from '../types';

let container: HTMLElement;

export function init(el: HTMLElement): void {
  container = el;
}

function mapsUrl(o: Observation): string | null {
  if (o.lat != null && o.lng != null) return `https://www.google.com/maps/search/?api=1&query=${o.lat},${o.lng}`;
  if (o.locationName) return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(o.locationName)}`;
  return null;
}

export async function activate(): Promise<void> {
  const all = await listObservations();
  container.innerHTML = '<h2>יומן תצפית</h2>';
  if (!all.length) {
    container.insertAdjacentHTML('beforeend',
      '<p style="color:var(--ink-soft)">אין עדיין תצפיות — הוסיפו תצפית עם כפתור ה־➕ 📝</p>');
    return;
  }
  const feed = document.createElement('div');
  feed.className = 'cards-feed';
  container.appendChild(feed);

  for (const o of all) {
    const entries = entriesOf(o);
    const url = mapsUrl(o);
    const card = document.createElement('article');
    card.className = 'obs-card';
    card.innerHTML = `
      <div class="card-head">
        <div class="card-place">
          ${url
            ? `<a href="${url}" target="_blank" rel="noopener" class="place-link">📍 ${escapeHtml(o.locationName || 'מיקום')}</a>`
            : `<span>📍 ${escapeHtml(o.locationName || '—')}</span>`}
          ${o.project ? `<span class="badge">${escapeHtml(o.project)}</span>` : ''}
        </div>
        <button class="btn btn-sm act-pdf" title="ייצוא ל-PDF">🧾</button>
      </div>
      <div class="meta">
        <span>🕒 ${fmtDateTime(o.dateTime)}</span>
        ${fmtCoords(o.lat, o.lng) ? `<span dir="ltr">🧭 ${fmtCoords(o.lat, o.lng)}</span>` : ''}
      </div>
      <ol class="species-ol"></ol>
      ${o.notes ? `<div class="notes">${renderMarkdown(o.notes)}</div>` : ''}
    `;
    card.querySelector('.act-pdf')!.addEventListener('click', () => void onExportOne(o));

    const ol = card.querySelector<HTMLElement>('.species-ol')!;
    for (const entry of entries) {
      const li = document.createElement('li');
      li.className = 'species-li';
      li.innerHTML = `
        <div class="species-line">
          <span class="species-name">${escapeHtml(entry.species)}</span>
          <span class="species-qty">× ${entry.quantity}</span>
        </div>
        ${entry.note ? `<div class="species-note">${escapeHtml(entry.note)}</div>` : ''}
        <div class="species-imgs"></div>
      `;
      const imgWrap = li.querySelector<HTMLElement>('.species-imgs')!;
      for (const img of entryImages(entry)) {
        const el = document.createElement('img');
        el.alt = img.name || entry.species;
        el.loading = 'lazy';
        imgWrap.appendChild(el);
        void getImageObjectUrl(img, o.id).then((objUrl) => {
          if (objUrl) { el.src = objUrl; el.onclick = (): void => showImageModal(objUrl, entry.species); }
          else el.remove();
        });
      }
      ol.appendChild(li);
    }
    feed.appendChild(card);
  }
}

async function onExportOne(o: Observation): Promise<void> {
  try {
    await exportObservationsPdf([o]);
  } catch (err) {
    toast('הפקת ה-PDF נכשלה: ' + (err as Error).message, true, 5000);
  }
}

// Called by the FAB in the app chrome.
export function newObservation(): void {
  navigate('form');
}
