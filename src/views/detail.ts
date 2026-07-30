/* views/detail.ts — מסך פרטי נכס: תצוגה מלאה (כולל גלריית תמונות) ויומן
 * תחזוקה עם הוספת רשומות חדשות. */

import { getAsset, deleteAsset, listMaintenanceForAsset, saveMaintenance, deleteMaintenance } from '../db/repository';
import { toast, confirmDialog, showImageModal } from '../lib/ui';
import { escapeHtml } from '../lib/markdown';
import { getImageObjectUrl } from '../lib/media';
import { ASSET_TYPE_META, ASSET_STATUS_META, VOLTAGE_META } from '../lib/asset-meta';
import { icon } from '../lib/icons';
import { qs, input } from '../lib/dom';
import { navigate, goBack } from '../main';
import type { ViewParams } from './view';
import type { Asset, MaintenanceLog } from '../types';

let container: HTMLElement;
let viewId: string | null = null;
let current: Asset | null = null;

export function init(el: HTMLElement): void {
  container = el;
  container.innerHTML = `
    <div class="form-head">
      <button type="button" class="btn btn-sm" id="detail-back">→ חזרה</button>
      <h2>פרטי נכס</h2>
    </div>
    <div id="detail-body"></div>
  `;
  qs(container, '#detail-back').addEventListener('click', goBack);
}

export function setParams(params: ViewParams): void {
  viewId = params?.viewId || null;
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

async function assetHtml(a: Asset): Promise<string> {
  const t = ASSET_TYPE_META[a.type];
  const s = ASSET_STATUS_META[a.status];
  const photos = await Promise.all((a.images ?? []).map(async (img) => ({ img, url: await getImageObjectUrl(img) })));
  const logs = await listMaintenanceForAsset(a.id);

  return `
    <div class="settings-card">
      <h3>${icon(t.icon)} ${escapeHtml(a.name || t.label)}</h3>
      <span class="status-badge" style="background:${s.color}">${s.label}</span>
      <p class="hint">${t.label} · ${VOLTAGE_META[a.voltage].label}${a.code ? ` · #${escapeHtml(a.code)}` : ''}</p>
      ${a.address ? `<p>${icon('pin')} ${escapeHtml(a.address)}</p>` : ''}
      ${a.lat != null && a.lng != null ? `<p class="hint" dir="ltr">${a.lat.toFixed(5)}, ${a.lng.toFixed(5)}</p>` : ''}
      ${a.installDate ? `<p>${icon('clock')} הותקן: ${escapeHtml(a.installDate)}</p>` : ''}
      ${a.notes ? `<p>${escapeHtml(a.notes)}</p>` : ''}
      ${photos.length ? `<div class="photo-grid">${photos.map((p) => p.url ? `<div class="photo-cell"><img src="${p.url}" alt="" data-full="${p.url}"></div>` : '').join('')}</div>` : ''}
      <div class="detail-actions">
        <button class="btn btn-primary" id="detail-edit">${icon('edit')} עריכה</button>
        <button class="btn btn-danger" id="detail-delete">${icon('trash')} מחיקת נכס</button>
      </div>
    </div>

    <div class="settings-card">
      <h3>${icon('wrench')} יומן תחזוקה</h3>
      <div class="maint-list" id="maint-list">
        ${logs.length ? logs.map((l) => maintRowHtml(l)).join('') : '<p class="hint">אין עדיין רשומות תחזוקה.</p>'}
      </div>
      <div class="field-group" style="margin-top:12px">
        <div class="row-2">
          <div class="field"><label for="m-date">תאריך</label><input type="date" id="m-date" value="${todayIso()}"></div>
          <div class="field"><label for="m-tech">איש תחזוקה</label><input type="text" id="m-tech" placeholder="שם / חברה"></div>
        </div>
        <div class="field"><label for="m-desc">תיאור הטיפול</label><textarea id="m-desc" rows="3" placeholder="מה בוצע..."></textarea></div>
        <button type="button" class="btn btn-primary" id="m-add">${icon('plus')} הוספת רשומת תחזוקה</button>
      </div>
    </div>
  `;
}

function maintRowHtml(l: MaintenanceLog): string {
  return `
    <div class="maint-row" data-id="${l.id}">
      <div class="maint-row-main">
        <strong>${escapeHtml(l.date)}</strong>
        <span class="hint">${l.technician ? escapeHtml(l.technician) : ''}</span>
      </div>
      ${l.description ? `<p>${escapeHtml(l.description)}</p>` : ''}
      <button type="button" class="btn btn-icon maint-del" data-id="${l.id}" title="מחיקה" aria-label="מחיקה">${icon('trash')}</button>
    </div>`;
}

export async function activate(): Promise<void> {
  const body = qs(container, '#detail-body');
  current = viewId ? (await getAsset(viewId)) || null : null;
  if (!current) {
    body.innerHTML = '<p style="color:var(--ink-soft)">הנכס לא נמצא — ייתכן שנמחק.</p>';
    return;
  }
  body.innerHTML = await assetHtml(current);
  wire(body);
}

function wire(body: HTMLElement): void {
  body.querySelector('#detail-edit')?.addEventListener('click', () => { if (current) navigate('form', { editId: current.id }); });
  body.querySelector('#detail-delete')?.addEventListener('click', () => void onDeleteAsset());
  body.querySelector('#m-add')?.addEventListener('click', () => void onAddMaintenance());
  body.querySelector('#maint-list')?.addEventListener('click', (e) => void onMaintListClick(e));
  body.querySelectorAll<HTMLImageElement>('.photo-cell img').forEach((img) => {
    img.addEventListener('click', () => showImageModal(img.dataset.full || img.src));
  });
}

async function onAddMaintenance(): Promise<void> {
  if (!current) return;
  const date = input(container, '#m-date').value || todayIso();
  const technician = input(container, '#m-tech').value.trim();
  const description = (container.querySelector<HTMLTextAreaElement>('#m-desc')!).value.trim();
  await saveMaintenance({
    id: crypto.randomUUID(), assetId: current.id, date, description, technician: technician || undefined,
    deleted: false, updatedAt: '',
  });
  toast('רשומת התחזוקה נוספה ✓');
  await activate();
}

async function onMaintListClick(e: Event): Promise<void> {
  const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('.maint-del');
  if (!btn) return;
  if (!(await confirmDialog('למחוק את רשומת התחזוקה?', 'מחיקה'))) return;
  await deleteMaintenance(btn.dataset.id!);
  toast('הרשומה נמחקה');
  await activate();
}

async function onDeleteAsset(): Promise<void> {
  if (!current) return;
  if (!(await confirmDialog('למחוק את הנכס? הפעולה אינה הפיכה.', 'מחיקה'))) return;
  await deleteAsset(current.id);
  toast('הנכס נמחק');
  navigate('list');
}
