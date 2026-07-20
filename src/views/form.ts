/* views/form.ts — טופס הדיווח האחוד. נפתח מכפתור ה-➕ ביומן או מלחיצה על סיכה
 * במפה (עם קואורדינטות). תומך בכמה מיני ציפור, ולכל מין: כמות, הערה ותמונות
 * משלו. פרויקט/מיקום נבחרים מרשימה נפתחת עם אפשרות ליצירת ערך חדש. */

import {
  saveObservation, getObservation, listObservations, listSpecies,
  saveMedia, mediaForObservation, deleteMedia, getLocation, listLocationRows,
} from '../db/repository';
import { toast, toLocalInputValue, fromLocalInputValue } from '../lib/ui';
import { escapeHtml } from '../lib/markdown';
import { getImageObjectUrl } from '../lib/media';
import { pickLocation } from '../lib/location-picker';
import { entriesOf, entryImages, speciesNames } from '../lib/observation';
import { qs, input } from '../lib/dom';
import { icon } from '../lib/icons';
import { navigate } from '../main';
import type { ViewParams } from './view';
import type { Observation, ObservationImage, SpeciesEntry } from '../types';

interface PendingImage { id: string; file: File; url: string }
interface RowImages { pending: PendingImage[]; kept: ObservationImage[] }

let container: HTMLElement;
let speciesCache: string[] = [];
let seenSpeciesCache: string[] = [];
let projectSuggestions: string[] = [];
let locationSuggestions: string[] = [];
let editId: string | null = null;
let prefillSpecies: string | null = null;
let prefillCoords: { lat: number; lng: number } | null = null;
let prefillLocationName: string | null = null;
let prefillDate: string | null = null;
let obsId = '';
const rowImages = new WeakMap<HTMLElement, RowImages>();

export function init(el: HTMLElement): void {
  container = el;
  container.innerHTML = `
    <div class="form-head">
      <button type="button" class="btn btn-sm" id="back-btn">→ חזרה לבית</button>
      <h2 id="form-title">תצפית חדשה</h2>
    </div>
    <form id="obs-form" autocomplete="off">
      <div class="row-2">
        <div class="field">
          <label for="f-datetime">תאריך ושעה</label>
          <input type="datetime-local" id="f-datetime" required>
        </div>
        <div class="field">
          <label for="f-project">פרויקט <span class="hint">(בחירה מרשימה או יצירת חדש)</span></label>
          <div class="combo with-arrow">
            <input type="text" id="f-project" placeholder='למשל: "קינון חיוויאים 2026"'>
            <button type="button" class="combo-toggle" title="פתיחת הרשימה" aria-label="פתיחת הרשימה">▾</button>
            <div class="combo-list" id="project-list" hidden></div>
          </div>
        </div>
      </div>

      <div class="field">
        <label for="f-location">מיקום <span class="hint">(בחירה מרשימה או יצירת חדש)</span></label>
        <div class="combo with-arrow">
          <input type="text" id="f-location" placeholder='למשל: "בריכות דגים", "נחל שחל"'>
          <button type="button" class="combo-toggle" title="פתיחת הרשימה" aria-label="פתיחת הרשימה">▾</button>
          <div class="combo-list" id="location-list" hidden></div>
        </div>
      </div>

      <div class="field">
        <label>קואורדינטות <span class="hint" id="gps-status"></span></label>
        <div class="coords-row">
          <input type="number" step="any" id="f-lat" placeholder="קו רוחב (Lat)" inputmode="decimal">
          <input type="number" step="any" id="f-lng" placeholder="קו אורך (Lng)" inputmode="decimal">
          <button type="button" class="btn btn-icon" id="pick-map-btn" title="בחירת מיקום על המפה">${icon('pin')}</button>
        </div>
        <span class="hint">ברירת מחדל: המיקום הנוכחי · לחצו על הסיכה כדי לבחור על המפה</span>
      </div>

      <div class="field">
        <label>מיני הציפור <span class="hint">(לכל מין: כמות, הערה ותמונות משלו)</span></label>
        <div id="species-rows"></div>
        <button type="button" class="btn btn-sm" id="add-species-row" style="margin-top:6px">${icon('plus')} הוספת מין</button>
      </div>

      <div class="field">
        <label for="f-notes">הערות כלליות <span class="hint">(פסקאות וירידות שורה נשמרות; אפשר Markdown)</span></label>
        <textarea id="f-notes" placeholder="סיכום שטח מפורט..."></textarea>
      </div>

      <button type="submit" class="btn btn-primary btn-block" id="save-btn">${icon('save')} שמירת התצפית</button>
    </form>
  `;

  wireCombo(input(container, '#f-project'), qs(container, '#project-list'), () => projectSuggestions);
  wireCombo(input(container, '#f-location'), qs(container, '#location-list'), () => locationSuggestions, {
    onSelect: (name) => void onLocationSelected(name),
  });
  qs(container, '#pick-map-btn').addEventListener('click', () => void openPicker());
  qs(container, '#add-species-row').addEventListener('click', () => addSpeciesRow({ species: '', quantity: 1 }, true));
  qs(container, '#back-btn').addEventListener('click', () => navigate('home'));
  qs<HTMLFormElement>(container, '#obs-form').addEventListener('submit', (e) => void onSave(e));
}

