/* views/form.ts — טופס הדיווח האחוד. נפתח מכפתור ה-➕ ביומן או מלחיצה על סיכה
 * במפה (עם קואורדינטות). תומך בכמה מיני ציפור, ולכל מין: כמות, הערה ותמונות
 * משלו. פרויקט/מיקום נבחרים מרשימה נפתחת עם אפשרות ליצירת ערך חדש. */

import {
  saveObservation, getObservation, listObservations, listSpecies,
  saveMedia, mediaForObservation, deleteMedia, listLocationRows, listTagRows, addTag, listObserverRows, addObserver, saveTrack, getTrack,
} from '../db/repository';
import { toast, toLocalInputValue, fromLocalInputValue, safeHttpUrl } from '../lib/ui';
import { escapeHtml } from '../lib/markdown';
import { getImageObjectUrl } from '../lib/media';
import { pickLocation } from '../lib/location-picker';
import { wireCombo } from '../lib/combo';
import { entriesOf, entryImages, speciesNames } from '../lib/observation';
import { startTracking, stopTracking, isTracking, elapsedMs, snapshot, seedFromDraft, distanceMetersSoFar, fmtDistance, lastPoint, haversineMeters } from '../lib/gps-track';
import { isVoiceDictationSupported, startDictation, stopDictation, isDictating } from '../lib/voice-dictation';
import { parseObservationVoice } from '../lib/voice-parse';
import { renderTrackPreview } from '../lib/track-preview';
import { saveDraft, loadDraft, clearDraft, type ObservationDraft } from '../lib/draft';
import { qs, input } from '../lib/dom';
import { icon } from '../lib/icons';
import { wireDropdown } from '../lib/dropdown-select';
import { navigate, goBack } from '../main';
import type { ViewParams } from './view';
import type { Observation, ObservationImage, SpeciesEntry, LocationRow, ObservationTrack, TagRow, ObserverRow, TrackReportPin } from '../types';

interface PendingImage { id: string; file: File; url: string }
interface RowImages { pending: PendingImage[]; kept: ObservationImage[] }

const DEFAULT_TAG_COLORS = ['#2e7d32', '#1565c0', '#c62828', '#6a1b9a', '#ef6c00', '#00838f'];

let container: HTMLElement;
let speciesCache: string[] = [];
let seenSpeciesCache: string[] = [];
let availableTags: TagRow[] = [];
let selectedTags = new Set<string>();
let availableObservers: ObserverRow[] = [];
let selectedObservers = new Set<string>();
let locationSuggestions: string[] = [];
let editId: string | null = null;
let prefillSpecies: string | null = null;
let prefillCoords: { lat: number; lng: number } | null = null;
let prefillLocationName: string | null = null;
let prefillDate: string | null = null;
let prefillEntries: { species: string; quantity: number; note?: string }[] | null = null;
let prefillTags: string[] | null = null;
let prefillNotes: string | null = null;
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
/** Species reported while GPS recording was active this session — dropped
 * at the live position when a species row first gets a name, and again on
 * each "+" quantity-stepper press. Seeded from any prior save when
 * continuing an edit-session recording (see loadForEdit). */
let reportPins: TrackReportPin[] = [];
/** Rows that have already dropped their "new species" pin, so re-editing
 * the same row's text (e.g. fixing a typo) doesn't drop a second one. */
const pinnedSpeciesRows = new WeakSet<HTMLElement>();
const rowImages = new WeakMap<HTMLElement, RowImages>();

/** Drops a report pin at the current live GPS position — a no-op unless a
 * recording is actively in progress (per the feature's own scope: pins are
 * only meaningful while GPS is actually tracking "here, right now"). */
function dropReportPin(species: string, kind: TrackReportPin['kind']): void {
  const name = species.trim();
  if (!name || !isTracking()) return;
  const p = lastPoint();
  if (!p) return;
  reportPins.push({ lat: p.lat, lng: p.lng, species: name, kind, t: p.t });
}

