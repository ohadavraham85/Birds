/* lib/pdf.ts — build a styled RTL PDF report from selected observations. */

// html2pdf.js ships no types; import as an untyped factory.
// @ts-expect-error - no bundled type declarations
import html2pdf from 'html2pdf.js';

import { fmtDateTime, fmtCoords, toast } from './ui';
import { renderMarkdown, escapeHtml } from './markdown';
import { getMedia } from '../db/repository';
import type { Observation } from '../types';

function buildReportElement(observations: Observation[]): HTMLElement {
  const el = document.createElement('div');
  el.className = 'pdf-report';
  const projects = [...new Set(observations.map((o) => o.project).filter(Boolean))];
  el.innerHTML = `
    <div class="rpt-head">
      <h1>דו"ח תצפיות צפרות</h1>
      <div class="rpt-sub">
        הופק בתאריך ${fmtDateTime(new Date().toISOString())} ·
        ${observations.length} תצפיות
        ${projects.length ? ' · פרויקטים: ' + projects.map(escapeHtml).join(', ') : ''}
      </div>
    </div>
    ${observations.map((o) => `
      <div class="rpt-obs">
        <h2>${escapeHtml(o.species)}${(o.quantity ?? 1) > 1 ? ` — ${o.quantity} פרטים` : ''}</h2>
        <div class="rpt-grid">
          <div><b>תאריך ושעה:</b> ${fmtDateTime(o.dateTime)}</div>
          <div><b>מיקום:</b> ${escapeHtml(o.locationName || '—')}</div>
          <div><b>קואורדינטות:</b> <span dir="ltr">${fmtCoords(o.lat, o.lng) || '—'}</span></div>
          <div><b>פרויקט:</b> ${escapeHtml(o.project || '—')}</div>
        </div>
        ${o.notes ? `<div class="rpt-notes">${renderMarkdown(o.notes)}</div>` : ''}
        <div class="rpt-imgs" data-obs="${o.id}"></div>
      </div>`).join('')}
  `;
  return el;
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = (): void => resolve(r.result as string);
    r.onerror = reject;
    r.readAsDataURL(blob);
  });
}

async function attachImages(el: HTMLElement, observations: Observation[]): Promise<void> {
  for (const o of observations) {
    const wrap = el.querySelector<HTMLElement>(`.rpt-imgs[data-obs="${o.id}"]`);
    if (!wrap || !o.images?.length) continue;
    for (const img of o.images.slice(0, 3)) {
      const media = img.localId ? await getMedia(img.localId) : undefined;
      if (!media?.blob) continue;
      const im = document.createElement('img');
      im.src = await blobToDataUrl(media.blob);
      im.style.cssText = 'width:150px;height:110px;object-fit:cover;border-radius:6px;margin:6px 0 0 6px;';
      wrap.appendChild(im);
    }
  }
}

export async function exportObservationsPdf(observations: Observation[]): Promise<void> {
  const el = buildReportElement(observations);
  await attachImages(el, observations);

  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;top:0;right:-10000px;z-index:-1;';
  host.appendChild(el);
  document.body.appendChild(host);

  const fileName = `דוח-תצפיות-${new Date().toISOString().slice(0, 16).replace(':', '')}.pdf`;
  try {
    const blob: Blob = await html2pdf()
      .set({
        margin: [10, 10, 12, 10],
        filename: fileName,
        image: { type: 'jpeg', quality: 0.95 },
        html2canvas: { scale: 2, useCORS: true },
        jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
        pagebreak: { mode: ['avoid-all', 'css'] },
      })
      .from(el)
      .output('blob');

    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = fileName;
    a.click();
    URL.revokeObjectURL(a.href);
    toast('הדו"ח הופק והורד למכשיר ✓');
  } finally {
    host.remove();
  }
}
