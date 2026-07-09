/* pdf.js — הפקת דו"ח PDF מרוכז מתצפיות שנבחרו (סעיף 8ב).
 * POC בקליינט בלבד: הדו"ח נבנה כתבנית HTML מעוצבת (RTL מלא), מומר ל-PDF
 * בצד הלקוח ומורד ישירות למכשיר.
 */

import { fmtDateTime, fmtCoords, toast } from './ui.js';
import { renderMarkdown, escapeHtml } from './markdown.js';
import { getMedia } from './db.js';

function buildReportElement(observations) {
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

/** Attach stored images (as data URLs) so they render into the PDF. */
async function attachImages(el, observations) {
  for (const o of observations) {
    const wrap = el.querySelector(`.rpt-imgs[data-obs="${o.id}"]`);
    if (!wrap || !o.images?.length) continue;
    for (const img of o.images.slice(0, 3)) {
      const media = img.localId && await getMedia(img.localId);
      if (!media?.blob) continue;
      const dataUrl = await blobToDataUrl(media.blob);
      const im = document.createElement('img');
      im.src = dataUrl;
      im.style.cssText = 'width:150px;height:110px;object-fit:cover;border-radius:6px;margin:6px 0 0 6px;';
      wrap.appendChild(im);
    }
  }
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = reject;
    r.readAsDataURL(blob);
  });
}

export async function exportObservationsPdf(observations) {
  const el = buildReportElement(observations);
  await attachImages(el, observations);

  // html2pdf renders off-screen; the element must be in the DOM
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;top:0;right:-10000px;z-index:-1;';
  host.appendChild(el);
  document.body.appendChild(host);

  const fileName = `דוח-תצפיות-${new Date().toISOString().slice(0, 16).replace(':', '')}.pdf`;
  try {
    const worker = html2pdf()
      .set({
        margin: [10, 10, 12, 10],
        filename: fileName,
        image: { type: 'jpeg', quality: 0.95 },
        html2canvas: { scale: 2, useCORS: true },
        jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
        pagebreak: { mode: ['avoid-all', 'css'] },
      })
      .from(el);

    const blob = await worker.output('blob');
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