export function init(el: HTMLElement): void {
  container = el;
  container.innerHTML = `
    <div class="form-head">
      <button type="button" class="btn btn-sm" id="back-btn">→ חזרה</button>
      <h2 id="form-title">תצפית חדשה</h2>
      <button type="button" class="btn btn-icon voice-dictate-btn emphasized" id="voice-dictate-btn" title="הכתבת תצפית בקול" aria-label="הכתבת תצפית בקול">${icon('mic')}</button>
    </div>
    <form id="obs-form" autocomplete="off">
      <div class="field-frame">
        <div class="field field-datetime-compact">
          <label for="f-datetime">תאריך ושעה</label>
          <div class="datetime-inline">
            ${icon('clock')}
            <input type="datetime-local" id="f-datetime" required>
          </div>
        </div>
      </div>

      <div class="field-frame">
        <div class="field-row location-row">
          <div class="field field-location-prominent">
            <label for="f-location">מיקום התצפית</label>
            <div class="combo with-arrow">
              <input type="text" id="f-location">
              <button type="button" class="combo-toggle" title="פתיחת הרשימה" aria-label="פתיחת הרשימה">▾</button>
              <div class="combo-list" id="location-list" hidden></div>
            </div>
          </div>
          <button type="button" class="btn btn-icon location-pin-btn" id="pick-map-btn" title="בחירת מיקום על המפה" aria-label="בחירת מיקום על המפה">${icon('pin')}</button>
        </div>
        <span class="hint" id="gps-status"></span>
        <div class="track-status voice-status" id="voice-status" hidden>
          <span class="track-dot"></span>
          <span id="voice-interim">מקשיב...</span>
        </div>
      </div>

      <label class="notif-toggle-row track-toggle-row" id="track-toggle-row" hidden>
        <span>הקלטת מסלול GPS לתצפית זו</span>
        <input type="checkbox" id="track-toggle">
      </label>
      <div class="track-status" id="track-status" hidden>
        <span class="track-dot"></span>
        <span>מקליט מסלול GPS · <span id="track-timer">00:00</span> · <span id="track-distance">0 מ'</span></span>
      </div>

      <div class="field-frame">
        <div class="field-row two-up">
          <div class="bulk-select" id="tags-select">
            <button type="button" class="bulk-select-btn wrap-chips" id="tags-select-btn" aria-expanded="false">
              <span class="select-chips" id="tags-select-label"><span class="select-placeholder">תגיות</span></span><span class="bulk-select-caret">▾</span>
            </button>
            <div class="bulk-select-menu" id="tags-select-menu" hidden>
              <div id="tag-checks"></div>
              <div class="tag-quick-add">
                <input type="text" id="f-tag-new" aria-label="הוספת תגית חדשה">
                <button type="button" class="btn btn-sm" id="f-tag-add">${icon('plus')} הוספה</button>
              </div>
            </div>
          </div>
          <div class="bulk-select" id="observers-select">
            <button type="button" class="bulk-select-btn wrap-chips" id="observers-select-btn" aria-expanded="false">
              <span class="select-chips" id="observers-select-label"><span class="select-placeholder">צופים</span></span><span class="bulk-select-caret">▾</span>
            </button>
            <div class="bulk-select-menu" id="observers-select-menu" hidden>
              <div id="observer-checks"></div>
              <div class="tag-quick-add">
                <input type="text" id="f-observer-new" aria-label="הוספת צופה חדש">
                <button type="button" class="btn btn-sm" id="f-observer-add">${icon('plus')} הוספה</button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div class="field-frame">
        <div class="field">
          <label>מיני הציפור</label>
          <div id="species-rows"></div>
          <button type="button" class="btn btn-sm" id="add-species-row" style="margin-top:6px">${icon('plus')} הוספת מין</button>
        </div>
      </div>

      <div class="field-frame">
        <div class="field">
          <label for="f-notes">הערות כלליות</label>
          <textarea id="f-notes"></textarea>
        </div>
      </div>

      <div class="field-frame">
        <div class="field">
          <label for="f-media-link">קישור לתמונות/סרטונים בענן</label>
          <input type="url" id="f-media-link">
        </div>
      </div>

      <button type="submit" class="btn btn-primary btn-block" id="save-btn">${icon('save')} שמירת התצפית</button>
    </form>
  `;

  wireDropdown(qs<HTMLButtonElement>(container, '#tags-select-btn'), qs(container, '#tags-select-menu'));
  wireDropdown(qs<HTMLButtonElement>(container, '#observers-select-btn'), qs(container, '#observers-select-menu'));
  qs(container, '#tag-checks').addEventListener('change', (e) => onTagCheckChange(e));
  qs(container, '#f-tag-add').addEventListener('click', () => void onQuickAddTag());
  input(container, '#f-tag-new').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); void onQuickAddTag(); } });
  qs(container, '#observer-checks').addEventListener('change', (e) => onObserverCheckChange(e));
  qs(container, '#f-observer-add').addEventListener('click', () => void onQuickAddObserver());
  input(container, '#f-observer-new').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); void onQuickAddObserver(); } });
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
  btn.title = 'הפסקת הקלטה';
  btn.setAttribute('aria-label', 'הפסקת הקלטה');
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
      btn.title = 'הכתבת תצפית בקול';
      btn.setAttribute('aria-label', 'הכתבת תצפית בקול');
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
  reportPins = [];
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
      tags: [...selectedTags],
      observers: [...selectedObservers],
      location: input(container, '#f-location').value,
      lat: currentLat,
      lng: currentLng,
      coordsLocked,
      notes: qs<HTMLTextAreaElement>(container, '#f-notes').value,
      mediaLink: input(container, '#f-media-link').value,
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
  selectedTags = new Set(draft.fields.tags ?? []);
  renderTagPicker();
  selectedObservers = new Set(draft.fields.observers ?? []);
  renderObserverPicker();
  input(container, '#f-location').value = draft.fields.location;
  currentLat = draft.fields.lat;
  currentLng = draft.fields.lng;
  coordsLocked = draft.fields.coordsLocked;
  updateLocationPinUI();
  qs<HTMLTextAreaElement>(container, '#f-notes').value = draft.fields.notes;
  input(container, '#f-media-link').value = draft.fields.mediaLink ?? '';
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
    reportPins: reportPins.length ? reportPins : undefined,
    previewImage: renderTrackPreview(result.segments, reportPins) ?? undefined,
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
  prefillEntries = params?.prefillEntries?.length ? params.prefillEntries : null;
  prefillTags = params?.prefillTags?.length ? params.prefillTags : null;
  prefillNotes = params?.prefillNotes || null;
  resumeDraftRequested = params?.resumeDraft || false;
}

