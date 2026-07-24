/* lib/pdf.ts — build a styled RTL PDF report from observations.
 * Includes the birder's contact details at the head and foot of the report,
 * and per-species photos under each species in the list. */

// html2pdf.js ships no types; import as an untyped factory.
// @ts-expect-error - no bundled type declarations
import html2pdf from 'html2pdf.js';

import { fmtDateTime, fmtCoords, toast } from './ui';
import { renderMarkdown, escapeHtml } from './markdown';
import { getMedia, saveFile } from '../db/repository';
import { entriesOf, entryImages, totalQuantity } from './observation';
import type { Observation } from '../types';

const BIRDER = {
  name: 'אוהד אברהם (Ohad Avraham)',
  phone: '053-5505382',
  email: 'ohadavraham85@gmail.com',
};

function contactBlock(): string {
  return `
    <div class="rpt-contact">
      <div class="rpt-birder">${escapeHtml(BIRDER.name)}</div>
      <div class="rpt-birder-line">טלפון: <span dir="ltr">${escapeHtml(BIRDER.phone)}</span> · מייל: <span dir="ltr">${escapeHtml(BIRDER.email)}</span></div>
    </div>`;
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = (): void => resolve(r.result as string);
    r.onerror = reject;
    r.readAsDataURL(blob);
  });
}

async function imgTag(localId: string | undefined): Promise<string> {
  if (!localId) return '';
  const media = await getMedia(localId);
  if (!media?.blob) return '';
  const dataUrl = await blobToDataUrl(media.blob);
  return `<img src="${dataUrl}" style="width:150px;height:110px;object-fit:cover;border-radius:6px;margin:6px 0 0 6px;">`;
}

async function obsBlock(o: Observation): Promise<string> {
  const entries = entriesOf(o);
  const entriesHtml: string[] = [];
  for (const [i, e] of entries.entries()) {
    const imgs = (await Promise.all(entryImages(e).slice(0, 4).map((im) => imgTag(im.localId)))).join('');
    entriesHtml.push(`
      <li>
        <b>${i + 1}. ${escapeHtml(e.species)}</b> × ${e.quantity}
        ${e.note ? `<div class="rpt-sp-note">${escapeHtml(e.note)}</div>` : ''}
        ${imgs ? `<div class="rpt-sp-imgs">${imgs}</div>` : ''}
      </li>`);
  }
  return `
    <div class="rpt-obs">
      <h2>${escapeHtml(o.locationName || 'תצפית')}${totalQuantity(o) ? ` — ${totalQuantity(o)} פרטים` : ''}</h2>
      <div class="rpt-grid">
        <div><b>תאריך ושעה:</b> ${fmtDateTime(o.dateTime)}</div>
        <div><b>מיקום:</b> ${escapeHtml(o.locationName || '—')}</div>
        <div><b>קואורדינטות:</b> <span dir="ltr">${fmtCoords(o.lat, o.lng) || '—'}</span></div>
        <div><b>פרויקט:</b> ${escapeHtml(o.project || '—')}</div>
      </div>
      <ol class="rpt-species">${entriesHtml.join('')}</ol>
      ${o.notes ? `<div class="rpt-notes">${renderMarkdown(o.notes)}</div>` : ''}
    </div>`;
}

async function buildReportElement(observations: Observation[]): Promise<HTMLElement> {
  const el = document.createElement('div');
  el.className = 'pdf-report';
  const projects = [...new Set(observations.map((o) => o.project).filter(Boolean))];
  const blocks = (await Promise.all(observations.map(obsBlock))).join('');
  el.innerHTML = `
    ${contactBlock()}
    <div class="rpt-head">
      <h1>דו"ח תצפיות צפרות</h1>
      <div class="rpt-sub">
        הופק בתאריך ${fmtDateTime(new Date().toISOString())} ·
        ${observations.length} תצפיות
        ${projects.length ? ' · פרויקטים: ' + projects.map(escapeHtml).join(', ') : ''}
      </div>
    </div>
    ${blocks}
    <div class="rpt-foot">${escapeHtml(BIRDER.name)} · <span dir="ltr">${escapeHtml(BIRDER.phone)}</span> · <span dir="ltr">${escapeHtml(BIRDER.email)}</span></div>
  `;
  return el;
}

export async function exportObservationsPdf(observations: Observation[]): Promise<void> {
  const el = await buildReportElement(observations);

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

    const createdAt = new Date().toISOString();
    await saveFile({ id: crypto.randomUUID(), name: fileName, kind: 'report', mime: 'application/pdf', blob, createdAt, updatedAt: createdAt });

    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = fileName;
    a.click();
    URL.revokeObjectURL(a.href);
    toast('הדו"ח הופק והורד למכשיר ✓ (נשמר גם בתיקיית דוחות תצפית בהגדרות)', false, 5000);
  } finally {
    host.remove();
  }
}
