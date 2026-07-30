/* views/diagram.ts — מסך צפייה בתרשים בודד: הצגת עמוד (תרשים חד קווי /
 * מראה לוח) עם אפשרות זום/גלילה, קישור נכס קיים לתא בלחיצה על מקום ריק,
 * ולחיצה על סמן קיים לפתיחת פרטי הנכס המקושר או ביטול הקישור. */

import {
  getDiagram, saveDiagram, deleteDiagram,
  listMarkersForDiagram, saveDiagramMarker, deleteDiagramMarker,
  saveDiagramMedia, deleteDiagramMedia,
  listAssets,
} from '../db/repository';
import { getDiagramPageObjectUrl } from '../lib/media';
import { pickDiagramSheet } from '../lib/diagram-upload';
import { DIAGRAM_PAGE_KIND_META } from '../lib/diagram-meta';
import { ASSET_TYPE_META, ASSET_STATUS_META } from '../lib/asset-meta';
import { toast, confirmDialog, showModal } from '../lib/ui';
import { escapeHtml } from '../lib/markdown';
import { icon } from '../lib/icons';
import { qs } from '../lib/dom';
import { navigate, goBack } from '../main';
import { DIAGRAM_PAGE_KINDS } from '../types';
import type { ViewParams } from './view';
import type { Diagram, DiagramPage, DiagramPageKind, DiagramMarker, Asset } from '../types';

let container: HTMLElement;
let diagramId: string | null = null;
let diagram: Diagram | null = null;
let activePageId: string | null = null;
let markers: DiagramMarker[] = [];
let assetById = new Map<string, Asset>();
let scale = 1;
let pageObjectUrl: string | null = null;
let closeSheet: (() => void) | null = null;

export function init(el: HTMLElement): void {
  container = el;
  container.innerHTML = `
    <div class="form-head">
      <button type="button" class="btn btn-sm" id="dgv-back">→ חזרה</button>
      <h2 id="dgv-title"></h2>
      <button type="button" class="btn btn-icon btn-danger" id="dgv-delete" title="מחיקת תרשים" aria-label="מחיקת תרשים">${icon('trash')}</button>
    </div>
    <div class="diagram-toolbar" id="dgv-toolbar"></div>
    <div class="diagram-viewport" id="dgv-viewport">
      <div class="diagram-canvas" id="dgv-canvas"></div>
    </div>
    <p class="hint" id="dgv-empty" hidden>אין עדיין עמוד לתרשים זה — הוסיפו אותו למעלה.</p>
    <div class="map-hint">לחיצה על מקום ריק בתרשים מקשרת נכס קיים · לחיצה על סמן קיים מציגה את פרטיו</div>
    <div class="diagram-zoom-controls">
      <button type="button" class="btn btn-icon" id="dgv-zoom-in" title="הגדלה" aria-label="הגדלה">${icon('plus')}</button>
      <button type="button" class="btn btn-icon" id="dgv-zoom-out" title="הקטנה" aria-label="הקטנה">−</button>
      <button type="button" class="btn btn-icon" id="dgv-zoom-fit" title="התאמה לרוחב" aria-label="התאמה לרוחב">${icon('target')}</button>
    </div>
  `;
  qs(container, '#dgv-back').addEventListener('click', goBack);
  qs(container, '#dgv-delete').addEventListener('click', () => void onDeleteDiagram());
  qs(container, '#dgv-toolbar').addEventListener('click', (e) => void onToolbarClick(e));
  qs(container, '#dgv-canvas').addEventListener('click', (e) => void onCanvasClick(e));
  qs(container, '#dgv-zoom-in').addEventListener('click', () => setScale(scale * 1.25));
  qs(container, '#dgv-zoom-out').addEventListener('click', () => setScale(scale / 1.25));
  qs(container, '#dgv-zoom-fit').addEventListener('click', () => setScale(fitScale()));
}

export function setParams(params: ViewParams): void {
  diagramId = params?.viewId || null;
  activePageId = null;
}

