/* lib/pdf-render.ts — client-side PDF page rasterization (pdf.js), used by
 * the diagram upload flow to let the user pick a single sheet out of a
 * multi-page vendor drawing set and store it as a plain image. pdfjs-dist is
 * ~1MB, so it's dynamically imported here — code-split into its own chunk
 * that only loads the first time someone actually uploads a PDF, instead of
 * bloating the app's main bundle for every user. */

import type * as PdfjsLib from 'pdfjs-dist';

export interface PdfPageThumb {
  pageNumber: number;
  url: string;
}

let pdfjsPromise: Promise<typeof PdfjsLib> | null = null;

async function getPdfjs(): Promise<typeof PdfjsLib> {
  if (!pdfjsPromise) {
    pdfjsPromise = (async () => {
      const pdfjsLib = await import('pdfjs-dist');
      const { default: pdfWorkerUrl } = await import('pdfjs-dist/build/pdf.worker.min.mjs?url');
      pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
      return pdfjsLib;
    })();
  }
  return pdfjsPromise;
}

async function loadPdf(file: File): Promise<PdfjsLib.PDFDocumentProxy> {
  const pdfjsLib = await getPdfjs();
  const data = await file.arrayBuffer();
  return pdfjsLib.getDocument({ data }).promise;
}

async function renderPageToCanvas(page: PdfjsLib.PDFPageProxy, targetWidth: number): Promise<HTMLCanvasElement> {
  const base = page.getViewport({ scale: 1 });
  const scale = targetWidth / base.width;
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(viewport.width);
  canvas.height = Math.round(viewport.height);
  const canvasContext = canvas.getContext('2d')!;
  await page.render({ canvasContext, viewport }).promise;
  return canvas;
}

/** Renders every page of `file` at thumbnail size, for a page-picker grid. */
export async function listPdfPageThumbnails(file: File, thumbWidth = 220): Promise<PdfPageThumb[]> {
  const pdf = await loadPdf(file);
  const out: PdfPageThumb[] = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const canvas = await renderPageToCanvas(page, thumbWidth);
    out.push({ pageNumber: i, url: canvas.toDataURL('image/png') });
  }
  return out;
}

/** Renders a single page at higher resolution and returns it as a PNG blob,
 * suitable for storage as the diagram sheet's background image. */
export async function renderPdfPageToBlob(file: File, pageNumber: number, targetWidth = 1800): Promise<Blob> {
  const pdf = await loadPdf(file);
  const page = await pdf.getPage(pageNumber);
  const canvas = await renderPageToCanvas(page, targetWidth);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('רינדור העמוד נכשל');
  return blob;
}
