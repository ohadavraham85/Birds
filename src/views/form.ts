/* views/form.ts — טופס הדיווח האחוד: מסך אחד רציף (תאריך, מיקום + GPS, פרויקט,
 * מין מרשימת המאסטר עם חיפוש והשלמה, כמות, תמונות באיכות מקור, הערות). */

import {
  saveObservation, getObservation, listObservations, listSpecies,
  saveMedia, mediaForObservation, deleteMedia,
} from '../db/repository';
import { toast, toLocalInputValue, fromLocalInputValue } from '../lib/ui';
import { escapeHtml } from '../lib/markdown';
import { getImageObjectUrl } from '../lib/media';
import { qs, input } from '../lib/dom';
import type { ViewParams } from './view';
import type { Observation, ObservationImage } from '../types';

interface PendingImage { id: string; file: File; url: string }

let container: HTMLElement;
let speciesCache: string[] = [];
let pendingImages: PendingImage[] = [];
let editId: string | null = null;
let editKeptImages: ObservationImage[] = [];
let prefillSpecies: string | null = null;

export function init(el: HTMLElement): void {
  container = el;
  container.innerHTML = `
    <h2 id="form-title">תצפית חדשה</h2>
    <form id="obs-form" autocomplete="off">
      <div class="row-2">
        <div class="field">
          <label for="f-datetime">תאריך ושעה</label>
          <input type="datetime-local" id="f-datetime" required>
        </div>
        <div class="field">
          <label for="f-project">פרויקט</label>
          <input type="text" id="f-project" placeholder='למשל: "קינון חיוויאים 2026"' list="project-list">
          <datalist id="project-list"></datalist>
        </div>
      </div>

      <div class="field">
        <label for="f-location">מיקום <span class="hint">(שם האתר)</span></label>
        <input type="text" id="f-location" placeholder='למשל: "בריכות דגים", "נחל שחל"'>
      </div>

      <div class="field">
        <label>קואורדינטות <span class="hint" id="gps-status"></span></label>
        <div class="coords-row">
          <input type="number" step="any" id="f-lat" placeholder="קו רוחב (Lat)" inputmode="decimal">
          <input type="number" step="any" id="f-lng" placeholder="קו אורך (Lng)" inputmode="decimal">
          <button type="button" class="btn btn-icon" id="gps-btn" title="עדכון מיקום GPS">📍</button>
        </div>
      </div>

      <div class="field combo">
        <label for="f-species">מין הציפור <span class="hint">(בחירה מרשימת המינים בלבד)</span></label>
        <input type="text" id="f-species" placeholder="הקלידו לחיפוש מהיר..." required>
        <div class="combo-list" id="species-list" hidden></div>
      </div>

      <div class="field">
        <label for="f-quantity">מספר פרטים</label>
        <input type="number" id="f-quantity" min="1" step="1" value="1" inputmode="numeric">
      </div>

      <div class="field">
        <label>תמונות תצפית <span class="hint">(נשמרות באיכות מקור מלאה, ללא כיווץ)</span></label>
        <div class="img-inputs">
          <button type="button" class="btn" id="btn-camera">📷 צילום מהמצלמה</button>
          <button type="button" class="btn" id="btn-gallery">🖼️ העלאה מהגלריה</button>
          <input type="file" id="f-camera" accept="image/*" capture="environment" hidden>
          <input type="file" id="f-gallery" accept="image/*,.heic,.tif,.tiff" multiple hidden>
        </div>
        <div class="img-previews" id="img-previews"></div>
      </div>

      <div class="field">
        <label for="f-notes">הערות <span class="hint">(פסקאות וירידות שורה נשמרות; אפשר Markdown: **הדגשה**, # כותרת, - רשימה)</span></label>
        <textarea id="f-notes" placeholder="סיכום שטח מפורט..."></textarea>
      </div>

      <button type="submit" class="btn btn-primary btn-block" id="save-btn">💾 שמירת התצפית</button>
      <button type="button" class="btn btn-block" id="cancel-edit-btn" hidden style="margin-top:8px">ביטול עריכה</button>
    </form>
  `;

  setupSpeciesCombo();
  setupImages();
  setupGps();
  qs<HTMLFormElement>(container, '#obs-form').addEventListener('submit', (e) => void onSave(e));
  qs(container, '#cancel-edit-btn').addEventListener('click', () => resetForm());
}

export function setParams(params: ViewParams): void {
  editId = params?.editId || null;
  prefillSpecies = params?.species || null;
}