export function setParams(params: ViewParams): void {
  editId = params?.editId || null;
  prefillSpecies = params?.species || null;
  prefillCoords = (params?.lat != null && params?.lng != null) ? { lat: params.lat, lng: params.lng } : null;
  prefillLocationName = params?.locationName || null;
  prefillDate = params?.date || null;
}

export async function activate(): Promise<void> {
  speciesCache = await listSpecies();
  const all = await listObservations();
  const seen = new Set<string>();
  for (const o of all) for (const name of speciesNames(o)) seen.add(name);
  seenSpeciesCache = speciesCache.filter((s) => seen.has(s));
  projectSuggestions = [...new Set(all.map((o) => o.project).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'he'));
  const savedLocationNames = (await listLocationRows()).map((l) => l.name);
  locationSuggestions = [...new Set([...all.map((o) => o.locationName), ...savedLocationNames].filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, 'he'));

  if (editId) { await loadForEdit(editId); return; }

  resetForm(!prefillCoords);
  if (prefillSpecies) setEntries([{ species: prefillSpecies, quantity: 1 }]);
  if (prefillCoords) {
    input(container, '#f-lat').value = prefillCoords.lat.toFixed(6);
    input(container, '#f-lng').value = prefillCoords.lng.toFixed(6);
    qs(container, '#gps-status').textContent = '(נבחר על המפה)';
  }
  if (prefillLocationName) input(container, '#f-location').value = prefillLocationName;
  if (prefillDate) {
    const [y, m, d] = prefillDate.split('-').map(Number);
    const now = new Date();
    input(container, '#f-datetime').value = toLocalInputValue(new Date(y!, m! - 1, d!, now.getHours(), now.getMinutes()));
  }
  prefillSpecies = null;
  prefillCoords = null;
  prefillLocationName = null;
  prefillDate = null;
}

function resetForm(locate = true): void {
  editId = null;
  obsId = crypto.randomUUID();
  qs<HTMLFormElement>(container, '#obs-form').reset();
  input(container, '#f-datetime').value = toLocalInputValue();
  setEntries([{ species: '', quantity: 1 }]);
  qs(container, '#form-title').textContent = 'תצפית חדשה';
  qs(container, '#save-btn').innerHTML = `${icon('save')} שמירת התצפית`;
  if (locate) autoFillGps();
}

async function loadForEdit(id: string): Promise<void> {
  const obs = await getObservation(id);
  if (!obs) { resetForm(); return; }
  obsId = id;
  qs(container, '#form-title').textContent = 'עריכת תצפית';
  qs(container, '#save-btn').innerHTML = `${icon('save')} עדכון התצפית`;
  input(container, '#f-datetime').value = toLocalInputValue(new Date(obs.dateTime));
  input(container, '#f-location').value = obs.locationName || '';
  input(container, '#f-project').value = obs.project || '';
  input(container, '#f-lat').value = obs.lat == null ? '' : String(obs.lat);
  input(container, '#f-lng').value = obs.lng == null ? '' : String(obs.lng);
  const entries = entriesOf(obs);
  // legacy top-level images fold into the first entry for editing
  const withLegacy = entries.map((e, i) =>
    i === 0 && obs.images?.length ? { ...e, images: [...entryImages(e), ...obs.images] } : e);
  setEntries(withLegacy.length ? withLegacy : [{ species: '', quantity: 1 }]);
  qs<HTMLTextAreaElement>(container, '#f-notes').value = obs.notes || '';
}

