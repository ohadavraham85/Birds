/* views/form.js — טופס הדיווח האחוד (סעיף 4 במפרט).
 * מסך אחד רציף: תאריך/שעה, מיקום + GPS אוטומטי, פרויקט, מין (בחירה מרשימת
 * המאסטר בלבד עם חיפוש והשלמה אוטומטית), כמות, תמונות באיכות מקור, והערות.
 * שמירה בלחיצה אחת לשורה אחת בבסיס הנתונים.
 */

import {
  saveObservation, getObservation, listSpecies,
  saveMedia, mediaForObservation, deleteMedia,
} from '../db.js';
import { toast, toLocalInputValue, fromLocalInputValue } from '../ui.js';
import { escapeHtml } from '../markdown.js';

let container = null;
let speciesCache = [];
let pendingImages = []; // {id, file, url} images added but not yet saved
let editId = null;      // when set — the form edits an existing observation
let editKeptImages = []; // existing image refs kept while editing

export function init(el) {
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
  container.querySelector('#obs-form').addEventListener('submit', onSave);
  container.querySelector('#cancel-edit-btn').addEventListener('click', () => resetForm());
}

let prefillSpecies = null;

export function setParams(params) {
  editId = params?.editId || null;
  prefillSpecies = params?.species || null;
}

export async function activate() {
  speciesCache = await listSpecies();
  await fillProjectSuggestions();
  if (editId) {
    await loadForEdit(editId);
  } else if (prefillSpecies) {
    resetForm();
    container.querySelector('#f-species').value = prefillSpecies;
    prefillSpecies = null;
  } else if (!container.querySelector('#f-datetime').value) {
    resetForm();
  }
}

function resetForm() {
  editId = null;
  editKeptImages = [];
  pendingImages.forEach((p) => URL.revokeObjectURL(p.url));
  pendingImages = [];
  const form = container.querySelector('#obs-form');
  form.reset();
  container.querySelector('#f-datetime').value = toLocalInputValue();
  container.querySelector('#f-quantity').value = '1';
  container.querySelector('#form-title').textContent = 'תצפית חדשה';
  container.querySelector('#save-btn').textContent = '💾 שמירת התצפית';
  container.querySelector('#cancel-edit-btn').hidden = true;
  renderPreviews();
  autoFillGps(false);
}

async function loadForEdit(id) {
  const obs = await getObservation(id);
  if (!obs) { resetForm(); return; }
  container.querySelector('#form-title').textContent = 'עריכת תצפית';
  container.querySelector('#save-btn').textContent = '💾 עדכון התצפית';
  container.querySelector('#cancel-edit-btn').hidden = false;
  container.querySelector('#f-datetime').value = toLocalInputValue(new Date(obs.dateTime));
  container.querySelector('#f-location').value = obs.locationName || '';
  container.querySelector('#f-project').value = obs.project || '';
  container.querySelector('#f-lat').value = obs.lat ?? '';
  container.querySelector('#f-lng').value = obs.lng ?? '';
  container.querySelector('#f-species').value = obs.species || '';
  container.querySelector('#f-quantity').value = obs.quantity ?? 1;
  container.querySelector('#f-notes').value = obs.notes || '';
  editKeptImages = [...(obs.images || [])];
  pendingImages.forEach((p) => URL.revokeObjectURL(p.url));
  pendingImages = [];
  await renderPreviews();
}

async function fillProjectSuggestions() {
  const { listObservations } = await import('../db.js');
  const all = await listObservations();
  const projects = [...new Set(all.map((o) => o.project).filter(Boolean))];
  const dl = container.querySelector('#project-list');
  dl.innerHTML = projects.map((p) => `<option value="${escapeHtml(p)}">`).join('');
}

/* ---------- GPS (auto on mobile/tablet, manual refresh button) ---------- */

function setupGps() {
  container.querySelector('#gps-btn').addEventListener('click', () => autoFillGps(true));
}

function autoFillGps(force) {
  const latEl = container.querySelector('#f-lat');
  const lngEl = container.querySelector('#f-lng');
  const status = container.querySelector('#gps-status');
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

/* ---------- species combobox (autocomplete over the master list) ---------- */

function setupSpeciesCombo() {
  const input = container.querySelector('#f-species');
  const list = container.querySelector('#species-list');
  let hlIndex = -1;

  const render = () => {
    const q = input.value.trim();
    const matches = q
      ? speciesCache.filter((s) => s.includes(q)).slice(0, 40)
      : speciesCache.slice(0, 40);
    hlIndex = -1;
    if (!matches.length) {
      list.innerHTML = '<div class="combo-empty">אין מין תואם ברשימת המאסטר — ניתן להוסיף מינים במסך ההגדרות</div>';
    } else {
      list.innerHTML = matches
        .map((s) => `<button type="button" data-name="${escapeHtml(s)}">${highlight(s, q)}</button>`)
        .join('');
    }
    list.hidden = false;
  };

  const highlight = (s, q) => {
    const esc = escapeHtml(s);
    if (!q) return esc;
    return esc.replaceAll(escapeHtml(q), `<mark>${escapeHtml(q)}</mark>`);
  };

  input.addEventListener('focus', render);
  input.addEventListener('input', render);
  input.addEventListener('keydown', (e) => {
    const items = [...list.querySelectorAll('button')];
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (list.hidden) { render(); return; }
      hlIndex = e.key === 'ArrowDown'
        ? Math.min(hlIndex + 1, items.length - 1)
        : Math.max(hlIndex - 1, 0);
      items.forEach((b, i) => b.classList.toggle('hl', i === hlIndex));
      items[hlIndex]?.scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter' && !list.hidden && hlIndex >= 0) {
      e.preventDefault();
      input.value = items[hlIndex].dataset.name;
      list.hidden = true;
    } else if (e.key === 'Escape') {
      list.hidden = true;
    }
  });
  list.addEventListener('mousedown', (e) => {
    const btn = e.target.closest('button[data-name]');
    if (btn) {
      e.preventDefault();
      input.value = btn.dataset.name;
      list.hidden = true;
    }
  });
  document.addEventListener('click', (e) => {
    if (!container.contains(e.target) || !e.target.closest('.combo')) list.hidden = true;
  });
}

