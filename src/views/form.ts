/* views/form.ts — טופס הדיווח האחוד. נפתח מכפתור ה-➕ ביומן או מלחיצה על סיכה
 * במפה (עם קואורדינטות). תומך בכמה מיני ציפור, ולכל מין: כמות, הערה ותמונות
 * משלו. פרויקט/מיקום נבחרים מרשימה נפתחת עם אפשרות ליצירת ערך חדש. */

import {
  saveObservation, getObservation, listObservations, listSpecies,
  saveMedia, mediaForObservation, deleteMedia, listLocationRows, listProjectRows, saveTrack, getTrack,
} from '../db/repository';
import { toast, toLocalInputValue, fromLocalInputValue } from '../lib/ui';
import { escapeHtml } from '../lib/markdown';
import { getImageObjectUrl } from '../lib/media';
import { pickLocation } from '../lib/location-picker';
import { wireCombo } from '../lib/combo';
import { entriesOf, entryImages, speciesNames } from '../lib/observation';
import { startTracking, stopTracking, isTracking, elapsedMs, snapshot, seedFromDraft, distanceMetersSoFar, fmtDistance } from '../lib/gps-track';
import { isVoiceDictationSupported, startDictation, stopDictation, isDictating } from '../lib/voice-dictation';
import { parseObservationVoice } from '../lib/voice-parse';
import { renderTrackPreview } from '../lib/track-preview';
import { saveDraft, loadDraft, clearDraft, type ObservationDraft } from '../lib/draft';
import { qs, input } from '../lib/dom';
import { icon } from '../lib/icons';
import { navigate, goBack } from '../main';
import type { ViewParams } from './view';
import type { Observation, ObservationImage, SpeciesEntry, LocationRow, ObservationTrack } from '../types';

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
let resumeDraftRequested = false;
let draftInterval: ReturnType<typeof setInterval> | null = null;
let obsId = '';
let savedLocations = new Map<string, LocationRow>();
let currentLat: number | null = null;
let currentLng: number | null = null;
let coordsLocked = false;
let trackTimerHandle: ReturnType<typeof setInterval> | null = null;
/** The observation's already-saved track when editing (if any) — the first
 * toggle-on of this edit session seeds the recorder from it so continuing
 * appends onto the existing route instead of starting over. */
let existingTrackForEdit: ObservationTrack | null = null;
let seededFromExistingTrack = false;
const rowImages = new WeakMap<HTMLElement, RowImages>();