/* ---------- location ---------- */

/** When a saved location (Settings → ניהול רשימת המיקומים) is picked from the
 * combo, fill in its coordinates — but never overwrite a value already set. */
async function onLocationSelected(name: string): Promise<void> {
  const latEl = input(container, '#f-lat');
  const lngEl = input(container, '#f-lng');
  if (latEl.value || lngEl.value) return;
  const loc = await getLocation(name);
  if (!loc || loc.lat == null || loc.lng == null) return;
  latEl.value = loc.lat.toFixed(6);
  lngEl.value = loc.lng.toFixed(6);
  qs(container, '#gps-status').textContent = '(ממיקום שמור)';
}

function autoFillGps(): void {
  const latEl = input(container, '#f-lat');
  const lngEl = input(container, '#f-lng');
  const status = qs(container, '#gps-status');
  if (!navigator.geolocation) { status.textContent = '(GPS לא זמין)'; return; }
  if (latEl.value || lngEl.value) return;
  status.textContent = '(מאתר מיקום...)';
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      if (latEl.value || lngEl.value) return; // don't clobber a manual/map choice
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

/* ---------- generic autocomplete combobox ---------- */

interface ComboOptions {
  /** 'prefix' matches only names starting with the typed text; default is substring-anywhere. */
  matchMode?: 'contains' | 'prefix';
  /** Suggestions shown when the field is empty (e.g. previously-seen species), if different from the full list. */
  getDefault?: () => string[];
  /** Fired when a suggestion is picked (click or Enter) — not on free typing. */
  onSelect?: (value: string) => void;
}

function wireCombo(inp: HTMLInputElement, list: HTMLElement, getSuggestions: () => string[], opts: ComboOptions = {}): void {
  const toggle = inp.closest('.combo')?.querySelector<HTMLButtonElement>('.combo-toggle');
  const matchMode = opts.matchMode ?? 'contains';
  let hlIndex = -1;
  const highlight = (s: string, q: string): string => {
    const esc = escapeHtml(s);
    return q ? esc.replaceAll(escapeHtml(q), `<mark>${escapeHtml(q)}</mark>`) : esc;
  };
  const render = (showAll = false): void => {
    const q = inp.value.trim();
    let matches: string[];
    if (showAll) matches = getSuggestions();
    else if (!q) matches = opts.getDefault ? opts.getDefault() : getSuggestions();
    else matches = getSuggestions().filter((s) => (matchMode === 'prefix' ? s.startsWith(q) : s.includes(q)));
    matches = matches.slice(0, 60);
    hlIndex = -1;
    if (!matches.length) { list.hidden = true; return; }
    list.innerHTML = matches
      .map((s) => `<button type="button" data-name="${escapeHtml(s)}">${highlight(s, showAll ? '' : q)}</button>`)
      .join('');
    list.hidden = false;
  };
  inp.addEventListener('focus', () => render());
  inp.addEventListener('input', () => render());
  inp.addEventListener('keydown', (e) => {
    const items = Array.from(list.querySelectorAll<HTMLButtonElement>('button'));
    if ((e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      if (list.hidden || !items.length) { render(); if (list.hidden) return; }
      e.preventDefault();
      hlIndex = e.key === 'ArrowDown' ? Math.min(hlIndex + 1, items.length - 1) : Math.max(hlIndex - 1, 0);
      items.forEach((btn, i) => btn.classList.toggle('hl', i === hlIndex));
      items[hlIndex]?.scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter' && !list.hidden && hlIndex >= 0) {
      e.preventDefault();
      inp.value = items[hlIndex]!.dataset.name!;
      list.hidden = true;
      opts.onSelect?.(inp.value);
    } else if (e.key === 'Escape') { list.hidden = true; }
  });
  list.addEventListener('mousedown', (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-name]');
    if (btn) {
      e.preventDefault();
      inp.value = btn.dataset.name!;
      list.hidden = true;
      opts.onSelect?.(inp.value);
    }
  });
  toggle?.addEventListener('mousedown', (e) => {
    e.preventDefault();
    if (list.hidden) { inp.focus(); render(true); } else { list.hidden = true; }
  });
  inp.addEventListener('blur', () => setTimeout(() => { list.hidden = true; }, 150));
}

/* ---------- species rows (multi-species; per-species qty, note, images) ---------- */

function setEntries(entries: SpeciesEntry[]): void {
  qs(container, '#species-rows').innerHTML = '';
  for (const e of entries) addSpeciesRow(e, false);
}

function addSpeciesRow(entry: SpeciesEntry, focus: boolean): void {
  const rows = qs(container, '#species-rows');
  const row = document.createElement('div');
  row.className = 'sp-entry';
  row.innerHTML = `
    <div class="sp-entry-main">
      <div class="combo sp-combo">
        <input type="text" class="sp-input" placeholder="הקלידו לחיפוש מין..." value="${escapeHtml(entry.species)}">
        <div class="combo-list" hidden></div>
      </div>
      <div class="qty-stepper">
        <button type="button" class="btn btn-icon qty-minus" title="פחות">−</button>
        <input type="number" class="sp-qty" min="1" step="1" inputmode="numeric" value="${entry.quantity}" title="מספר פרטים">
        <button type="button" class="btn btn-icon qty-plus" title="עוד">+</button>
      </div>
      <button type="button" class="btn btn-icon sp-remove" title="הסרת מין">✕</button>
    </div>
    <div class="sp-entry-second">
      <button type="button" class="btn btn-icon sp-add-img" title="הוספת תמונות למין">${icon('camera')}</button>
      <input type="file" class="sp-file" accept="image/*,.heic,.tif,.tiff" multiple hidden>
      <input type="text" class="sp-note" placeholder="הערה למין זה (לא חובה)" value="${escapeHtml(entry.note || '')}">
    </div>
    <div class="sp-thumbs"></div>
  `;
  rows.appendChild(row);
  rowImages.set(row, { pending: [], kept: entry.images ? [...entry.images] : [] });

  const qtyInput = row.querySelector<HTMLInputElement>('.sp-qty')!;
  const step = (delta: number): void => {
    qtyInput.value = String(Math.max(1, (parseInt(qtyInput.value, 10) || 1) + delta));
  };
  row.querySelector('.qty-minus')!.addEventListener('click', () => step(-1));
  row.querySelector('.qty-plus')!.addEventListener('click', () => step(1));

  wireCombo(
    row.querySelector<HTMLInputElement>('.sp-input')!,
    row.querySelector<HTMLElement>('.sp-combo .combo-list')!,
    () => speciesCache,
    { matchMode: 'prefix', getDefault: () => seenSpeciesCache },
  );

  const fileInput = row.querySelector<HTMLInputElement>('.sp-file')!;
  row.querySelector('.sp-add-img')!.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', (e) => {
    const files = (e.target as HTMLInputElement).files;
    const st = rowImages.get(row)!;
    if (files) for (const file of Array.from(files)) {
      st.pending.push({ id: crypto.randomUUID(), file, url: URL.createObjectURL(file) });
    }
    fileInput.value = '';
    void renderRowThumbs(row);
  });

  row.querySelector('.sp-remove')!.addEventListener('click', () => {
    if (container.querySelectorAll('#species-rows .sp-entry').length > 1) row.remove();
    else {
      row.querySelector<HTMLInputElement>('.sp-input')!.value = '';
      row.querySelector<HTMLInputElement>('.sp-note')!.value = '';
      qtyInput.value = '1';
      rowImages.set(row, { pending: [], kept: [] });
      void renderRowThumbs(row);
    }
  });

  void renderRowThumbs(row);
  if (focus) row.querySelector<HTMLInputElement>('.sp-input')!.focus();
}