/* ---------- images (original quality, no recompression) ---------- */

function setupImages() {
  const cam = container.querySelector('#f-camera');
  const gal = container.querySelector('#f-gallery');
  container.querySelector('#btn-camera').addEventListener('click', () => cam.click());
  container.querySelector('#btn-gallery').addEventListener('click', () => gal.click());
  const onFiles = (e) => {
    for (const file of e.target.files) {
      pendingImages.push({
        id: crypto.randomUUID(),
        file,
        url: URL.createObjectURL(file),
      });
    }
    e.target.value = '';
    renderPreviews();
  };
  cam.addEventListener('change', onFiles);
  gal.addEventListener('change', onFiles);
}

async function renderPreviews() {
  const wrap = container.querySelector('#img-previews');
  wrap.innerHTML = '';
  // existing images kept during editing
  for (const img of editKeptImages) {
    const div = document.createElement('div');
    div.className = 'img-thumb';
    const el = document.createElement('img');
    el.alt = img.name || 'תמונה';
    div.appendChild(el);
    const { getImageObjectUrl } = await import('../media.js');
    getImageObjectUrl(img).then((url) => { if (url) el.src = url; });
    const rm = document.createElement('button');
    rm.type = 'button';
    rm.className = 'rm';
    rm.textContent = '✕';
    rm.title = 'הסרת התמונה מהתצפית';
    rm.onclick = () => {
      editKeptImages = editKeptImages.filter((i) => i !== img);
      renderPreviews();
    };
    div.appendChild(rm);
    wrap.appendChild(div);
  }
  // newly added images
  for (const p of pendingImages) {
    const div = document.createElement('div');
    div.className = 'img-thumb';
    div.innerHTML = `<img src="${p.url}" alt="">`;
    const rm = document.createElement('button');
    rm.type = 'button';
    rm.className = 'rm';
    rm.textContent = '✕';
    rm.onclick = () => {
      URL.revokeObjectURL(p.url);
      pendingImages = pendingImages.filter((x) => x !== p);
      renderPreviews();
    };
    div.appendChild(rm);
    wrap.appendChild(div);
  }
}

/* ---------- save (one click → one row) ---------- */

async function onSave(e) {
  e.preventDefault();
  const speciesVal = container.querySelector('#f-species').value.trim();
  if (!speciesVal) { toast('יש לבחור מין ציפור', true); return; }
  if (!speciesCache.includes(speciesVal)) {
    toast('יש לבחור מין מתוך רשימת המאסטר בלבד (ניתן להוסיף מינים בהגדרות)', true, 4500);
    return;
  }
  const dtVal = container.querySelector('#f-datetime').value;
  const iso = fromLocalInputValue(dtVal);
  if (!iso) { toast('תאריך לא תקין', true); return; }

  const latRaw = container.querySelector('#f-lat').value;
  const lngRaw = container.querySelector('#f-lng').value;

  const id = editId || crypto.randomUUID();
  const images = [...editKeptImages];

  // persist new image blobs at original quality
  for (const p of pendingImages) {
    await saveMedia({
      id: p.id,
      obsId: id,
      name: p.file.name || 'image',
      mime: p.file.type,
      blob: p.file,
    });
    images.push({ localId: p.id, name: p.file.name || 'image' });
  }

  // while editing: delete local blobs for images the user removed
  if (editId) {
    const existing = await mediaForObservation(editId);
    for (const m of existing) {
      const kept = images.some((i) => i.localId === m.id);
      if (!kept) await deleteMedia(m.id);
    }
  }

  const prev = editId ? await getObservation(editId) : null;
  await saveObservation({
    ...(prev || {}),
    id,
    dateTime: iso,
    locationName: container.querySelector('#f-location').value.trim(),
    lat: latRaw === '' ? null : parseFloat(latRaw),
    lng: lngRaw === '' ? null : parseFloat(lngRaw),
    project: container.querySelector('#f-project').value.trim(),
    species: speciesVal,
    quantity: Math.max(1, parseInt(container.querySelector('#f-quantity').value, 10) || 1),
    images,
    notes: container.querySelector('#f-notes').value,
    deleted: false,
  });

  toast(editId ? 'התצפית עודכנה ✓' : 'התצפית נשמרה ✓');
  resetForm();
}