export function init(el: HTMLElement): void {
  container = el;
  container.innerHTML = `
    <div class="form-head">
      <button type="button" class="btn btn-sm" id="back-btn">→ חזרה</button>
      <h2 id="form-title">תצפית חדשה</h2>
    </div>
    <button type="button" class="btn btn-block voice-dictate-btn" id="voice-dictate-btn">${icon('mic')} הכתבת תצפית בקול</button>
    <div class="track-status voice-status" id="voice-status" hidden>
      <span class="track-dot"></span>
      <span id="voice-interim">מקשיב...</span>
    </div>
    <label class="notif-toggle-row track-toggle-row" id="track-toggle-row" hidden>
      <span>הקלטת מסלול GPS לתצפית זו</span>
      <input type="checkbox" id="track-toggle">
    </label>
    <div class="track-status" id="track-status" hidden>
      <span class="track-dot"></span>
      <span>מקליט מסלול GPS · <span id="track-timer">00:00</span> · <span id="track-distance">0 מ'</span></span>
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
        <label>מיקום על המפה</label>
        <button type="button" class="btn location-pin-btn" id="pick-map-btn">
          ${icon('pin')} <span id="location-pin-label">בחירת מיקום על המפה</span>
        </button>
        <span class="hint" id="gps-status"></span>
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
    onSelect: (name) => applyLocationName(name),
  });
  input(container, '#f-location').addEventListener('input', (e) => applyLocationName((e.target as HTMLInputElement).value));
  qs(container, '#pick-map-btn').addEventListener('click', () => void openPicker());
  qs(container, '#add-species-row').addEventListener('click', () => addSpeciesRow({ species: '', quantity: 1 }, true));
  qs(container, '#back-btn').addEventListener('click', () => { stopAndDiscardTrack(); stopDictation(); goBack(); });
  qs(container, '#voice-dictate-btn').addEventListener('click', () => onVoiceDictateClick());
  qs<HTMLInputElement>(container, '#track-toggle').addEventListener('change', (e) => {
    if ((e.target as HTMLInputElement).checked) beginTrack();
    else stashTrack();
  });
  qs<HTMLFormElement>(container, '#obs-form').addEventListener('submit', (e) => void onSave(e));
}

/** Called by the router right before navigating away from this view by any
 * path other than the back button or a successful save (tab bar, browser
 * back, overflow menu) — otherwise a recording started for an abandoned new
 * observation would keep the GPS watch running forever in the background. */
export function deactivate(): void {
  stopAndDiscardTrack();
  stopDictation();
}

/* ---------- voice dictation (speak a whole observation instead of typing) ---------- */

function onVoiceDictateClick(): void {
  if (isDictating()) { stopDictation(); return; }
  if (!isVoiceDictationSupported()) {
    toast('הדפדפן הזה לא תומך בהכתבה קולית — נסו דפדפן Chrome, ורק כשיש חיבור אינטרנט (ההכתבה אינה עובדת אופליין)', true, 6000);
    return;
  }
  const btn = qs<HTMLButtonElement>(container, '#voice-dictate-btn');
  const status = qs(container, '#voice-status');
  const interim = qs(container, '#voice-interim');
  btn.classList.add('recording');
  btn.innerHTML = `${icon('mic')} הפסקת הקלטה`;
  status.hidden = false;
  interim.textContent = 'מקשיב...';

  startDictation({
    onInterim: (text) => { interim.textContent = text; },
    onFinal: (text) => {
      interim.textContent = text;
      applyVoiceResult(parseObservationVoice(text, speciesCache, locationSuggestions));
    },
    onError: (msg) => toast(msg, true, 5000),
    onEnd: () => {
      btn.classList.remove('recording');
      btn.innerHTML = `${icon('mic')} הכתבת תצפית בקול`;
      status.hidden = true;
    },
  });
}

/** Fills in whatever the dictated sentence could confidently be matched to
 * (a known species name, a number, a known location) and always keeps the
 * full transcript in the notes — so an unrecognized species/location name
 * is never silently dropped, just left as free text for manual cleanup. */
function applyVoiceResult(result: ReturnType<typeof parseObservationVoice>): void {
  if (result.species) {
    const rows = Array.from(container.querySelectorAll<HTMLElement>('#species-rows .sp-entry'));
    const emptyRow = rows.find((r) => !r.querySelector<HTMLInputElement>('.sp-input')!.value.trim());
    if (emptyRow) {
      emptyRow.querySelector<HTMLInputElement>('.sp-input')!.value = result.species;
      emptyRow.querySelector<HTMLInputElement>('.sp-qty')!.value = String(result.quantity);
    } else {
      addSpeciesRow({ species: result.species, quantity: result.quantity }, false);
    }
  }
  if (result.locationName) {
    input(container, '#f-location').value = result.locationName;
    applyLocationName(result.locationName);
  }
  const notesEl = qs<HTMLTextAreaElement>(container, '#f-notes');
  notesEl.value = notesEl.value.trim() ? `${notesEl.value}\n${result.notes}` : result.notes;

  const parts: string[] = [];
  if (result.species) parts.push(`${result.quantity} × ${result.species}`);
  if (result.locationName) parts.push(`מיקום: ${result.locationName}`);
  toast(
    parts.length ? `זוהה מההכתבה: ${parts.join(' · ')} — בדקו לפני שמירה` : 'לא זוהה מין/מיקום ידוע בהכתבה — הטקסט נוסף להערות',
    false,
    5000,
  );
}

/* ---------- GPS track recording (new observations only; opt-in via the toggle) ---------- */

/** A recording the user toggled off mid-form, kept in memory (not yet saved
 * to the DB) so it can still be attached once the observation itself is
 * saved — turning the toggle off is "pause and keep what I have", not
 * "discard". Toggling back on starts a fresh recording, replacing this. */
let pendingTrack: Omit<ObservationTrack, 'id' | 'updatedAt'> | null = null;

function beginTrack(): void {
  pendingTrack = null;
  if (existingTrackForEdit && !seededFromExistingTrack) {
    seedFromDraft(existingTrackForEdit.points, new Date(existingTrackForEdit.startedAt).getTime());
    seededFromExistingTrack = true;
  }
  startTracking();
  qs(container, '#track-status').hidden = false;
  updateTrackTimer();
  if (trackTimerHandle) clearInterval(trackTimerHandle);
  trackTimerHandle = setInterval(updateTrackTimer, 1000);
}

function updateTrackTimer(): void {
  const totalSec = Math.floor(elapsedMs() / 1000);
  const mm = String(Math.floor(totalSec / 60)).padStart(2, '0');
  const ss = String(totalSec % 60).padStart(2, '0');
  const timerEl = container.querySelector<HTMLElement>('#track-timer');
  if (timerEl) timerEl.textContent = `${mm}:${ss}`;
  const distEl = container.querySelector<HTMLElement>('#track-distance');
  if (distEl) distEl.textContent = fmtDistance(distanceMetersSoFar());
}

function stopTrackTimer(): void {
  if (trackTimerHandle) { clearInterval(trackTimerHandle); trackTimerHandle = null; }
  const status = container.querySelector<HTMLElement>('#track-status');
  if (status) status.hidden = true;
}

/** Turning the toggle off: stop watching GPS but keep whatever was captured
 * so far in memory, ready to be attached when the observation is saved. */
function stashTrack(): void {
  stopTrackTimer();
  if (!isTracking()) return;
  const built = buildTrack(stopTracking());
  pendingTrack = built;
}

/** Abandons whatever's been recorded or stashed — used when leaving without saving. */
function stopAndDiscardTrack(): void {
  stopTrackTimer();
  if (isTracking()) stopTracking();
  pendingTrack = null;
  const toggle = container.querySelector<HTMLInputElement>('#track-toggle');
  if (toggle) toggle.checked = false;
  stopDraftAutosave();
  clearDraft();
}

/* ---------- draft auto-save (survives the OS reloading/killing the app mid-session) ---------- */

function collectDraftEntries(): { species: string; quantity: number; note?: string }[] {
  const rowEls = Array.from(container.querySelectorAll<HTMLElement>('#species-rows .sp-entry'));
  return rowEls
    .map((row) => {
      const species = row.querySelector<HTMLInputElement>('.sp-input')!.value.trim();
      const quantity = Math.max(1, parseInt(row.querySelector<HTMLInputElement>('.sp-qty')!.value, 10) || 1);
      const note = row.querySelector<HTMLInputElement>('.sp-note')!.value.trim();
      return note ? { species, quantity, note } : { species, quantity };
    })
    .filter((e) => e.species);
}

function persistDraft(): void {
  const snap = snapshot();
  const track = snap
    ? { points: snap.points, startedAt: snap.startedAt }
    : pendingTrack
      ? { points: pendingTrack.points, startedAt: new Date(pendingTrack.startedAt).getTime() }
      : null;
  const draft: ObservationDraft = {
    savedAt: new Date().toISOString(),
    ...(editId ? { editId } : {}),
    fields: {
      dateTime: input(container, '#f-datetime').value,
      project: input(container, '#f-project').value,
      location: input(container, '#f-location').value,
      lat: currentLat,
      lng: currentLng,
      coordsLocked,
      notes: qs<HTMLTextAreaElement>(container, '#f-notes').value,
      entries: collectDraftEntries(),
    },
    track,
  };
  saveDraft(draft);
}

function startDraftAutosave(): void {
  stopDraftAutosave();
  draftInterval = setInterval(persistDraft, 3000);
}

function stopDraftAutosave(): void {
  if (draftInterval) { clearInterval(draftInterval); draftInterval = null; }
}

/** Restores a previously auto-saved in-progress observation — fields plus
 * whatever GPS track had been captured — and, if there was any track data,
 * resumes recording onto it right away (rather than leaving the user to
 * remember to flip the toggle back on themselves). */
function resumeFromDraft(): void {
  const draft = loadDraft();
  if (!draft) return;
  input(container, '#f-datetime').value = draft.fields.dateTime;
  input(container, '#f-project').value = draft.fields.project;
  input(container, '#f-location').value = draft.fields.location;
  currentLat = draft.fields.lat;
  currentLng = draft.fields.lng;
  coordsLocked = draft.fields.coordsLocked;
  updateLocationPinUI();
  qs<HTMLTextAreaElement>(container, '#f-notes').value = draft.fields.notes;
  setEntries(draft.fields.entries.length ? draft.fields.entries : [{ species: '', quantity: 1 }]);
  if (draft.track && draft.track.points.length) {
    seedFromDraft(draft.track.points, draft.track.startedAt);
    seededFromExistingTrack = true; // the draft already carries any pre-existing track's history — don't let beginTrack() re-seed and clobber it
    qs<HTMLInputElement>(container, '#track-toggle').checked = true;
    beginTrack();
  }
  toast('התצפית שלא נשמרה שוחזרה ✓');
}

function buildTrack(result: { points: ObservationTrack['points']; segments: ObservationTrack['segments']; startedAt: number; endedAt: number; distanceMeters: number }): Omit<ObservationTrack, 'id' | 'updatedAt'> | null {
  if (result.points.length < 2) return null;
  return {
    points: result.points,
    segments: result.segments,
    startedAt: new Date(result.startedAt).toISOString(),
    endedAt: new Date(result.endedAt).toISOString(),
    durationMs: result.endedAt - result.startedAt,
    distanceMeters: result.distanceMeters,
    previewImage: renderTrackPreview(result.segments) ?? undefined,
  };
}

/** Finalizes whichever track exists (still actively recording, or already
 * stashed by toggling off earlier) and persists it keyed by the just-saved
 * observation's id. No-ops if the toggle was never turned on. */
async function stopAndSaveTrack(id: string): Promise<void> {
  stopTrackTimer();
  const finalTrack = isTracking() ? buildTrack(stopTracking()) : pendingTrack;
  pendingTrack = null;
  if (!finalTrack) return;
  await saveTrack({ ...finalTrack, id, updatedAt: '' });
}

export function setParams(params: ViewParams): void {
  editId = params?.editId || null;
  prefillSpecies = params?.species || null;
  prefillCoords = (params?.lat != null && params?.lng != null) ? { lat: params.lat, lng: params.lng } : null;
  prefillLocationName = params?.locationName || null;
  prefillDate = params?.date || null;
  resumeDraftRequested = params?.resumeDraft || false;
}

export async function activate(): Promise<void> {
  speciesCache = await listSpecies();
  const all = await listObservations();
  const seen = new Set<string>();
  for (const o of all) for (const name of speciesNames(o)) seen.add(name);
  seenSpeciesCache = speciesCache.filter((s) => seen.has(s));
  const savedProjectRows = await listProjectRows();
  projectSuggestions = [...new Set([...all.map((o) => o.project), ...savedProjectRows.map((p) => p.name)].filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, 'he'));
  const savedLocationRows = await listLocationRows();
  savedLocations = new Map(savedLocationRows.map((l) => [l.name, l]));
  locationSuggestions = [...new Set([...all.map((o) => o.locationName), ...savedLocationRows.map((l) => l.name)].filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, 'he'));

  if (editId) {
    await loadForEdit(editId);
    if (resumeDraftRequested) resumeFromDraft();
    resumeDraftRequested = false;
    return;
  }

  resetForm(!prefillCoords);
  if (prefillSpecies) setEntries([{ species: prefillSpecies, quantity: 1 }]);
  if (prefillCoords) {
    currentLat = prefillCoords.lat;
    currentLng = prefillCoords.lng;
  }
  if (prefillLocationName) input(container, '#f-location').value = prefillLocationName;
  applyLocationName(input(container, '#f-location').value);
  if (prefillCoords) qs(container, '#gps-status').textContent = coordsLocked ? '(מיקום קבוע)' : '(נבחר על המפה)';
  if (prefillDate) {
    const [y, m, d] = prefillDate.split('-').map(Number);
    const now = new Date();
    input(container, '#f-datetime').value = toLocalInputValue(new Date(y!, m! - 1, d!, now.getHours(), now.getMinutes()));
  }
  prefillSpecies = null;
  prefillCoords = null;
  prefillLocationName = null;
  prefillDate = null;

  if (resumeDraftRequested) resumeFromDraft();
  resumeDraftRequested = false;
}

function resetForm(locate = true): void {
  editId = null;
  obsId = crypto.randomUUID();
  qs<HTMLFormElement>(container, '#obs-form').reset();
  input(container, '#f-datetime').value = toLocalInputValue();
  setEntries([{ species: '', quantity: 1 }]);
  qs(container, '#form-title').textContent = 'תצפית חדשה';
  qs(container, '#save-btn').innerHTML = `${icon('save')} שמירת התצפית`;
  currentLat = null;
  currentLng = null;
  coordsLocked = false;
  updateLocationPinUI();
  if (locate) autoFillGps();
  pendingTrack = null;
  existingTrackForEdit = null;
  seededFromExistingTrack = false;
  stopTrackTimer();
  qs<HTMLInputElement>(container, '#track-toggle').checked = false;
  qs(container, '#track-toggle-row').hidden = false;
  startDraftAutosave();
}

async function loadForEdit(id: string): Promise<void> {
  const obs = await getObservation(id);
  if (!obs) { resetForm(); return; }
  obsId = id;
  pendingTrack = null;
  seededFromExistingTrack = false;
  existingTrackForEdit = (await getTrack(id)) ?? null;
  stopTrackTimer();
  qs<HTMLInputElement>(container, '#track-toggle').checked = false;
  qs(container, '#track-toggle-row').hidden = false;
  startDraftAutosave();
  qs(container, '#form-title').textContent = 'עריכת תצפית';
  qs(container, '#save-btn').innerHTML = `${icon('save')} עדכון התצפית`;
  input(container, '#f-datetime').value = toLocalInputValue(new Date(obs.dateTime));
  input(container, '#f-location').value = obs.locationName || '';
  input(container, '#f-project').value = obs.project || '';
  currentLat = obs.lat ?? null;
  currentLng = obs.lng ?? null;
  applyLocationName(obs.locationName || '');
  const entries = entriesOf(obs);
  // legacy top-level images fold into the first entry for editing
  const withLegacy = entries.map((e, i) =>
    i === 0 && obs.images?.length ? { ...e, images: [...entryImages(e), ...obs.images] } : e);
  setEntries(withLegacy.length ? withLegacy : [{ species: '', quantity: 1 }]);
  qs<HTMLTextAreaElement>(container, '#f-notes').value = obs.notes || '';
}

/* ---------- location ---------- */

/** Locks the coordinates to a saved location's fixed lat/lng whenever the
 * location field's text matches one (Settings → ניהול רשימת המיקומים) — the
 * whole point of a saved location is that its coordinates don't drift.
 * Any other (new/unrecognized) name leaves coordinates editable via the map. */
function applyLocationName(name: string): void {
  const saved = savedLocations.get(name.trim());
  if (saved && saved.lat != null && saved.lng != null) {
    currentLat = saved.lat;
    currentLng = saved.lng;
    coordsLocked = true;
  } else {
    // Leaving a locked (saved) location for an unrecognized name: that saved
    // place's coordinates belong to it, not to whatever's being typed now.
    if (coordsLocked) { currentLat = null; currentLng = null; }
    coordsLocked = false;
  }
  updateLocationPinUI();
}

function updateLocationPinUI(): void {
  const label = qs(container, '#location-pin-label');
  const btn = qs<HTMLButtonElement>(container, '#pick-map-btn');
  btn.classList.toggle('locked', coordsLocked);
  if (coordsLocked) label.textContent = 'מיקום קבוע — הצגה על המפה';
  else if (currentLat != null && currentLng != null) label.textContent = 'מיקום נבחר — לחיצה לשינוי על המפה';
  else label.textContent = 'בחירת מיקום על המפה';
}

function autoFillGps(): void {
  const status = qs(container, '#gps-status');
  if (!navigator.geolocation) { status.textContent = '(GPS לא זמין)'; return; }
  if (currentLat != null || currentLng != null) return;
  status.textContent = '(מאתר מיקום...)';
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      if (currentLat != null || currentLng != null) return; // don't clobber a manual/map choice
      currentLat = pos.coords.latitude;
      currentLng = pos.coords.longitude;
      status.textContent = `(דיוק ±${Math.round(pos.coords.accuracy)} מ')`;
      updateLocationPinUI();
    },
    () => { status.textContent = ''; },
    { enableHighAccuracy: true, timeout: 12000, maximumAge: 30000 },
  );
}

