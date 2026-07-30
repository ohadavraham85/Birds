/* views/diagrams.ts — מסך תרשימים: רשימת תרשימי לוחות/מתקנים שהועלו
 * (תרשים חד קווי + מראה לוח), עם אפשרות להוספת תרשים חדש (מקובץ תמונה או
 * עמוד נבחר מתוך PDF). לחיצה על תרשים פותחת את מסך הצפייה/קישור הנכסים. */

import { listDiagrams, deleteDiagram, saveDiagram, saveDiagramMedia, listMarkersForDiagram } from '../db/repository';
import { getDiagramPageObjectUrl } from '../lib/media';
import { pickDiagramSheet, type PickedSheet } from '../lib/diagram-upload';
import { DIAGRAM_PAGE_KIND_META } from '../lib/diagram-meta';
import { toast, confirmDialog, showModal } from '../lib/ui';
import { escapeHtml } from '../lib/markdown';
import { icon } from '../lib/icons';
import { qs, input } from '../lib/dom';
import { navigate } from '../main';
import { DIAGRAM_PAGE_KINDS } from '../types';
import type { Diagram, DiagramPageKind } from '../types';

let container: HTMLElement;

export function init(el: HTMLElement): void {
  container = el;
  container.innerHTML = `
    <div class="table-toolbar">
      <h2 style="margin:0">${icon('blueprint')} תרשימים</h2>
      <span class="spacer"></span>
      <button class="btn btn-sm btn-primary" id="diagram-add-btn">${icon('plus')} תרשים חדש</button>
    </div>
    <p class="hint">תרשים חד קווי ומראה לוח, עם קישור נכסים קיימים לתאים שבתרשים.</p>
    <div class="diagram-grid" id="diagram-grid"></div>
    <p id="diagram-empty" class="hint" hidden>אין עדיין תרשימים. הוסיפו תרשים כדי להתחיל לקשר אליו נכסים.</p>
  `;
  qs(container, '#diagram-add-btn').addEventListener('click', () => void openCreateDiagramModal());
  qs(container, '#diagram-grid').addEventListener('click', (e) => void onGridClick(e));
}

async function cardHtml(d: Diagram): Promise<string> {
  const cover = d.pages.find((p) => p.kind === 'one-line') ?? d.pages[0];
  const url = cover ? await getDiagramPageObjectUrl(cover.localId) : null;
  const markerCount = (await listMarkersForDiagram(d.id)).length;
  const kinds = new Set(d.pages.map((p) => p.kind));
  return `
    <div class="diagram-card" data-id="${d.id}">
      <div class="diagram-card-thumb">${url ? `<img src="${url}" alt="">` : icon('blueprint', 'icon-lg')}</div>
      <div class="diagram-card-body">
        <strong>${escapeHtml(d.name)}</strong>
        <div class="diagram-card-badges">
          ${DIAGRAM_PAGE_KINDS.map((k) => `<span class="badge-soft${kinds.has(k) ? '' : ' badge-missing'}">${DIAGRAM_PAGE_KIND_META[k].shortLabel}</span>`).join('')}
        </div>
        <span class="hint">${markerCount ? `${markerCount} נכסים מקושרים` : 'אין עדיין נכסים מקושרים'}</span>
      </div>
      <button type="button" class="btn btn-icon diagram-card-del" data-id="${d.id}" title="מחיקת תרשים" aria-label="מחיקת תרשים">${icon('trash')}</button>
    </div>`;
}

export async function activate(): Promise<void> {
  const diagrams = await listDiagrams();
  const grid = qs(container, '#diagram-grid');
  qs<HTMLElement>(container, '#diagram-empty').hidden = diagrams.length > 0;
  grid.innerHTML = (await Promise.all(diagrams.map(cardHtml))).join('');
}

async function onGridClick(e: Event): Promise<void> {
  const target = e.target as HTMLElement;
  const delBtn = target.closest<HTMLElement>('.diagram-card-del');
  if (delBtn) {
    if (!(await confirmDialog('למחוק את התרשים? קישורי הנכסים אליו יימחקו גם הם. הפעולה אינה הפיכה.', 'מחיקה'))) return;
    await deleteDiagram(delBtn.dataset.id!);
    toast('התרשים נמחק');
    await activate();
    return;
  }
  const card = target.closest<HTMLElement>('.diagram-card');
  if (card) navigate('diagram', { viewId: card.dataset.id! });
}

/* ---------- create-diagram modal ---------- */

function slotHtml(kind: DiagramPageKind, picked: PickedSheet | null): string {
  const meta = DIAGRAM_PAGE_KIND_META[kind];
  const previewUrl = picked ? URL.createObjectURL(picked.blob) : null;
  return `
    <div class="diagram-upload-slot" data-kind="${kind}">
      <span class="diagram-upload-slot-label">${meta.label}</span>
      <div class="diagram-upload-slot-body">
        ${previewUrl ? `<img src="${previewUrl}" alt="">` : `<span class="hint">${icon('upload')} לא נבחר קובץ</span>`}
      </div>
      <button type="button" class="btn btn-sm diagram-upload-slot-btn" data-kind="${kind}">${picked ? 'החלפת קובץ' : 'בחירת קובץ (תמונה או PDF)'}</button>
    </div>`;
}

async function openCreateDiagramModal(): Promise<void> {
  const draft: Partial<Record<DiagramPageKind, PickedSheet>> = {};

  const wrap = document.createElement('div');
  wrap.innerHTML = `
    <h3>${icon('blueprint')} תרשים חדש</h3>
    <div class="field"><label for="dg-name">שם התרשים</label><input type="text" id="dg-name" placeholder='למשל: מטש אוג — Building 83 — F400-36'></div>
    <div class="diagram-upload-slots" id="dg-slots"></div>
    <div class="modal-actions">
      <button type="button" class="btn btn-primary" id="dg-save">${icon('save')} שמירה</button>
      <button type="button" class="btn" id="dg-cancel">ביטול</button>
    </div>
  `;
  const close = showModal(wrap);

  function renderSlots(): void {
    qs(wrap, '#dg-slots').innerHTML = DIAGRAM_PAGE_KINDS.map((k) => slotHtml(k, draft[k] ?? null)).join('');
  }
  renderSlots();

  qs(wrap, '#dg-slots').addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLElement>('.diagram-upload-slot-btn');
    if (!btn) return;
    const kind = btn.dataset.kind as DiagramPageKind;
    void (async () => {
      const picked = await pickDiagramSheet();
      if (picked) { draft[kind] = picked; renderSlots(); }
    })();
  });

  qs(wrap, '#dg-cancel').addEventListener('click', close);
  qs(wrap, '#dg-save').addEventListener('click', () => void onSave());

  async function onSave(): Promise<void> {
    const name = input(wrap, '#dg-name').value.trim();
    if (!name) { toast('יש להזין שם לתרשים', true); return; }
    const kinds = DIAGRAM_PAGE_KINDS.filter((k) => draft[k]);
    if (!kinds.length) { toast('יש להעלות לפחות עמוד אחד', true); return; }

    const pages = await Promise.all(kinds.map(async (kind) => {
      const picked = draft[kind]!;
      const localId = crypto.randomUUID();
      await saveDiagramMedia({ id: localId, mime: 'image/png', blob: picked.blob });
      return { id: crypto.randomUUID(), kind, localId, width: picked.width, height: picked.height };
    }));

    const diagram = await saveDiagram({ id: crypto.randomUUID(), name, pages, deleted: false, updatedAt: '' });
    close();
    toast('התרשים נוסף ✓');
    navigate('diagram', { viewId: diagram.id });
  }
}