export async function activate(): Promise<void> {
  speciesCache = await listSpecies();
  await fillProjectSuggestions();
  if (editId) {
    await loadForEdit(editId);
  } else if (prefillSpecies) {
    resetForm();
    input(container, '#f-species').value = prefillSpecies;
    prefillSpecies = null;
  } else if (!input(container, '#f-datetime').value) {
    resetForm();
  }
}

function resetForm(): void {
  editId = null;
  editKeptImages = [];
  pendingImages.forEach((p) => URL.revokeObjectURL(p.url));
  pendingImages = [];
  qs<HTMLFormElement>(container, '#obs-form').reset();
  input(container, '#f-datetime').value = toLocalInputValue();
  input(container, '#f-quantity').value = '1';
  qs(container, '#form-title').textContent = 'תצפית חדשה';
  qs(container, '#save-btn').textContent = '💾 שמירת התצפית';
  qs(container, '#cancel-edit-btn').hidden = true;
  void renderPreviews();
  autoFillGps(false);
}

async function loadForEdit(id: string): Promise<void> {
  const obs = await getObservation(id);
  if (!obs) { resetForm(); return; }
  qs(container, '#form-title').textContent = 'עריכת תצפית';
  qs(container, '#save-btn').textContent = '💾 עדכון התצפית';
  qs(container, '#cancel-edit-btn').hidden = false;
  input(container, '#f-datetime').value = toLocalInputValue(new Date(obs.dateTime));
  input(container, '#f-location').value = obs.locationName || '';
  input(container, '#f-project').value = obs.project || '';
  input(container, '#f-lat').value = obs.lat == null ? '' : String(obs.lat);
  input(container, '#f-lng').value = obs.lng == null ? '' : String(obs.lng);
  input(container, '#f-species').value = obs.species || '';
  input(container, '#f-quantity').value = String(obs.quantity ?? 1);
  qs<HTMLTextAreaElement>(container, '#f-notes').value = obs.notes || '';
  editKeptImages = [...(obs.images || [])];
  pendingImages.forEach((p) => URL.revokeObjectURL(p.url));
  pendingImages = [];
  await renderPreviews();
}

async function fillProjectSuggestions(): Promise<void> {
  const all = await listObservations();
  const projects = [...new Set(all.map((o) => o.project).filter(Boolean))];
  qs(container, '#project-list').innerHTML = projects.map((p) => `<option value="${escapeHtml(p)}">`).join('');
}

/* ---------- GPS ---------- */

function setupGps(): void {
  qs(container, '#gps-btn').addEventListener('click', () => autoFillGps(true));
}

function autoFillGps(force: boolean): void {
  const latEl = input(container, '#f-lat');
  const lngEl = input(container, '#f-lng');
  const status = qs(container, '#gps-status');
  if (!navigator.geolocation) { status.textContent = '(GPS לא זמין במכשיר זה)'; return; }
  if (!force && (latEl.value || lngEl.value)) return;
  status.textContent = '(מאתר מיקום...)';
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      latEl.value = pos.coords.latitude.toFixed(6);
      lngEl.value = pos.coords.longitude.toFixed(6);
      status.textContent = `(דיוק ±${Math.round(pos.coords.accuracy)} מ')`;
    },
    () => { status.textContent = force ? '(איתור המיקום נכשל)' : ''; },
    { enableHighAccuracy: true, timeout: 12000, maximumAge: 30000 },
  );
}

/* ---------- species combobox ---------- */

function setupSpeciesCombo(): void {
  const inp = input(container, '#f-species');
  const list = qs(container, '#species-list');
  let hlIndex = -1;

  const highlight = (s: string, q: string): string => {
    const esc = escapeHtml(s);
    if (!q) return esc;
    return esc.replaceAll(escapeHtml(q), `<mark>${escapeHtml(q)}</mark>`);
  };

  const render = (): void => {
    const q = inp.value.trim();
    const matches = q ? speciesCache.filter((s) => s.includes(q)).slice(0, 40) : speciesCache.slice(0, 40);
    hlIndex = -1;
    list.innerHTML = matches.length
      ? matches.map((s) => `<button type="button" data-name="${escapeHtml(s)}">${highlight(s, q)}</button>`).join('')
      : '<div class="combo-empty">אין מין תואם ברשימת המאסטר — ניתן להוסיף מינים בטאב "מינים"</div>';
    list.hidden = false;
  };

  inp.addEventListener('focus', render);
  inp.addEventListener('input', render);
  inp.addEventListener('keydown', (e) => {
    const items = Array.from(list.querySelectorAll<HTMLButtonElement>('button'));
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (list.hidden) { render(); return; }
      hlIndex = e.key === 'ArrowDown' ? Math.min(hlIndex + 1, items.length - 1) : Math.max(hlIndex - 1, 0);
      items.forEach((b, i) => b.classList.toggle('hl', i === hlIndex));
      items[hlIndex]?.scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter' && !list.hidden && hlIndex >= 0) {
      e.preventDefault();
      inp.value = items[hlIndex]!.dataset.name!;
      list.hidden = true;
    } else if (e.key === 'Escape') {
      list.hidden = true;
    }
  });
  list.addEventListener('mousedown', (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-name]');
    if (btn) { e.preventDefault(); inp.value = btn.dataset.name!; list.hidden = true; }
  });
  document.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    if (!container.contains(t) || !t.closest('.combo')) list.hidden = true;
  });
}