async function renderRowThumbs(row: HTMLElement): Promise<void> {
  const wrap = row.querySelector<HTMLElement>('.sp-thumbs')!;
  const st = rowImages.get(row)!;
  wrap.innerHTML = '';
  for (const img of st.kept) {
    const div = document.createElement('div');
    div.className = 'img-thumb';
    const el = document.createElement('img');
    el.alt = img.name || 'תמונה';
    div.appendChild(el);
    void getImageObjectUrl(img, obsId).then((url) => { if (url) el.src = url; });
    const rm = document.createElement('button');
    rm.type = 'button';
    rm.className = 'rm';
    rm.textContent = '✕';
    rm.onclick = (): void => { st.kept = st.kept.filter((i) => i !== img); void renderRowThumbs(row); };
    div.appendChild(rm);
    wrap.appendChild(div);
  }
  for (const p of st.pending) {
    const div = document.createElement('div');
    div.className = 'img-thumb';
    div.innerHTML = `<img src="${p.url}" alt="">`;
    const rm = document.createElement('button');
    rm.type = 'button';
    rm.className = 'rm';
    rm.textContent = '✕';
    rm.onclick = (): void => {
      URL.revokeObjectURL(p.url);
      st.pending = st.pending.filter((x) => x !== p);
      void renderRowThumbs(row);
    };
    div.appendChild(rm);
    wrap.appendChild(div);
  }
}