export async function activate(): Promise<void> {
  speciesCache = await listSpecies();
  const all = await listObservations();
  const seen = new Set<string>();
  for (const o of all) for (const name of speciesNames(o)) seen.add(name);
  seenSpeciesCache = speciesCache.filter((s) => seen.has(s));
  availableTags = await listTagRows();
  availableObservers = await listObserverRows();
  const savedLocationRows = await listLocationRows();
  savedLocations = new Map(savedLocationRows.map((l) => [l.name, l]));
  // `all` is already newest-first by observation date, so de-duping by first
  // occurrence surfaces each location in order of its most recent use.
  // Saved locations never yet used in an observation have no "last used"
  // date, so they're appended alphabetically at the end.
  const usedByRecency: string[] = [];
  const used = new Set<string>();
  for (const o of all) {
    if (o.locationName && !used.has(o.locationName)) { used.add(o.locationName); usedByRecency.push(o.locationName); }
  }
  const neverUsed = savedLocationRows.map((l) => l.name).filter((n) => !used.has(n)).sort((a, b) => a.localeCompare(b, 'he'));
  locationSuggestions = [...usedByRecency, ...neverUsed];

  if (editId) {
    await loadForEdit(editId);
    if (resumeDraftRequested) resumeFromDraft();
    resumeDraftRequested = false;
    return;
  }

  resetForm(!prefillCoords);
  if (prefillEntries) setEntries(prefillEntries);
  else if (prefillSpecies) setEntries([{ species: prefillSpecies, quantity: 1 }]);
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
  if (prefillTags) {
    const known = new Set(availableTags.map((t) => t.name));
    selectedTags = new Set(prefillTags.filter((t) => known.has(t)));
    renderTagPicker();
  }
  if (prefillNotes) qs<HTMLTextAreaElement>(container, '#f-notes').value = prefillNotes;
  prefillSpecies = null;
  prefillCoords = null;
  prefillLocationName = null;
  prefillDate = null;
  prefillEntries = null;
  prefillTags = null;
  prefillNotes = null;

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
  selectedTags = new Set();
  renderTagPicker();
  selectedObservers = new Set();
  renderObserverPicker();
  currentLat = null;
  currentLng = null;
  coordsLocked = false;
  updateLocationPinUI();
  if (locate) autoFillGps();
  pendingTrack = null;
  existingTrackForEdit = null;
  seededFromExistingTrack = false;
  reportPins = [];
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
  // Continuing a recording on an existing track keeps its prior pins and
  // just appends new ones from this session (see buildTrack()).
  reportPins = existingTrackForEdit?.reportPins ? [...existingTrackForEdit.reportPins] : [];
  stopTrackTimer();
  qs<HTMLInputElement>(container, '#track-toggle').checked = false;
  qs(container, '#track-toggle-row').hidden = false;
  startDraftAutosave();
  qs(container, '#form-title').textContent = 'עריכת תצפית';
  qs(container, '#save-btn').innerHTML = `${icon('save')} עדכון התצפית`;
  input(container, '#f-datetime').value = toLocalInputValue(new Date(obs.dateTime));
  input(container, '#f-location').value = obs.locationName || '';
  selectedTags = new Set(obs.tags?.length ? obs.tags : (obs.project ? [obs.project] : []));
  renderTagPicker();
  currentLat = obs.lat ?? null;
  currentLng = obs.lng ?? null;
  applyLocationName(obs.locationName || '');
  const entries = entriesOf(obs);
  // legacy top-level images fold into the first entry for editing
  const withLegacy = entries.map((e, i) =>
    i === 0 && obs.images?.length ? { ...e, images: [...entryImages(e), ...obs.images] } : e);
  setEntries(withLegacy.length ? withLegacy : [{ species: '', quantity: 1 }]);
  qs<HTMLTextAreaElement>(container, '#f-notes').value = obs.notes || '';
  input(container, '#f-media-link').value = obs.mediaLink || '';
  selectedObservers = new Set(obs.observers ?? []);
  renderObserverPicker();
}