/* ---------- images ---------- */

function setupImages(): void {
  const cam = input(container, '#f-camera');
  const gal = input(container, '#f-gallery');
  qs(container, '#btn-camera').addEventListener('click', () => cam.click());
  qs(container, '#btn-gallery').addEventListener('click', () => gal.click());
  const onFiles = (e: Event): void => {
    const files = (e.target as HTMLInputElement).files;
    if (files) for (const file of Array.from(files)) {
      pendingImages.push({ id: crypto.randomUUID(), file, url: URL.createObjectURL(file) });
    }
    (e.target as HTMLInputElement).value = '';
    void renderPreviews();
  };
  cam.addEventListener('change', onFiles);
  gal.addEventListener('change', onFiles);
}

async function renderPreviews(): Promise<void> {
  const wrap = qs(container, '#img-previews');
  wrap.innerHTML = '';
  for (const img of editKeptImages) {
    const div = document.createElement('div');
    div.className = 'img-thumb';
    const el = document.createElement('img');
    el.alt = img.name || 'תמונה';
    div.appendChild(el);
    void getImageObjectUrl(img).then((url) => { if (url) el.src = url; });
    const rm = document.createElement('button');
    rm.type = 'button';
    rm.className = 'rm';
    rm.textContent = '✕';
    rm.onclick = (): void => { editKeptImages = editKeptImages.filter((i) => i !== img); void renderPreviews(); };
    div.appendChild(rm);
    wrap.appendChild(div);
  }
  for (const p of pendingImages) {
    const div = document.createElement('div');
    div.className = 'img-thumb';
    div.innerHTML = `<img src="${p.url}" alt="">`;
    const rm = document.createElement('button');
    rm.type = 'button';
    rm.className = 'rm';
    rm.textContent = '✕';
    rm.onclick = (): void => {
      URL.revokeObjectURL(p.url);
      pendingImages = pendingImages.filter((x) => x !== p);
      void renderPreviews();
    };
    div.appendChild(rm);
    wrap.appendChild(div);
  }
}

/* ---------- save ---------- */

async function onSave(e: Event): Promise<void> {
  e.preventDefault();
  const speciesVal = input(container, '#f-species').value.trim();
  if (!speciesVal) { toast('יש לבחור מין ציפור', true); return; }
  if (!speciesCache.includes(speciesVal)) {
    toast('יש לבחור מין מתוך רשימת המאסטר בלבד (ניתן להוסיף מינים בטאב "מינים")', true, 4500);
    return;
  }
  const iso = fromLocalInputValue(input(container, '#f-datetime').value);
  if (!iso) { toast('תאריך לא תקין', true); return; }

  const latRaw = input(container, '#f-lat').value;
  const lngRaw = input(container, '#f-lng').value;
  const id = editId || crypto.randomUUID();
  const images: ObservationImage[] = [...editKeptImages];

  for (const p of pendingImages) {
    await saveMedia({ id: p.id, obsId: id, name: p.file.name || 'image', mime: p.file.type, blob: p.file });
    images.push({ localId: p.id, name: p.file.name || 'image' });
  }

  if (editId) {
    const existing = await mediaForObservation(editId);
    for (const m of existing) {
      if (!images.some((i) => i.localId === m.id)) await deleteMedia(m.id);
    }
  }

  const prev = editId ? await getObservation(editId) : null;
  const obs: Observation = {
    ...(prev ?? {}),
    id,
    dateTime: iso,
    locationName: input(container, '#f-location').value.trim(),
    lat: latRaw === '' ? null : parseFloat(latRaw),
    lng: lngRaw === '' ? null : parseFloat(lngRaw),
    project: input(container, '#f-project').value.trim(),
    species: speciesVal,
    quantity: Math.max(1, parseInt(input(container, '#f-quantity').value, 10) || 1),
    images,
    notes: qs<HTMLTextAreaElement>(container, '#f-notes').value,
    deleted: false,
    updatedAt: '',
  };
  await saveObservation(obs);
  toast(editId ? 'התצפית עודכנה ✓' : 'התצפית נשמרה ✓');
  resetForm();
}
