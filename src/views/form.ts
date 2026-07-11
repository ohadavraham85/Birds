/* views/form.ts — טופס הדיווח האחוד: מסך אחד רציף. תומך בכמה מיני ציפור
 * בתצפית אחת, ובבחירת מיקום על מפה (בררת מחדל: המיקום הנוכחי). */

import {
  saveObservation, getObservation, listObservations, listSpecies,
  saveMedia, mediaForObservation, deleteMedia,
} from '../db/repository';
import { toast, toLocalInputValue, fromLocalInputValue } from '../lib/ui';
import { escapeHtml } from '../lib/markdown';
import { getImageObjectUrl } from '../lib/media';
import { pickLocation } from '../lib/location-picker';
import { entriesOf } from '../lib/observation';
import { qs, input } from '../lib/dom';
import type { ViewParams } from './view';
import type { Observation, ObservationImage, SpeciesEntry } from '../types';

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
          <button type="button" class="btn btn-icon" id="pick-map-btn" title="בחירת מיקום על המפה">📍</button>
        </div>
        <span class="hint">ברירת מחדל: המיקום הנוכחי · לחצו על הסיכה כדי לבחור על המפה</span>
      </div>

      <div class="field">
        <label>מיני הציפור <span class="hint">(אפשר להוסיף יותר ממין אחד)</span></label>
        <div id="species-rows"></div>
        <button type="button" class="btn btn-sm" id="add-species-row" style="margin-top:6px">➕ הוספת מין</button>
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

  setupImages();
  qs(container, '#pick-map-btn').addEventListener('click', () => void openPicker());
  qs(container, '#add-species-row').addEventListener('click', () => addSpeciesRow('', 1, true));
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
    setEntries([{ species: prefillSpecies, quantity: 1 }]);
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
  setEntries([{ species: '', quantity: 1 }]);
  qs(container, '#form-title').textContent = 'תצפית חדשה';
  qs(container, '#save-btn').textContent = '💾 שמירת התצפית';
  qs(container, '#cancel-edit-btn').hidden = true;
  void renderPreviews();
  autoFillGps();
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
  setEntries(entriesOf(obs).length ? entriesOf(obs) : [{ species: '', quantity: 1 }]);
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

/* ---------- location (default = current; pin opens the map picker) ---------- */

function autoFillGps(): void {
  const latEl = input(container, '#f-lat');
  const lngEl = input(container, '#f-lng');
  const status = qs(container, '#gps-status');
  if (!navigator.geolocation) { status.textContent = '(GPS לא זמין)'; return; }
  if (latEl.value || lngEl.value) return;
  status.textContent = '(מאתר מיקום...)';
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      latEl.value = pos.coords.latitude.toFixed(6);
      lngEl.value = pos.coords.longitude.toFixed(6);
      status.textContent = `(דיוק ±${Math.round(pos.coords.accuracy)} מ')`;
    },
    () => { status.textContent = ''; },
    { enableHighAccuracy: true, timeout: 12000, maximumAge: 30000 },
  );
}

async function openPicker(): Promise<void> {
  const latEl = input(container, '#f-lat');
  const lngEl = input(container, '#f-lng');
  const lat = parseFloat(latEl.value);
  const lng = parseFloat(lngEl.value);
  const initial = Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
  const result = await pickLocation(initial);
  if (result) {
    latEl.value = result.lat.toFixed(6);
    lngEl.value = result.lng.toFixed(6);
    qs(container, '#gps-status').textContent = '(נבחר על המפה)';
  }
}

/* ---------- species rows (multi-species) ---------- */

function setEntries(entries: SpeciesEntry[]): void {
  qs(container, '#species-rows').innerHTML = '';
  for (const e of entries) addSpeciesRow(e.species, e.quantity, false);
}

function collectEntries(): SpeciesEntry[] {
  const rows = Array.from(container.querySelectorAll<HTMLElement>('#species-rows .sp-entry'));
  const out: SpeciesEntry[] = [];
  for (const row of rows) {
    const species = row.querySelector<HTMLInputElement>('.sp-input')!.value.trim();
    const quantity = Math.max(1, parseInt(row.querySelector<HTMLInputElement>('.sp-qty')!.value, 10) || 1);
    if (species) out.push({ species, quantity });
  }
  return out;
}

function addSpeciesRow(species: string, quantity: number, focus: boolean): void {
  const rows = qs(container, '#species-rows');
  const row = document.createElement('div');
  row.className = 'sp-entry';
  row.innerHTML = `
    <div class="combo sp-combo">
      <input type="text" class="sp-input" placeholder="הקלידו לחיפוש מין..." value="${escapeHtml(species)}">
      <div class="combo-list" hidden></div>
    </div>
    <input type="number" class="sp-qty" min="1" step="1" inputmode="numeric" value="${quantity}" title="מספר פרטים">
    <button type="button" class="btn btn-icon sp-remove" title="הסרת מין">✕</button>
  `;
  rows.appendChild(row);
  wireCombo(row);
  row.querySelector('.sp-remove')!.addEventListener('click', () => {
    if (container.querySelectorAll('#species-rows .sp-entry').length > 1) row.remove();
    else { row.querySelector<HTMLInputElement>('.sp-input')!.value = ''; }
  });
  if (focus) row.querySelector<HTMLInputElement>('.sp-input')!.focus();
}

function wireCombo(row: HTMLElement): void {
  const inp = row.querySelector<HTMLInputElement>('.sp-input')!;
  const list = row.querySelector<HTMLElement>('.combo-list')!;
  let hlIndex = -1;

  const highlight = (s: string, q: string): string => {
    const esc = escapeHtml(s);
    return q ? esc.replaceAll(escapeHtml(q), `<mark>${escapeHtml(q)}</mark>`) : esc;
  };
  const render = (): void => {
    const q = inp.value.trim();
    const matches = q ? speciesCache.filter((s) => s.includes(q)).slice(0, 40) : speciesCache.slice(0, 40);
    hlIndex = -1;
    list.innerHTML = matches.length
      ? matches.map((s) => `<button type="button" data-name="${escapeHtml(s)}">${highlight(s, q)}</button>`).join('')
      : '<div class="combo-empty">אין מין תואם — ניתן להוסיף מינים בטאב "מינים"</div>';
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
    } else if (e.key === 'Escape') { list.hidden = true; }
  });
  list.addEventListener('mousedown', (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-name]');
    if (btn) { e.preventDefault(); inp.value = btn.dataset.name!; list.hidden = true; }
  });
  inp.addEventListener('blur', () => setTimeout(() => { list.hidden = true; }, 150));
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
  const entries = collectEntries();
  if (!entries.length) { toast('יש לבחור לפחות מין ציפור אחד', true); return; }
  const invalid = entries.find((en) => !speciesCache.includes(en.species));
  if (invalid) {
    toast(`"${invalid.species}" אינו ברשימת המינים — בחרו מין מהרשימה (ניתן להוסיף בטאב "מינים")`, true, 5000);
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
    entries,
    images,
    notes: qs<HTMLTextAreaElement>(container, '#f-notes').value,
    deleted: false,
    updatedAt: '',
  };
  await saveObservation(obs);
  toast(editId ? 'התצפית עודכנה ✓' : 'התצפית נשמרה ✓');
  resetForm();
}