/** Deterministic color for entities that have no stored color of their own
 * (observers) — hashes the name so the same person always gets the same
 * chip color across renders, without needing a persisted field. */
function colorForName(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  return DEFAULT_TAG_COLORS[hash % DEFAULT_TAG_COLORS.length]!;
}

function selectChipHtml(name: string, color: string, iconHtml = ''): string {
  return `<span class="select-chip" style="background:${color}22;color:${color};border-color:${color}66">${iconHtml}${escapeHtml(name)}</span>`;
}

/* ---------- tags (compact dropdown checklist; replaces the old single project field) ---------- */

function renderTagPicker(): void {
  const el = qs(container, '#tag-checks');
  el.innerHTML = availableTags.length
    ? availableTags.map((t) => `
      <label class="filter-modal-check">
        <input type="checkbox" class="f-tag-check" value="${escapeHtml(t.name)}" ${selectedTags.has(t.name) ? 'checked' : ''}>
        <span>${icon(t.icon)} ${escapeHtml(t.name)}</span>
      </label>`).join('')
    : '<p class="hint" style="padding:2px 0">אין עדיין תגיות — אפשר להוסיף אחת למטה.</p>';
  updateTagsSelectLabel();
}

function updateTagsSelectLabel(): void {
  const el = qs(container, '#tags-select-label');
  el.innerHTML = selectedTags.size
    ? [...selectedTags].map((name) => {
      const t = availableTags.find((x) => x.name === name);
      return selectChipHtml(name, t?.color || colorForName(name), t ? icon(t.icon) : '');
    }).join('')
    : '<span class="select-placeholder">תגיות</span>';
}

function onTagCheckChange(e: Event): void {
  const cb = (e.target as HTMLElement).closest<HTMLInputElement>('.f-tag-check');
  if (!cb) return;
  if (cb.checked) selectedTags.add(cb.value); else selectedTags.delete(cb.value);
  updateTagsSelectLabel();
}

/* ---------- observers (compact dropdown checklist, same pattern as tags) ---------- */

function renderObserverPicker(): void {
  const el = qs(container, '#observer-checks');
  el.innerHTML = availableObservers.length
    ? availableObservers.map((o) => `
      <label class="filter-modal-check">
        <input type="checkbox" class="f-observer-check" value="${escapeHtml(o.name)}" ${selectedObservers.has(o.name) ? 'checked' : ''}>
        <span>${escapeHtml(o.name)}</span>
      </label>`).join('')
    : '<p class="hint" style="padding:2px 0">אין עדיין צופים שמורים — אפשר להוסיף אחד למטה.</p>';
  updateObserversSelectLabel();
}

