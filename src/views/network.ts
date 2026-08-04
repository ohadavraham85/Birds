/* views/network.ts — תרשים הרשת הראשי (Array): מפה אינטראקטיבית של לוחות/
 * תחנות כתאים ניתנים לגרירה, מחוברים בחיצים דינמיים שמתעדכנים בזמן אמת.
 * לחיצה על תא עם תרשים פנימי מקושר פותחת ישירות את התרשים הפנימי של אותו
 * לוח (התרשים חד-קווי + מראה לוח עם סיכות נכסים, views/diagram.ts). */

import {
  listLayoutNodes, saveLayoutNode, deleteLayoutNode,
  listLayoutEdges, saveLayoutEdge, deleteLayoutEdge,
  seedInitialLayoutIfEmpty, listDiagrams,
} from '../db/repository';
import { toast, confirmDialog, showModal } from '../lib/ui';
import { escapeHtml } from '../lib/markdown';
import { icon } from '../lib/icons';
import { qs, input, select } from '../lib/dom';
import { navigate, goBack } from '../main';
import type { LayoutNode, LayoutEdge, Diagram } from '../types';

let container: HTMLElement;
let nodes: LayoutNode[] = [];
let edges: LayoutEdge[] = [];
let diagramsById = new Map<string, Diagram>();
let scale = 1;

let connectMode = false;
let connectFromId: string | null = null;

interface DragState { id: string; startClientX: number; startClientY: number; startX: number; startY: number; moved: boolean }
let drag: DragState | null = null;

const NODE_W = 150;
const NODE_H = 76;
const CANVAS_PAD = 200;

export function init(el: HTMLElement): void {
  container = el;
  container.innerHTML = `
    <div class="form-head">
      <button type="button" class="btn btn-sm" id="net-back">→ חזרה</button>
      <h2>${icon('link')} תרשים רשת ראשי</h2>
    </div>
    <div class="diagram-toolbar" id="net-toolbar">
      <div class="diagram-page-tabs">
        <button type="button" class="btn btn-sm" id="net-add-node">${icon('plus')} תא חדש</button>
        <button type="button" class="btn btn-sm" id="net-connect-toggle">${icon('link')} מצב חיבור</button>
      </div>
    </div>
    <p class="hint" id="net-connect-hint" hidden>מצב חיבור פעיל — לחצו על תא ראשון ואז על תא שני כדי לחבר ביניהם. לחצו שוב על "מצב חיבור" ליציאה.</p>
    <div class="diagram-viewport" id="net-viewport">
      <div class="net-canvas" id="net-canvas"></div>
    </div>
    <p class="hint" id="net-empty" hidden>אין עדיין תאים בתרשים הרשת.</p>
    <div class="diagram-zoom-controls">
      <button type="button" class="btn btn-icon" id="net-zoom-in" title="הגדלה" aria-label="הגדלה">${icon('plus')}</button>
      <button type="button" class="btn btn-icon" id="net-zoom-out" title="הקטנה" aria-label="הקטנה">−</button>
      <button type="button" class="btn btn-icon" id="net-zoom-fit" title="איפוס זום" aria-label="איפוס זום">${icon('target')}</button>
    </div>
  `;
  qs(container, '#net-back').addEventListener('click', goBack);
  qs(container, '#net-add-node').addEventListener('click', () => void onAddNode());
  qs(container, '#net-connect-toggle').addEventListener('click', toggleConnectMode);
  qs(container, '#net-zoom-in').addEventListener('click', () => setScale(scale * 1.25));
  qs(container, '#net-zoom-out').addEventListener('click', () => setScale(scale / 1.25));
  qs(container, '#net-zoom-fit').addEventListener('click', () => setScale(1));

  window.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerup', onPointerUp);
}

export async function activate(): Promise<void> {
  connectMode = false;
  connectFromId = null;
  const seeded = await seedInitialLayoutIfEmpty();
  await loadAndRender();
  if (seeded) toast('נטענה פריסה ראשונית מהתרשים שהעלית — ניתן לגרור, לחבר ולערוך הכול', false, 5000);
}

export function deactivate(): void {
  drag = null;
}

