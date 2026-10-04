/* lib/bg-slideshow.ts — the app-wide background: the user's own gallery
 * photos, crossfading one after another under a light wash (see
 * .bg-slides in app.css) so the pages stay bright and readable. */

import { listAllMedia, getMedia, onDataChanged } from '../db/repository';

const INTERVAL_MS = 12000;
/** Shown faded under a wash, so a small copy is plenty — and decoding a
 * full-size camera original every few seconds would be heavy on a phone. */
const MAX_EDGE = 1280;
/** Formats the browser can actually decode (HEIC/TIFF imports can't be drawn). */
const RENDERABLE = /^image\/(jpeg|png|webp|gif|avif|bmp)$/i;

let ids: string[] = [];
let order: string[] = [];
let layers: HTMLElement[] = [];
let front = 0;
const layerUrls: (string | null)[] = [null, null];
let timer: ReturnType<typeof setTimeout> | null = null;

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

async function refreshIds(): Promise<void> {
  const all = await listAllMedia();
  ids = all.filter((m) => m.blob?.size && RENDERABLE.test(m.mime || m.blob.type)).map((m) => m.id);
  order = order.filter((id) => ids.includes(id));
}

async function downscale(blob: Blob): Promise<Blob | null> {
  try {
    const bmp = await createImageBitmap(blob);
    const scale = Math.min(1, MAX_EDGE / Math.max(bmp.width, bmp.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bmp.width * scale);
    canvas.height = Math.round(bmp.height * scale);
    canvas.getContext('2d')!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    bmp.close();
    return await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.8));
  } catch {
    return null;
  }
}

async function showNext(): Promise<void> {
  if (!ids.length) {
    layers.forEach((l) => l.classList.remove('show'));
    return;
  }
  // Up to a few tries, so one unreadable photo doesn't leave the background stuck.
  for (let attempt = 0; attempt < 3; attempt++) {
    if (!order.length) order = shuffle(ids);
    const id = order.shift()!;
    const media = await getMedia(id);
    const small = media?.blob ? await downscale(media.blob) : null;
    if (!small) continue;
    const back = 1 - front;
    const url = URL.createObjectURL(small);
    layers[back]!.style.backgroundImage = `url("${url}")`;
    const old = layerUrls[back];
    layerUrls[back] = url;
    if (old) URL.revokeObjectURL(old);
    layers[back]!.classList.add('show');
    layers[front]!.classList.remove('show');
    front = back;
    return;
  }
}

function schedule(): void {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    if (document.hidden) return; // resumed by the visibilitychange listener
    void showNext().finally(schedule);
  }, INTERVAL_MS);
}

export async function startBackgroundSlideshow(): Promise<void> {
  const root = document.getElementById('bg-slides');
  if (!root) return;
  layers = Array.from(root.querySelectorAll<HTMLElement>('.bg-slide'));
  if (layers.length < 2) return;

  await refreshIds();
  await showNext();
  schedule();

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && !timer) schedule();
  });

  let refreshDebounce: ReturnType<typeof setTimeout> | null = null;
  onDataChanged(() => {
    if (refreshDebounce) clearTimeout(refreshDebounce);
    refreshDebounce = setTimeout(() => {
      const hadNone = !ids.length;
      void refreshIds().then(() => { if (hadNone && ids.length) void showNext(); });
    }, 1500);
  });
}