function updateObserversSelectLabel(): void {
  const el = qs(container, '#observers-select-label');
  el.innerHTML = selectedObservers.size
    ? [...selectedObservers].map((name) => selectChipHtml(name, colorForName(name))).join('')
    : '<span class="select-placeholder">צופים</span>';
}

function onObserverCheckChange(e: Event): void {
  const cb = (e.target as HTMLElement).closest<HTMLInputElement>('.f-observer-check');
  if (!cb) return;
  if (cb.checked) selectedObservers.add(cb.value); else selectedObservers.delete(cb.value);
  updateObserversSelectLabel();
}

async function onQuickAddObserver(): Promise<void> {
  const inp = input(container, '#f-observer-new');
  const name = inp.value.trim();
  if (!name) return;
  if (!availableObservers.some((o) => o.name === name)) {
    await addObserver(name);
    availableObservers = await listObserverRows();
  }
  selectedObservers.add(name);
  inp.value = '';
  renderObserverPicker();
}

async function onQuickAddTag(): Promise<void> {
  const inp = input(container, '#f-tag-new');
  const name = inp.value.trim();
  if (!name) return;
  if (!availableTags.some((t) => t.name === name)) {
    await addTag(name, DEFAULT_TAG_COLORS[availableTags.length % DEFAULT_TAG_COLORS.length]!, 'tagGeneric');
    availableTags = await listTagRows();
  }
  selectedTags.add(name);
  inp.value = '';
  renderTagPicker();
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
  const btn = qs<HTMLButtonElement>(container, '#pick-map-btn');
  btn.classList.toggle('locked', coordsLocked);
  const title = coordsLocked
    ? 'מיקום קבוע — הצגה על המפה'
    : currentLat != null && currentLng != null
      ? 'מיקום נבחר — לחיצה לשינוי על המפה'
      : 'בחירת מיקום על המפה';
  btn.title = title;
  btn.setAttribute('aria-label', title);
}

/** A saved location (Settings → ניהול רשימת המיקומים) counts as "here" once
 * a fix lands within this many meters of it. */
const NEARBY_LOCATION_RADIUS_M = 500;

/** Whenever coordinates are (re)established — GPS auto-fill or a manual map
 * pick — snaps the location name to the closest saved location if one falls
 * within NEARBY_LOCATION_RADIUS_M, the same way typing a saved name locks
 * coordinates to it (see applyLocationName). Silently no-ops otherwise, so
 * an unrecognized spot just keeps whatever name/coords were set. */
