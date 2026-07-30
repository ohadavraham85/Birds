/* lib/diagram-upload.ts — shared "pick a diagram sheet" flow: choose an
 * image file directly, or a PDF and one page out of it (rasterized via
 * pdf.js), used by both the create-diagram modal and the in-viewer
 * add/replace-page actions. */

import { listPdfPageThumbnails, renderPdfPageToBlob } from './pdf-render';
import { showModal, toast } from './ui';
import { icon } from './icons';

export interface PickedSheet {
  blob: Blob;
  width: number;
  height: number;
}

/** A detached (never-appended) file input works in real browsers, but some
 * automation/CDP paths only deliver the chosen file's change event to an
 * input that's actually in the document — so this one is, just invisible. */
function pickFile(accept: string): Promise<File | null> {
  return new Promise((resolve) => {
    const el = document.createElement('input');
    el.type = 'file';
    el.accept = accept;
    el.style.cssText = 'position:fixed;top:-9999px;left:-9999px;';
    const cleanup = (): void => el.remove();
    el.addEventListener('change', () => { const f = el.files?.[0] ?? null; cleanup(); resolve(f); }, { once: true });
    el.addEventListener('cancel', () => { cleanup(); resolve(null); }, { once: true });
    document.body.appendChild(el);
    el.click();
  });
}

async function imageSize(blob: Blob): Promise<{ width: number; height: number }> {
  const bmp = await createImageBitmap(blob);
  const size = { width: bmp.width, height: bmp.height };
  bmp.close();
  return size;
}

/** Shows a grid of every page in `file`; resolves the chosen page number, or
 * null if the user closes the picker without choosing. */
function pickPdfPage(file: File): Promise<number | null> {
  return new Promise((resolve) => {
    const wrap = document.createElement('div');
    wrap.className = 'pdf-page-picker';
    wrap.innerHTML = `<h3>${icon('document')} בחירת עמוד מתוך ה-PDF</h3><div class="pdf-page-grid" id="pdf-page-grid"><p class="hint">טוען עמודים...</p></div>`;
    let settled = false;
    const close = showModal(wrap);
    const finish = (page: number | null): void => {
      if (settled) return;
      settled = true;
      close();
      resolve(page);
    };
    wrap.addEventListener('click', (e) => {
      const cell = (e.target as HTMLElement).closest<HTMLElement>('.pdf-page-cell');
      if (cell) finish(Number(cell.dataset.page));
    });
    // showModal's backdrop click already removes the modal; make sure that
    // also resolves the promise (once) instead of leaving it hanging.
    wrap.closest('.modal-backdrop')?.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).classList.contains('modal-backdrop')) finish(null);
    });

    void listPdfPageThumbnails(file).then((thumbs) => {
      const grid = wrap.querySelector('#pdf-page-grid')!;
      grid.innerHTML = thumbs.map((t) => `
        <button type="button" class="pdf-page-cell" data-page="${t.pageNumber}">
          <img src="${t.url}" alt="עמוד ${t.pageNumber}">
          <span>עמוד ${t.pageNumber}</span>
        </button>`).join('');
    }).catch((err: unknown) => {
      toast('כשל בקריאת ה-PDF: ' + (err as Error).message, true);
      finish(null);
    });
  });
}

/** Runs the full pick flow (file → optional PDF page pick → rasterize) and
 * returns the resulting image blob + natural size, or null if the user
 * canceled at any step. */
export async function pickDiagramSheet(): Promise<PickedSheet | null> {
  const file = await pickFile('image/*,application/pdf');
  if (!file) return null;

  if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
    const pageNumber = await pickPdfPage(file);
    if (pageNumber == null) return null;
    const blob = await renderPdfPageToBlob(file, pageNumber);
    const { width, height } = await imageSize(blob);
    return { blob, width, height };
  }

  const { width, height } = await imageSize(file);
  return { blob: file, width, height };
}