async function openPicker(): Promise<void> {
  const initial = currentLat != null && currentLng != null ? { lat: currentLat, lng: currentLng } : null;
  if (coordsLocked) { await pickLocation(initial, { readonly: true }); return; }
  const result = await pickLocation(initial);
  if (result) {
    currentLat = result.lat;
    currentLng = result.lng;
    qs(container, '#gps-status').textContent = '(נבחר על המפה)';
    updateLocationPinUI();
  }
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

  const prev = editId ? await getObservation(editId) : null;
  const obs: Observation = {
    ...(prev ?? {}),
    id: obsId,
    dateTime: iso,
    locationName: input(container, '#f-location').value.trim(),
    lat: currentLat,
    lng: currentLng,
    // TODO(tags phase 2): #f-project is being replaced by a multi-tag picker;
    // for now still write the single legacy field and mirror it into tags so
    // existing data keeps working until the picker UI lands.
    project: input(container, '#f-project').value.trim(),
    tags: input(container, '#f-project').value.trim() ? [input(container, '#f-project').value.trim()] : (prev?.tags ?? []),
    entries,
    images: [], // per-species now; keep empty for legacy field
    notes: qs<HTMLTextAreaElement>(container, '#f-notes').value,
    deleted: false,
    updatedAt: '',
  };
  await saveObservation(obs);
  await stopAndSaveTrack(obsId);
  stopDraftAutosave();
  clearDraft();
  toast(editId ? 'התצפית עודכנה ✓' : 'התצפית נשמרה ✓');
  navigate('cards');
}