async function loadAndRender(): Promise<void> {
  nodes = await listLayoutNodes();
  edges = await listLayoutEdges();
  const diagrams = await listDiagrams();
  diagramsById = new Map(diagrams.map((d) => [d.id, d]));
  render();
}

/* ---------- rendering ---------- */

function canvasSize(): { w: number; h: number } {
  const maxX = Math.max(0, ...nodes.map((n) => n.x + n.width));
  const maxY = Math.max(0, ...nodes.map((n) => n.y + n.height));
  return { w: Math.max(800, maxX + CANVAS_PAD), h: Math.max(500, maxY + CANVAS_PAD) };
}

function render(): void {
  qs<HTMLElement>(container, '#net-empty').hidden = nodes.length > 0;
  const { w, h } = canvasSize();
  const canvas = qs(container, '#net-canvas');
  canvas.style.width = `${w}px`;
  canvas.style.height = `${h}px`;
  canvas.style.transform = `scale(${scale})`;

  canvas.innerHTML = `
    <svg class="net-svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
      <defs>
        <marker id="net-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M0 0 L10 5 L0 10 Z" fill="var(--accent-700)"></path>
        </marker>
      </defs>
      ${edges.map(edgePath).join('')}
    </svg>
    ${nodes.map(nodeHtml).join('')}
  `;

  qs(container, '#net-connect-toggle').classList.toggle('active', connectMode);
  qs<HTMLElement>(container, '#net-connect-hint').hidden = !connectMode;

  canvas.querySelectorAll<HTMLElement>('.net-node').forEach((el) => {
    el.addEventListener('pointerdown', onNodePointerDown);
    const editBtn = el.querySelector<HTMLElement>('.net-node-edit-btn');
    editBtn?.addEventListener('pointerdown', (e) => e.stopPropagation());
    editBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      void openEditNodeModal(el.dataset.id!);
    });
  });
  canvas.querySelectorAll<SVGPathElement>('.net-edge-hit').forEach((el) => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      void onEdgeClick(el.dataset.id!);
    });
  });
}

function nodeRect(n: LayoutNode): { cx: number; cy: number } {
  return { cx: n.x + n.width / 2, cy: n.y + n.height / 2 };
}

/** Simple orthogonal (right-angle) connector between two node boxes, in the
 * schematic-diagram style of the source drawings — a 2-bend path along
 * whichever axis dominates, rather than a diagonal straight line. */
function edgePath(edge: LayoutEdge): string {
  const from = nodes.find((n) => n.id === edge.fromNodeId);
  const to = nodes.find((n) => n.id === edge.toNodeId);
  if (!from || !to) return '';
  const a = nodeRect(from);
  const b = nodeRect(to);
  const dx = b.cx - a.cx;
  const dy = b.cy - a.cy;

  let sx: number, sy: number, ex: number, ey: number, d: string;
  if (Math.abs(dx) >= Math.abs(dy)) {
    sx = dx >= 0 ? from.x + from.width : from.x;
    sy = a.cy;
    ex = dx >= 0 ? to.x : to.x + to.width;
    ey = b.cy;
    const midX = (sx + ex) / 2;
    d = `M ${sx} ${sy} L ${midX} ${sy} L ${midX} ${ey} L ${ex} ${ey}`;
  } else {
    sx = a.cx;
    sy = dy >= 0 ? from.y + from.height : from.y;
    ex = b.cx;
    ey = dy >= 0 ? to.y : to.y + to.height;
    const midY = (sy + ey) / 2;
    d = `M ${sx} ${sy} L ${sx} ${midY} L ${ex} ${midY} L ${ex} ${ey}`;
  }
  return `
    <path class="net-edge" d="${d}" marker-end="url(#net-arrow)"></path>
    <path class="net-edge-hit" data-id="${edge.id}" d="${d}"></path>`;
}