export async function activate(): Promise<void> {
  diagram = diagramId ? (await getDiagram(diagramId)) || null : null;
  qs(container, '#dgv-title').textContent = diagram?.name ?? 'תרשים';
  if (!diagram) {
    qs(container, '#dgv-toolbar').innerHTML = '';
    qs(container, '#dgv-canvas').innerHTML = '';
    qs<HTMLElement>(container, '#dgv-empty').hidden = false;
    qs<HTMLElement>(container, '#dgv-empty').textContent = 'התרשים לא נמצא — ייתכן שנמחק.';
    return;
  }

  if (!activePageId || !diagram.pages.some((p) => p.id === activePageId)) {
    const preferred = diagram.pages.find((p) => p.kind === 'one-line') ?? diagram.pages[0];
    activePageId = preferred?.id ?? null;
  }

  const assets = await listAssets();
  assetById = new Map(assets.map((a) => [a.id, a]));
  markers = diagramId ? await listMarkersForDiagram(diagramId) : [];

  renderToolbar();
  await renderCanvas();
}

export function deactivate(): void {
  if (pageObjectUrl) { URL.revokeObjectURL(pageObjectUrl); pageObjectUrl = null; }
  closeSheet?.();
}

/* ---------- toolbar (page tabs + add/replace) ---------- */

function renderToolbar(): void {
  if (!diagram) return;
  const present = new Map(diagram.pages.map((p) => [p.kind, p]));
  const tabs = DIAGRAM_PAGE_KINDS.map((kind) => {
    const page = present.get(kind);
    const meta = DIAGRAM_PAGE_KIND_META[kind];
    if (!page) {
      return `<button type="button" class="diagram-page-tab diagram-page-tab-missing" data-add-kind="${kind}">${icon('plus')} הוספת ${meta.shortLabel}</button>`;
    }
    return `<button type="button" class="diagram-page-tab${page.id === activePageId ? ' active' : ''}" data-page-id="${page.id}">${meta.shortLabel}</button>`;
  }).join('');
  const replaceBtn = activePageId ? `<button type="button" class="btn btn-sm" id="dgv-replace" data-page-id="${activePageId}">${icon('upload')} החלפת תמונה</button>` : '';
  qs(container, '#dgv-toolbar').innerHTML = `<div class="diagram-page-tabs">${tabs}</div>${replaceBtn}`;
}

async function onToolbarClick(e: Event): Promise<void> {
  const target = e.target as HTMLElement;
  const tab = target.closest<HTMLElement>('.diagram-page-tab[data-page-id]');
  if (tab) { activePageId = tab.dataset.pageId!; renderToolbar(); await renderCanvas(true); return; }

  const addTab = target.closest<HTMLElement>('[data-add-kind]');
  if (addTab) { await addOrReplacePage(addTab.dataset.addKind as DiagramPageKind); return; }

  const replaceBtn = target.closest<HTMLElement>('#dgv-replace');
  if (replaceBtn) {
    const page = diagram?.pages.find((p) => p.id === replaceBtn.dataset.pageId);
    if (page) await addOrReplacePage(page.kind);
  }
}

async function addOrReplacePage(kind: DiagramPageKind): Promise<void> {
  if (!diagram) return;
  const picked = await pickDiagramSheet();
  if (!picked) return;
  const localId = crypto.randomUUID();
  await saveDiagramMedia({ id: localId, mime: 'image/png', blob: picked.blob });

  const existing = diagram.pages.find((p) => p.kind === kind);
  if (existing) await deleteDiagramMedia(existing.localId);
  const newPage = { id: existing?.id ?? crypto.randomUUID(), kind, localId, width: picked.width, height: picked.height };
  diagram.pages = [...diagram.pages.filter((p) => p.kind !== kind), newPage];
  diagram = await saveDiagram(diagram);
  activePageId = newPage.id;
  toast('העמוד נשמר ✓');
  renderToolbar();
  await renderCanvas(true);
}

/* ---------- canvas: page image + markers ---------- */

function currentPage(): DiagramPage | null {
  return diagram?.pages.find((p) => p.id === activePageId) ?? null;
}

function fitScale(): number {
  const page = currentPage();
  const viewport = qs(container, '#dgv-viewport');
  if (!page || !viewport.clientWidth) return 1;
  return Math.min(1, (viewport.clientWidth - 4) / page.width);
}

