/* views/form.ts — טופס הוספה/עריכה של נכס חשמל: קוד/שם, סוג, סטטוס, מתח,
 * מיקום (ידני / בחירה על המפה / GPS נוכחי), כתובת, תאריך התקנה, הערות ותמונות. */

import { qs, input, select } from '../lib/dom';
import { toast, confirmDialog } from '../lib/ui';
import { icon } from '../lib/icons';
import { pickLocation } from '../lib/location-picker';
import { getImageObjectUrl } from '../lib/media';
import { ASSET_TYPE_META, ASSET_STATUS_META, VOLTAGE_META } from '../lib/asset-meta';
import { ASSET_TYPES, ASSET_STATUSES, VOLTAGE_LEVELS } from '../types';
import type { Asset, AssetImage, AssetType, AssetStatus, VoltageLevel } from '../types';
import { getAsset, saveAsset, deleteAsset, saveMedia, mediaForAsset, deleteMedia } from '../db/repository';
import { navigate, goBack } from '../main';
import type { ViewParams } from './view';

let container: HTMLElement;
let assetId = '';
let isEditing = false;
let images: AssetImage[] = [];
let initialLat: number | null = null;
let initialLng: number | null = null;

export function init(el: HTMLElement): void {
  container = el;
}

export function setParams(params: ViewParams): void {
  isEditing = !!params.editId;
  assetId = params.editId ?? crypto.randomUUID();
  initialLat = params.lat ?? null;
  initialLng = params.lng ?? null;
}

function optionsHtml<T extends string>(values: readonly T[], meta: Record<T, { label: string }>, selected: T): string {
  return values.map((v) => `<option value="${v}" ${v === selected ? 'selected' : ''}>${meta[v].label}</option>`).join('');
}

function render(asset: Asset | null): void {
  const a: Asset = asset ?? {
    id: assetId, code: '', name: '', type: 'pole', status: 'active', voltage: 'low',
    lat: initialLat, lng: initialLng, address: '', installDate: null, lastMaintenanceDate: null,
    notes: '', images: [], deleted: false, updatedAt: '',
  };
  images = a.images ?? [];

  container.innerHTML = `
    <div class="form-head">
      <button type="button" class="btn btn-sm" id="f-back">→ חזרה</button>
      <h2>${isEditing ? 'עריכת נכס' : 'נכס חדש'}</h2>
    </div>
    <form id="asset-form">
      <div class="field-group">
        <div class="row-2">
          <div class="field"><label for="f-code">מספר/תג נכס</label><input type="text" id="f-code" value="${escAttr(a.code)}"></div>
          <div class="field"><label for="f-name">שם / תיאור</label><input type="text" id="f-name" value="${escAttr(a.name)}" placeholder="לדוגמה: עמוד תאורה — רח' הרצל 12"></div>
        </div>
        <div class="row-2">
          <div class="field"><label for="f-type">סוג נכס</label>
            <select id="f-type">${optionsHtml(ASSET_TYPES, ASSET_TYPE_META, a.type)}</select>
          </div>
          <div class="field"><label for="f-voltage">רמת מתח</label>
            <select id="f-voltage">${optionsHtml(VOLTAGE_LEVELS, VOLTAGE_META, a.voltage)}</select>
          </div>
        </div>
        <div class="field"><label for="f-status">סטטוס</label>
          <select id="f-status">${optionsHtml(ASSET_STATUSES, ASSET_STATUS_META, a.status)}</select>
        </div>
      </div>

      <div class="field-group">
        <label>מיקום</label>
        <div class="row-2">
          <div class="field"><label for="f-lat">קו רוחב</label><input type="number" step="any" id="f-lat" value="${a.lat ?? ''}"></div>
          <div class="field"><label for="f-lng">קו אורך</label><input type="number" step="any" id="f-lng" value="${a.lng ?? ''}"></div>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button type="button" class="btn location-pin-btn" id="f-pick-map">${icon('pin')} בחירת מיקום על המפה</button>
          <button type="button" class="btn" id="f-pick-gps">${icon('target')} מיקום נוכחי (GPS)</button>
        </div>
        <div class="field"><label for="f-address">כתובת</label><input type="text" id="f-address" value="${escAttr(a.address ?? '')}"></div>
      </div>

      <div class="field-group">
        <div class="field"><label for="f-install-date">תאריך התקנה</label><input type="date" id="f-install-date" value="${a.installDate ?? ''}"></div>
        <div class="field"><label for="f-notes">הערות</label><textarea id="f-notes" rows="4">${escText(a.notes)}</textarea></div>
      </div>

      <div class="field-group">
        <label>תמונות</label>
        <label class="btn" style="cursor:pointer;width:fit-content">${icon('camera')} הוספת תמונות
          <input type="file" id="f-photos" accept="image/*" multiple hidden>
        </label>
        <div class="photo-grid" id="f-photo-grid"></div>
      </div>

      <div class="form-actions">
        <button type="submit" class="btn btn-primary btn-block">${icon('save')} שמירה</button>
        ${isEditing ? `<button type="button" class="btn btn-danger" id="f-delete">${icon('trash')} מחיקת נכס</button>` : ''}
      </div>
    </form>
  `;

  qs(container, '#f-back').addEventListener('click', () => goBack());
  qs(container, '#asset-form').addEventListener('submit', (e) => { e.preventDefault(); void onSubmit(); });
  qs(container, '#f-pick-map').addEventListener('click', () => void onPickMap());
  qs(container, '#f-pick-gps').addEventListener('click', onPickGps);
  input(container, '#f-photos').addEventListener('change', (e) => void onPhotosChosen(e));
  container.querySelector('#f-delete')?.addEventListener('click', () => void onDelete());
  void renderPhotoGrid();
}

function escAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}
function escText(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
}

async function renderPhotoGrid(): Promise<void> {
  const grid = container.querySelector<HTMLElement>('#f-photo-grid');
  if (!grid) return;
  if (!images.length) { grid.innerHTML = '<p class="hint">אין תמונות עדיין.</p>'; return; }
  const cells = await Promise.all(images.map(async (img) => {
    const url = await getImageObjectUrl(img);
    return `<div class="photo-cell" data-id="${img.localId}">
      ${url ? `<img src="${url}" alt="">` : '<div class="photo-missing"></div>'}
      <button type="button" class="btn btn-icon photo-remove" data-id="${img.localId}" title="הסרה" aria-label="הסרה">✕</button>
    </div>`;
  }));
  grid.innerHTML = cells.join('');
  grid.querySelectorAll<HTMLButtonElement>('.photo-remove').forEach((btn) => {
    btn.addEventListener('click', () => void onRemovePhoto(btn.dataset.id!));
  });
}

async function onPhotosChosen(e: Event): Promise<void> {
  const fileInput = e.target as HTMLInputElement;
  const files = fileInput.files;
  if (files) {
    for (const file of Array.from(files)) {
      const localId = crypto.randomUUID();
      await saveMedia({ id: localId, assetId, name: file.name, mime: file.type, blob: file });
      images.push({ localId, name: file.name });
    }
  }
  fileInput.value = '';
  await renderPhotoGrid();
}

async function onRemovePhoto(localId: string): Promise<void> {
  images = images.filter((i) => i.localId !== localId);
  await deleteMedia(localId);
  await renderPhotoGrid();
}

async function onPickMap(): Promise<void> {
  const latInp = input(container, '#f-lat');
  const lngInp = input(container, '#f-lng');
  const initial = latInp.value && lngInp.value ? { lat: +latInp.value, lng: +lngInp.value } : null;
  const result = await pickLocation(initial);
  if (result) { latInp.value = String(result.lat); lngInp.value = String(result.lng); }
}

function onPickGps(): void {
  if (!navigator.geolocation) { toast('מיקום GPS אינו זמין במכשיר זה', true); return; }
  toast('מאתר מיקום...');
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      input(container, '#f-lat').value = String(+pos.coords.latitude.toFixed(6));
      input(container, '#f-lng').value = String(+pos.coords.longitude.toFixed(6));
      toast('המיקום עודכן ✓');
    },
    () => toast('לא ניתן לאתר מיקום', true),
    { enableHighAccuracy: true },
  );
}

async function onSubmit(): Promise<void> {
  const name = input(container, '#f-name').value.trim();
  const code = input(container, '#f-code').value.trim();
  if (!name && !code) { toast('יש להזין שם או מספר נכס', true); return; }

  const latRaw = input(container, '#f-lat').value;
  const lngRaw = input(container, '#f-lng').value;
  const existing = isEditing ? await getAsset(assetId) : null;

  const asset: Asset = {
    id: assetId,
    code,
    name,
    type: select(container, '#f-type').value as AssetType,
    status: select(container, '#f-status').value as AssetStatus,
    voltage: select(container, '#f-voltage').value as VoltageLevel,
    lat: latRaw ? +latRaw : null,
    lng: lngRaw ? +lngRaw : null,
    address: input(container, '#f-address').value.trim(),
    installDate: input(container, '#f-install-date').value || null,
    lastMaintenanceDate: existing?.lastMaintenanceDate ?? null,
    notes: (container.querySelector<HTMLTextAreaElement>('#f-notes')!).value,
    images,
    deleted: false,
    updatedAt: '',
  };
  await saveAsset(asset);
  toast(isEditing ? 'הנכס עודכן ✓' : 'הנכס נשמר ✓');
  navigate('detail', { viewId: asset.id });
}

async function onDelete(): Promise<void> {
  if (!(await confirmDialog('למחוק את הנכס? הפעולה אינה הפיכה.', 'מחיקה'))) return;
  await deleteAsset(assetId);
  toast('הנכס נמחק');
  navigate('list');
}

export async function activate(): Promise<void> {
  const asset = isEditing ? (await getAsset(assetId)) ?? null : null;
  if (!isEditing) {
    images = (await mediaForAsset(assetId)).map((m) => ({ localId: m.id, name: m.name }));
  }
  render(asset);
}