function maybeSnapToNearbySavedLocation(lat: number, lng: number): void {
  let nearest: LocationRow | null = null;
  let nearestDist = Infinity;
  for (const loc of savedLocations.values()) {
    if (loc.lat == null || loc.lng == null) continue;
    const d = haversineMeters({ lat, lng, t: 0 }, { lat: loc.lat, lng: loc.lng, t: 0 });
    if (d < nearestDist) { nearestDist = d; nearest = loc; }
  }
  if (nearest && nearestDist <= NEARBY_LOCATION_RADIUS_M) {
    input(container, '#f-location').value = nearest.name;
    applyLocationName(nearest.name);
  }
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
      maybeSnapToNearbySavedLocation(currentLat, currentLng);
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
    maybeSnapToNearbySavedLocation(currentLat, currentLng);
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
  const hasNote = !!entry.note?.trim();
  row.innerHTML = `
    <div class="sp-entry-main">
      <div class="combo sp-combo">
        <input type="text" class="sp-input" aria-label="מין הציפור" value="${escapeHtml(entry.species)}">
        <div class="combo-list" hidden></div>
      </div>
      <div class="qty-stepper">
        <button type="button" class="btn btn-icon qty-minus" title="פחות">−</button>
        <input type="number" class="sp-qty" min="1" step="1" inputmode="numeric" value="${entry.quantity}" title="מספר פרטים">
        <button type="button" class="btn btn-icon qty-plus" title="עוד">+</button>
      </div>
      <div class="bulk-select sp-edit-select">
        <button type="button" class="btn btn-icon sp-edit-btn${hasNote ? ' has-content' : ''}" title="עריכת מין" aria-label="עריכת מין" aria-expanded="false">${icon('edit')}</button>
        <div class="bulk-select-menu sp-edit-menu" hidden>
          <button type="button" class="sp-menu-item sp-add-img">${icon('camera')} הוספת תמונה</button>
          <button type="button" class="sp-menu-item sp-note-toggle">${icon('document')} הערה למין זה</button>
          <button type="button" class="sp-menu-item sp-remove danger">${icon('trash')} הסרת מין</button>
        </div>
      </div>
      <input type="file" class="sp-file" accept="image/*,.heic,.tif,.tiff" multiple hidden>
    </div>
    <div class="sp-entry-second"${hasNote ? '' : ' hidden'}>
      <input type="text" class="sp-note" aria-label="הערה למין זה" value="${escapeHtml(entry.note || '')}">
    </div>
    <div class="sp-thumbs"></div>
  `;
  rows.appendChild(row);
  rowImages.set(row, { pending: [], kept: entry.images ? [...entry.images] : [] });
  // A row created with a species already filled in (editing, draft-restore,
  // voice dictation) isn't a fresh live report — never let it drop a pin.
  if (entry.species.trim()) pinnedSpeciesRows.add(row);

  const qtyInput = row.querySelector<HTMLInputElement>('.sp-qty')!;
  const spInput = row.querySelector<HTMLInputElement>('.sp-input')!;
  const maybeDropNewSpeciesPin = (): void => {
    if (pinnedSpeciesRows.has(row)) return;
    if (!spInput.value.trim()) return;
    pinnedSpeciesRows.add(row);
    dropReportPin(spInput.value, 'new');
  };
  const step = (delta: number): void => {
    qtyInput.value = String(Math.max(1, (parseInt(qtyInput.value, 10) || 1) + delta));
  };
  row.querySelector('.qty-minus')!.addEventListener('click', () => step(-1));
  row.querySelector('.qty-plus')!.addEventListener('click', () => {
    step(1);
    dropReportPin(spInput.value, 'add');
  });
  spInput.addEventListener('change', maybeDropNewSpeciesPin);

  const editBtn = row.querySelector<HTMLButtonElement>('.sp-edit-btn')!;
  const editMenu = row.querySelector<HTMLElement>('.sp-edit-menu')!;
  const disposeEditMenu = wireDropdown(editBtn, editMenu);

  const noteToggleBtn = row.querySelector<HTMLButtonElement>('.sp-note-toggle')!;
  const secondRow = row.querySelector<HTMLElement>('.sp-entry-second')!;
  const noteInput = row.querySelector<HTMLInputElement>('.sp-note')!;
  noteToggleBtn.addEventListener('click', () => {
    editMenu.hidden = true;
    secondRow.hidden = !secondRow.hidden;
    if (!secondRow.hidden) noteInput.focus();
  });
  noteInput.addEventListener('input', () => {
    editBtn.classList.toggle('has-content', !!noteInput.value.trim());
  });

  wireCombo(
    spInput,
    row.querySelector<HTMLElement>('.sp-combo .combo-list')!,
    () => speciesCache,
    { matchMode: 'prefix', getDefault: () => seenSpeciesCache, onSelect: () => maybeDropNewSpeciesPin() },
  );

  const fileInput = row.querySelector<HTMLInputElement>('.sp-file')!;
  row.querySelector('.sp-add-img')!.addEventListener('click', () => {
    editMenu.hidden = true;
    fileInput.click();
  });
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
    editMenu.hidden = true;
    if (container.querySelectorAll('#species-rows .sp-entry').length > 1) {
      disposeEditMenu();
      row.remove();
    } else {
      row.querySelector<HTMLInputElement>('.sp-input')!.value = '';
      noteInput.value = '';
      secondRow.hidden = true;
      editBtn.classList.remove('has-content');
      qtyInput.value = '1';
      rowImages.set(row, { pending: [], kept: [] });
      pinnedSpeciesRows.delete(row);
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
  const mediaLink = input(container, '#f-media-link').value.trim();
  if (mediaLink && !safeHttpUrl(mediaLink)) {
    toast('קישור התמונות/סרטונים אינו תקין — יש להזין כתובת מלאה שמתחילה ב-https://', true, 5000);
    return;
  }

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
    // `project` is deprecated but kept in sync (first tag) for any code path
    // not yet migrated off it — see types.ts.
    tags: [...selectedTags],
    project: [...selectedTags][0] || '',
    entries,
    images: [], // per-species now; keep empty for legacy field
    notes: qs<HTMLTextAreaElement>(container, '#f-notes').value,
    mediaLink,
    observers: [...selectedObservers],
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