/* ---------- save ---------- */

async function onSave(e: Event): Promise<void> {
  e.preventDefault();
  const rowEls = Array.from(container.querySelectorAll<HTMLElement>('#species-rows .sp-entry'));
  const iso = fromLocalInputValue(input(container, '#f-datetime').value);
  if (!iso) { toast('תאריך לא תקין', true); return; }

  const entries: SpeciesEntry[] = [];
  const keptIds = new Set<string>();
  for (const row of rowEls) {
    const species = row.querySelector<HTMLInputElement>('.sp-input')!.value.trim();
    if (!species) continue;
    if (!speciesCache.includes(species)) {
      toast(`"${species}" אינו ברשימת המינים — בחרו מין מהרשימה (ניתן להוסיף בטאב "מינים")`, true, 5000);
      return;
    }
    const quantity = Math.max(1, parseInt(row.querySelector<HTMLInputElement>('.sp-qty')!.value, 10) || 1);
    const note = row.querySelector<HTMLInputElement>('.sp-note')!.value.trim();
    const st = rowImages.get(row)!;
    const images: ObservationImage[] = [...st.kept];
    for (const p of st.pending) {
      await saveMedia({ id: p.id, obsId, name: p.file.name || 'image', mime: p.file.type, blob: p.file });
      images.push({ localId: p.id, name: p.file.name || 'image' });
    }
    images.forEach((i) => i.localId && keptIds.add(i.localId));
    const entry: SpeciesEntry = { species, quantity };
    if (note) entry.note = note;
    if (images.length) entry.images = images;
    entries.push(entry);
  }
  if (!entries.length) { toast('יש לבחור לפחות מין ציפור אחד', true); return; }

  // on edit: delete media blobs that were removed
  if (editId) {
    const existing = await mediaForObservation(obsId);
    for (const m of existing) {
      if (!keptIds.has(m.id)) await deleteMedia(m.id);
    }
  }

  const latRaw = input(container, '#f-lat').value;
  const lngRaw = input(container, '#f-lng').value;
  const prev = editId ? await getObservation(editId) : null;
  const obs: Observation = {
    ...(prev ?? {}),
    id: obsId,
    dateTime: iso,
    locationName: input(container, '#f-location').value.trim(),
    lat: latRaw === '' ? null : parseFloat(latRaw),
    lng: lngRaw === '' ? null : parseFloat(lngRaw),
    project: input(container, '#f-project').value.trim(),
    entries,
    images: [], // per-species now; keep empty for legacy field
    notes: qs<HTMLTextAreaElement>(container, '#f-notes').value,
    deleted: false,
    updatedAt: '',
  };
  await saveObservation(obs);
  toast(editId ? 'התצפית עודכנה ✓' : 'התצפית נשמרה ✓');
  navigate('cards');
}