function nodeHtml(n: LayoutNode): string {
  const diagram = n.diagramId ? diagramsById.get(n.diagramId) : undefined;
  const linked = !!diagram;
  const isConnectFrom = connectMode && connectFromId === n.id;
  return `
    <div class="net-node${linked ? ' net-node-linked' : ''}${isConnectFrom ? ' net-node-connect-from' : ''}" data-id="${n.id}" style="left:${n.x}px;top:${n.y}px;width:${n.width}px;height:${n.height}px">
      <button type="button" class="net-node-edit-btn" title="עריכת תא" aria-label="עריכת תא">${icon('edit')}</button>
      <strong class="net-node-label">${escapeHtml(n.label)}</strong>
      ${n.subLabel ? `<span class="net-node-sub">${escapeHtml(n.subLabel)}</span>` : ''}
      <span class="net-node-link-hint">${linked ? `${icon('blueprint')} ${escapeHtml(diagram!.name)}` : `${icon('upload')} אין תרשים מקושר`}</span>
    </div>`;
}

/* ---------- zoom ---------- */

function setScale(next: number): void {
  scale = Math.min(3, Math.max(0.3, next));
  qs(container, '#net-canvas').style.transform = `scale(${scale})`;
}

/* ---------- drag to move / click to navigate or connect ---------- */

function onNodePointerDown(e: PointerEvent): void {
  const el = (e.currentTarget as HTMLElement);
  const id = el.dataset.id!;
  const n = nodes.find((x) => x.id === id);
  if (!n) return;
  drag = { id, startClientX: e.clientX, startClientY: e.clientY, startX: n.x, startY: n.y, moved: false };
}

function onPointerMove(e: PointerEvent): void {
  if (!drag) return;
  const dx = (e.clientX - drag.startClientX) / scale;
  const dy = (e.clientY - drag.startClientY) / scale;
  if (!drag.moved && Math.hypot(dx, dy) < 4) return;
  drag.moved = true;
  const n = nodes.find((x) => x.id === drag!.id);
  if (!n) return;
  n.x = Math.max(0, drag.startX + dx);
  n.y = Math.max(0, drag.startY + dy);
  const el = container.querySelector<HTMLElement>(`.net-node[data-id="${n.id}"]`);
  if (el) { el.style.left = `${n.x}px`; el.style.top = `${n.y}px`; }
  redrawEdges();
}

function redrawEdges(): void {
  const svg = container.querySelector<SVGSVGElement>('.net-svg');
  if (!svg) return;
  const defs = svg.querySelector('defs')?.outerHTML ?? '';
  svg.innerHTML = defs + edges.map(edgePath).join('');
  svg.querySelectorAll<SVGPathElement>('.net-edge-hit').forEach((el) => {
    el.addEventListener('click', (e) => { e.stopPropagation(); void onEdgeClick(el.dataset.id!); });
  });
}

async function onPointerUp(): Promise<void> {
  if (!drag) return;
  const { id, moved } = drag;
  drag = null;
  const n = nodes.find((x) => x.id === id);
  if (!n) return;
  if (moved) {
    await saveLayoutNode(n);
    return;
  }
  await onNodeClick(id);
}

async function onNodeClick(id: string): Promise<void> {
  if (connectMode) {
    if (!connectFromId) {
      connectFromId = id;
      render();
      return;
    }
    if (connectFromId !== id) {
      await saveLayoutEdge({ id: crypto.randomUUID(), fromNodeId: connectFromId, toNodeId: id, deleted: false, updatedAt: '' });
      edges = await listLayoutEdges();
    }
    connectFromId = id;
    render();
    return;
  }

  const n = nodes.find((x) => x.id === id);
  if (!n) return;
  if (n.diagramId) { navigate('diagram', { viewId: n.diagramId }); return; }
  await openEditNodeModal(id);
}

function toggleConnectMode(): void {
  connectMode = !connectMode;
  connectFromId = null;
  render();
}

async function onEdgeClick(edgeId: string): Promise<void> {
  if (!(await confirmDialog('למחוק את החיבור הזה?', 'מחיקה'))) return;
  await deleteLayoutEdge(edgeId);
  edges = await listLayoutEdges();
  redrawEdges();
  toast('החיבור נמחק');
}

/* ---------- add node ---------- */