function setScale(next: number): void {
  scale = Math.min(4, Math.max(0.1, next));
  const page = currentPage();
  if (!page) return;
  const canvas = qs(container, '#dgv-canvas');
  canvas.style.width = `${page.width * scale}px`;
  canvas.style.height = `${page.height * scale}px`;
}

async function renderCanvas(resetScale = false): Promise<void> {
  const canvas = qs(container, '#dgv-canvas');
  const page = currentPage();
  qs<HTMLElement>(container, '#dgv-empty').hidden = !!page;
  if (pageObjectUrl) { URL.revokeObjectURL(pageObjectUrl); pageObjectUrl = null; }
  if (!page) { canvas.innerHTML = ''; return; }

  pageObjectUrl = await getDiagramPageObjectUrl(page.localId);
  canvas.innerHTML = `
    <img src="${pageObjectUrl ?? ''}" alt="" draggable="false">
    ${markers.filter((m) => m.pageId === page.id).map(markerHtml).join('')}
  `;
  if (resetScale || scale === 1) setScale(fitScale()); else setScale(scale);
}

function markerHtml(m: DiagramMarker): string {
  const asset = assetById.get(m.assetId);
  const color = asset ? ASSET_STATUS_META[asset.status].color : '#8a8f98';
  const iconName = asset ? ASSET_TYPE_META[asset.type].icon : 'pin';
  const label = asset ? (asset.name || asset.code) : 'נכס נמחק';
  return `
    <button type="button" class="diagram-marker" style="left:${(m.x * 100).toFixed(3)}%;top:${(m.y * 100).toFixed(3)}%;background:${color}" data-marker-id="${m.id}" title="${escapeHtml(label)}">
      ${icon(iconName)}
    </button>`;
}

async function onCanvasClick(e: Event): Promise<void> {
  const target = e.target as HTMLElement;
  const markerBtn = target.closest<HTMLElement>('.diagram-marker');
  const page = currentPage();
  if (!page) return;

  if (markerBtn) { openMarkerSheet(markerBtn.dataset.markerId!); return; }

  const canvas = qs(container, '#dgv-canvas');
  const rect = canvas.getBoundingClientRect();
  const x = Math.min(1, Math.max(0, ((e as MouseEvent).clientX - rect.left) / rect.width));
  const y = Math.min(1, Math.max(0, ((e as MouseEvent).clientY - rect.top) / rect.height));
  await onEmptyClick(page.id, x, y);
}

/* ---------- linking / unlinking assets ---------- */

async function onEmptyClick(pageId: string, x: number, y: number): Promise<void> {
  if (!diagramId) return;
  const asset = await pickAssetModal();
  if (!asset) return;
  const marker = await saveDiagramMarker({
    id: crypto.randomUUID(), diagramId, pageId, assetId: asset.id, x, y, deleted: false, updatedAt: '',
  });
  markers = [...markers, marker];
  await renderCanvas();
  toast(`הנכס "${asset.name || asset.code}" קושר לתרשים ✓`);
}

function markerSheetHtml(m: DiagramMarker, asset: Asset | undefined): string {
  if (!asset) {
    return `
      <div class="map-sheet-head"><h3>נכס לא נמצא</h3><button type="button" class="btn btn-icon dgv-sheet-close" title="סגירה" aria-label="סגירה">✕</button></div>
      <p class="hint">הנכס המקושר נמחק.</p>
      <div class="modal-actions"><button type="button" class="btn btn-danger dgv-sheet-unlink" data-id="${m.id}">${icon('trash')} ביטול קישור</button></div>`;
  }
  const t = ASSET_TYPE_META[asset.type];
  const s = ASSET_STATUS_META[asset.status];
  return `
    <div class="map-sheet-head">
      <h3>${icon(t.icon)} ${escapeHtml(asset.name || t.label)}</h3>
      <button type="button" class="btn btn-icon dgv-sheet-close" title="סגירה" aria-label="סגירה">✕</button>
    </div>
    <div class="asset-sheet-meta">
      <span class="status-badge" style="background:${s.color}">${s.label}</span>
      <span class="hint">${t.label}${asset.code ? ` · #${escapeHtml(asset.code)}` : ''}</span>
    </div>
    <div class="modal-actions">
      <button type="button" class="btn btn-primary dgv-sheet-open" data-id="${asset.id}">${icon('document')} פתיחת פרטי הנכס</button>
      <button type="button" class="btn btn-danger dgv-sheet-unlink" data-id="${m.id}">${icon('trash')} ביטול קישור</button>
    </div>`;
}

function openMarkerSheet(markerId: string): void {
  const marker = markers.find((m) => m.id === markerId);
  if (!marker) return;
  const asset = assetById.get(marker.assetId);
  closeSheet?.();
  const backdrop = document.createElement('div');
  backdrop.className = 'sheet-backdrop';
  const sheet = document.createElement('div');
  sheet.className = 'map-sheet';
  sheet.innerHTML = markerSheetHtml(marker, asset);
  backdrop.appendChild(sheet);
  document.getElementById('modal-root')!.appendChild(backdrop);
  const close = (): void => { backdrop.remove(); if (closeSheet === close) closeSheet = null; };
  closeSheet = close;
  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(); });
  sheet.querySelector('.dgv-sheet-close')!.addEventListener('click', close);
  sheet.querySelector('.dgv-sheet-open')?.addEventListener('click', () => { close(); navigate('detail', { viewId: asset!.id }); });
  sheet.querySelector('.dgv-sheet-unlink')!.addEventListener('click', () => void onUnlink(marker.id, close));
}

async function onUnlink(markerId: string, close: () => void): Promise<void> {
  if (!(await confirmDialog('לבטל את קישור הנכס לתרשים?', 'ביטול קישור'))) return;
  await deleteDiagramMarker(markerId);
  markers = markers.filter((m) => m.id !== markerId);
  close();
  await renderCanvas();
  toast('הקישור בוטל');
}

/* ---------- asset picker (search existing assets) ---------- */

function pickAssetModal(): Promise<Asset | null> {
  return new Promise((resolve) => {
    let settled = false;
    const wrap = document.createElement('div');
    wrap.className = 'asset-picker';
    wrap.innerHTML = `
      <h3>${icon('link')} קישור נכס לתרשים</h3>
      <input type="search" id="ap-q" class="filter-search" placeholder="חיפוש נכס (שם או מספר נכס)...">
      <div class="asset-picker-list" id="ap-list"></div>
    `;
    const close = showModal(wrap);
    const finish = (asset: Asset | null): void => { if (settled) return; settled = true; close(); resolve(asset); };
    wrap.closest('.modal-backdrop')?.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).classList.contains('modal-backdrop')) finish(null);
    });

    let all: Asset[] = [];
    const list = qs(wrap, '#ap-list');
    const render = (q: string): void => {
      const query = q.trim().toLowerCase();
      const rows = !query ? all : all.filter((a) =>
        a.name.toLowerCase().includes(query) || a.code.toLowerCase().includes(query));
      list.innerHTML = rows.length ? rows.map((a) => {
        const t = ASSET_TYPE_META[a.type];
        return `<button type="button" class="asset-picker-row" data-id="${a.id}">${icon(t.icon)} <span>${escapeHtml(a.name || t.label)}</span>${a.code ? `<span class="hint">#${escapeHtml(a.code)}</span>` : ''}</button>`;
      }).join('') : '<p class="hint">לא נמצאו נכסים.</p>';
    };

    void listAssets().then((assets) => { all = assets; render(''); });
    qs<HTMLInputElement>(wrap, '#ap-q').addEventListener('input', (e) => render((e.target as HTMLInputElement).value));
    list.addEventListener('click', (e) => {
      const row = (e.target as HTMLElement).closest<HTMLElement>('.asset-picker-row');
      if (!row) return;
      finish(all.find((a) => a.id === row.dataset.id) ?? null);
    });
  });
}

async function onDeleteDiagram(): Promise<void> {
  if (!diagramId) return;
  if (!(await confirmDialog('למחוק את התרשים? קישורי הנכסים אליו יימחקו גם הם. הפעולה אינה הפיכה.', 'מחיקה'))) return;
  await deleteDiagram(diagramId);
  toast('התרשים נמחק');
  navigate('diagrams');
}