async function onAddNode(): Promise<void> {
  const wrap = document.createElement('div');
  wrap.innerHTML = `
    <h3>${icon('plus')} תא חדש</h3>
    <div class="field"><label for="net-new-label">שם הלוח/תחנה</label><input type="text" id="net-new-label" placeholder="למשל: EB8"></div>
    <div class="field"><label for="net-new-sub">תת-כותרת (אופציונלי)</label><input type="text" id="net-new-sub" placeholder="למשל: Building 90"></div>
    <div class="modal-actions">
      <button type="button" class="btn btn-primary" id="net-new-save">${icon('save')} הוספה</button>
      <button type="button" class="btn" id="net-new-cancel">ביטול</button>
    </div>
  `;
  const close = showModal(wrap);
  qs(wrap, '#net-new-cancel').addEventListener('click', close);
  qs(wrap, '#net-new-save').addEventListener('click', () => void save());

  async function save(): Promise<void> {
    const label = input(wrap, '#net-new-label').value.trim();
    if (!label) { toast('יש להזין שם', true); return; }
    const sub = input(wrap, '#net-new-sub').value.trim();
    const { w } = canvasSize();
    const node = await saveLayoutNode({
      id: crypto.randomUUID(), label, subLabel: sub || undefined,
      x: Math.min(w - NODE_W - CANVAS_PAD, 40 + (nodes.length % 5) * 40),
      y: 60 + Math.floor(nodes.length / 5) * 40,
      width: NODE_W, height: NODE_H, deleted: false, updatedAt: '',
    });
    nodes = [...nodes, node];
    close();
    render();
  }
}

/* ---------- edit node (label / sub-label / linked diagram / delete) ---------- */

async function openEditNodeModal(nodeId: string): Promise<void> {
  const n = nodes.find((x) => x.id === nodeId);
  if (!n) return;
  const diagrams = await listDiagrams();

  const wrap = document.createElement('div');
  wrap.innerHTML = `
    <h3>${icon('edit')} עריכת תא</h3>
    <div class="field"><label for="net-edit-label">שם הלוח/תחנה</label><input type="text" id="net-edit-label" value="${escapeHtml(n.label)}"></div>
    <div class="field"><label for="net-edit-sub">תת-כותרת</label><input type="text" id="net-edit-sub" value="${escapeHtml(n.subLabel ?? '')}"></div>
    <div class="field">
      <label for="net-edit-diagram">תרשים פנימי מקושר</label>
      <select id="net-edit-diagram">
        <option value="">— ללא —</option>
        ${diagrams.map((d) => `<option value="${d.id}" ${d.id === n.diagramId ? 'selected' : ''}>${escapeHtml(d.name)}</option>`).join('')}
      </select>
    </div>
    <div class="modal-actions">
      <button type="button" class="btn btn-primary" id="net-edit-save">${icon('save')} שמירה</button>
      <button type="button" class="btn" id="net-edit-open-diagrams">${icon('blueprint')} ניהול תרשימים</button>
      <button type="button" class="btn btn-danger" id="net-edit-delete">${icon('trash')} מחיקת תא</button>
    </div>
  `;
  const close = showModal(wrap);
  qs(wrap, '#net-edit-save').addEventListener('click', () => void saveEdit());
  qs(wrap, '#net-edit-open-diagrams').addEventListener('click', () => { close(); navigate('diagrams'); });
  qs(wrap, '#net-edit-delete').addEventListener('click', () => void onDelete());

  async function saveEdit(): Promise<void> {
    n!.label = input(wrap, '#net-edit-label').value.trim() || n!.label;
    n!.subLabel = input(wrap, '#net-edit-sub').value.trim() || undefined;
    const diagramId = select(wrap, '#net-edit-diagram').value;
    n!.diagramId = diagramId || undefined;
    await saveLayoutNode(n!);
    close();
    await loadAndRender();
  }

  async function onDelete(): Promise<void> {
    if (!(await confirmDialog(`למחוק את התא "${n!.label}"? כל החיבורים אליו יימחקו גם הם.`, 'מחיקה'))) return;
    await deleteLayoutNode(n!.id);
    close();
    await loadAndRender();
    toast('התא נמחק');
  }
}
