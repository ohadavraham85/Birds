/* views/form.ts — טופס הדיווח האחוד. נפתח מכפתור ה-➕ ביומן או מלחיצה על סיכה
 * במפה (עם קואורדינטות). תומך בכמה מיני ציפור, ולכל מין: כמות, הערה ותמונות
 * משלו. פרויקט/מיקום נבחרים מרשימה נפתחת עם אפשרות ליצירת ערך חדש. */

import {
  saveObservation, getObservation, listObservations, listSpecies,
  saveMedia, getMedia, mediaForObservation, deleteMedia, listLocationRows, listTagRows, addTag, listObserverRows, addObserver, saveTrack, getTrack,
  listSeriesRows, getSeries, lastSeriesForSpecies,
} from '../db/repository';
import { seriesDayLabel, openCreateSeriesModal } from '../lib/series';
import { toast, toLocalInputValue, fromLocalInputValue, safeHttpUrl, confirmDialog, showModal } from '../lib/ui';
import { haptic } from '../lib/haptics';
import { escapeHtml } from '../lib/markdown';
import { getImageObjectUrl } from '../lib/media';
import { pickFromGallery } from '../lib/photo-picker';
import { resolvePhotoDate } from '../lib/exif';
import { pickLocation } from '../lib/location-picker';
import { wireCombo } from '../lib/combo';
import { entriesOf, entryImages, speciesNames } from '../lib/observation';
import { startTracking, stopTracking, isTracking, elapsedMs, snapshot, seedFromDraft, distanceMetersSoFar, fmtDistance, lastPoint, haversineMeters, onTrackError } from '../lib/gps-track';
import { isVoiceDictationSupported, startDictation, stopDictation, isDictating } from '../lib/voice-dictation';
import { parseObservationVoice } from '../lib/voice-parse';
import { renderTrackPreview } from '../lib/track-preview';
import { createLiveTrackMap, type LiveTrackMap } from '../lib/track-map';
import { saveDraft, loadDraft, clearDraft, type ObservationDraft } from '../lib/draft';
import { qs, input } from '../lib/dom';
import { icon } from '../lib/icons';
import { wireDropdown } from '../lib/dropdown-select';
import { navigate, goBack } from '../main';
import type { ViewParams } from './view';
import type { Observation, ObservationImage, SpeciesEntry, LocationRow, ObservationTrack, TagRow, ObserverRow, TrackReportPin, SeriesRow } from '../types';

interface PendingImage { id: string; file: File; url: string }
interface RowImages { pending: PendingImage[]; kept: ObservationImage[] }

const DEFAULT_TAG_COLORS = ['#2e7d32', '#1565c0', '#c62828', '#6a1b9a', '#ef6c00', '#00838f'];
/** Auto-selected tag for every brand-new observation (still changeable) —
 * created once on first use if this household doesn't have it yet. */
const DEFAULT_TAG_NAME = 'כללי';

let container: HTMLElement;
let speciesCache: string[] = [];
let seenSpeciesCache: string[] = [];
let availableTags: TagRow[] = [];
let selectedTags = new Set<string>();
let availableObservers: ObserverRow[] = [];
let selectedObservers = new Set<string>();
/** The "מעקב" (tracking series) this observation is linked to, if any — see
 * types.ts's SeriesRow / Observation.seriesId and lib/series.ts. */
let linkedSeriesId: string | null = null;
let linkedSeriesCache: SeriesRow | null = null;
let locationSuggestions: string[] = [];
let editId: string | null = null;
let prefillSpecies: string | null = null;
let prefillCoords: { lat: number; lng: number } | null = null;
let prefillLocationName: string | null = null;
let prefillDate: string | null = null;
let prefillEntries: { species: string; quantity: number; note?: string }[] | null = null;
let prefillTags: string[] | null = null;
let prefillNotes: string | null = null;
let prefillMediaId: string | null = null;
let prefillSeriesId: string | null = null;
let resumeDraftRequested = false;
let draftInterval: ReturnType<typeof setInterval> | null = null;
let draftSaveDebounce: ReturnType<typeof setTimeout> | null = null;
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

/* ---------- species row swipe/long-press-to-delete ---------- */

const SPECIES_SWIPE_OPEN_PX = 84;
const SPECIES_SWIPE_TAP_THRESHOLD = 8;
let openSpeciesSwipeWrap: HTMLElement | null = null;

function closeSpeciesSwipe(wrap: HTMLElement): void {
  const front = wrap.querySelector<HTMLElement>('.sp-swipe-front');
  if (front) front.style.transform = 'translateX(0)';
  wrap.classList.remove('sp-swipe-open');
  if (openSpeciesSwipeWrap === wrap) openSpeciesSwipeWrap = null;
}

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
    </div>
    <form id="obs-form" autocomplete="off">
      <div class="form-header-card">
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
                <input type="text" id="f-location" required>
                <button type="button" class="combo-toggle" title="פתיחת הרשימה" aria-label="פתיחת הרשימה">▾</button>
                <div class="combo-list" id="location-list" hidden></div>
              </div>
            </div>
            <button type="button" class="btn btn-icon location-pin-btn" id="pick-map-btn" title="בחירת מיקום על המפה" aria-label="בחירת מיקום על המפה">${icon('pin')}</button>
          </div>
          <span class="hint" id="gps-status"></span>
        </div>

        <label class="notif-toggle-row track-toggle-row" id="track-toggle-row" hidden>
          <span>הקלטת מסלול GPS לתצפית זו</span>
          <input type="checkbox" id="track-toggle">
        </label>
        <div class="track-status" id="track-status" hidden>
          <span class="track-dot"></span>
          <span>מקליט מסלול GPS · <span id="track-timer">00:00</span> · <span id="track-distance">0 מ'</span></span>
        </div>
        <div class="track-gps-warning" id="track-gps-warning" hidden>${icon('alert')} <span id="track-gps-warning-text"></span></div>
        <div class="track-live-map" id="track-live-map" hidden></div>

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
        <div class="field">
          <button type="button" class="btn btn-block series-link-btn" id="series-link-btn">
            ${icon('target')} <span id="series-link-label">קישור למעקב (קינון / נדידה...)</span>
          </button>
        </div>
      </div>

      <div class="field-frame species-frame">
        <div class="field">
          <label>מיני הציפור</label>
          <div id="species-rows"></div>
          <div class="species-row-actions">
            <button type="button" class="btn btn-sm" id="add-species-row">${icon('plus')} הוספת מין</button>
            <button type="button" class="btn btn-icon voice-dictate-btn" id="voice-dictate-btn" title="הכתבת תצפית בקול" aria-label="הכתבת תצפית בקול">${icon('mic')}</button>
          </div>
          <div class="track-status voice-status" id="voice-status" hidden>
            <span class="track-dot"></span>
            <span id="voice-interim">מקשיב...</span>
          </div>
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
  qs(container, '#series-link-btn').addEventListener('click', () => void openSeriesPicker());
  input(container, '#f-datetime').addEventListener('change', () => void renderSeriesButton());
  qs(container, '#add-species-row').addEventListener('click', () => addSpeciesRow({ species: '', quantity: 1 }, true));
  qs(container, '#back-btn').addEventListener('click', () => { stopAndDiscardTrack(); stopDictation(); goBack(); });
  qs(container, '#voice-dictate-btn').addEventListener('click', () => onVoiceDictateClick());
  qs<HTMLInputElement>(container, '#track-toggle').addEventListener('change', (e) => {
    if ((e.target as HTMLInputElement).checked) beginTrack();
    else stashTrack();
  });
  qs<HTMLFormElement>(container, '#obs-form').addEventListener('submit', (e) => void onSave(e));
  // Delegated: covers every text/date/textarea field and the tags/observers
  // checklists in one place, so a crash mid-edit never loses more than the
  // debounce window (see scheduleDraftSave) — plus explicit calls at a few
  // structural spots (add/remove species row, quick-add tag/observer) that
  // don't fire a native input/change event on the form itself.
  qs<HTMLFormElement>(container, '#obs-form').addEventListener('input', () => scheduleDraftSave());
  qs<HTMLFormElement>(container, '#obs-form').addEventListener('change', () => scheduleDraftSave());
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

/** Each tap listens for exactly this long, then auto-stops — a fixed,
 * predictable window instead of relying on the browser's own (inconsistent
 * across devices) silence-detection cutoff. */
const VOICE_DICTATE_MS = 5000;
let voiceDictateAutoStop: ReturnType<typeof setTimeout> | null = null;

function onVoiceDictateClick(): void {
  if (isDictating()) { stopDictation(); return; }
  if (!isVoiceDictationSupported()) {
    toast('הדפדפן הזה לא תומך בהכתבה קולית — נסו דפדפן Chrome, ורק כשיש חיבור אינטרנט (ההכתבה אינה עובדת אופליין)', true, 6000);
    return;
  }
  const btn = qs<HTMLButtonElement>(container, '#voice-dictate-btn');
  const status = qs(container, '#voice-status');
  const interim = qs(container, '#voice-interim');
  haptic(15);
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
      if (voiceDictateAutoStop) { clearTimeout(voiceDictateAutoStop); voiceDictateAutoStop = null; }
      haptic(15);
      btn.classList.remove('recording');
      btn.title = 'הכתבת תצפית בקול';
      btn.setAttribute('aria-label', 'הכתבת תצפית בקול');
      status.hidden = true;
    },
  }, { continuous: true });
  voiceDictateAutoStop = setTimeout(() => { if (isDictating()) stopDictation(); }, VOICE_DICTATE_MS);
}

/** Fills in whatever the dictated sentence could confidently be matched to
 * (a known species name, a number, a known location) and always keeps the
 * full transcript in the notes — so an unrecognized species/location name
 * is never silently dropped, just left as free text for manual cleanup. */
function applyVoiceResult(result: ReturnType<typeof parseObservationVoice>): void {
  if (result.species) {
    const rows = Array.from(container.querySelectorAll<HTMLElement>('#species-rows .sp-entry'));
    // A species already present in another row is a repeat mention (or a
    // dictation quirk re-processing the same phrase) rather than a second
    // bird — fold the count into the existing row instead of adding a
    // duplicate one.
    const existingRow = rows.find((r) => r.querySelector<HTMLInputElement>('.sp-input')!.value.trim() === result.species);
    if (existingRow) {
      const qtyInput = existingRow.querySelector<HTMLInputElement>('.sp-qty')!;
      qtyInput.value = String(Math.max(1, parseInt(qtyInput.value, 10) || 1) + result.quantity);
    } else {
      const emptyRow = rows.find((r) => !r.querySelector<HTMLInputElement>('.sp-input')!.value.trim());
      if (emptyRow) {
        emptyRow.querySelector<HTMLInputElement>('.sp-input')!.value = result.species;
        emptyRow.querySelector<HTMLInputElement>('.sp-qty')!.value = String(result.quantity);
      } else {
        addSpeciesRow({ species: result.species, quantity: result.quantity }, false);
      }
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
/** True once the track toggle has been switched on at least once this form
 * session (reset on resetForm()/loadForEdit()) — lets stopAndSaveTrack()
 * tell "the toggle was never turned on" (nothing to report) apart from "it
 * was turned on but ended up with fewer than 2 points" (buildTrack silently
 * discards those — worth telling the user about, since a route that never
 * saved otherwise looks identical to one that was simply never started). */
let trackEngagedThisSession = false;
/** Live while a recording is in progress — lets the warning banner below
 * react to `watchPosition` errors as they happen, instead of the toggle
 * silently looking like it's working (timer ticking, "מקליט" showing) right
 * up until save time, when a session that never captured a real fix quietly
 * produces no track at all. */
let trackErrorUnsub: (() => void) | null = null;
/** Timestamp of the last GPS fix the status panel already flashed for — lets
 * updateTrackTimer() (ticking every second) tell "a fresh point just landed"
 * apart from "still the same point as a second ago", so the flash is a real
 * live heartbeat tied to GPS actually working, not a decorative loop that'd
 * keep animating through a stall the same as when it's healthy. */
let lastFlashedPointT = 0;
/** The small live-following map shown while recording — created lazily on
 * the first beginTrack() of the form session and torn down in
 * stopTrackTimer() (covers pause, discard, and save alike, since all three
 * route through it), rather than kept alive across a whole edit session, so
 * a second recording starts with a clean Leaflet instance instead of
 * stacking tile layers on a stale one. */
let liveTrackMap: LiveTrackMap | null = null;

/** Messages shown for each `GeolocationPositionError.code` — see
 * https://developer.mozilla.org/docs/Web/API/GeolocationPositionError. */
const GPS_ERROR_MESSAGES: Record<number, string> = {
  1: 'אין הרשאת מיקום — יש לאשר גישה למיקום בהגדרות הדפדפן/המכשיר כדי שהמסלול יתועד',
  2: 'לא ניתן לקבל מיקום כרגע — ודאו שה-GPS פעיל במכשיר',
  3: 'מחפש אות GPS... אם זה נמשך, נסו לצאת לאזור פתוח יותר',
};

/** Some devices/browsers grant only "approximate" location (Android's
 * coarse-location permission tier) — combined with the high-accuracy request
 * this module makes, `watchPosition` can then just hang forever: no fix ever
 * arrives, but no error fires either, since as far as the browser's concerned
 * nothing has technically failed. That leaves the recording looking
 * completely normal (dot pulsing, timer ticking) while silently capturing
 * nothing, discovered only once the save-time "GPS-מסלול not saved" toast
 * appears. Shown once no fix has landed within this long after starting, so
 * there's at least a chance to fix it (switch to precise location) mid-walk
 * instead of finding out only at the end. */
const STALL_WARNING_MS = 20000;
const STALL_WARNING_TEXT = 'לא מתקבלת נקודת מיקום כבר זמן מה — ודאו שהרשאת המיקום של האפליקציה מוגדרת ל"מדויק"/"Precise" (לא "משוער") ושה-GPS פעיל במכשיר';

function handleTrackGpsError(err: GeolocationPositionError): void {
  const warning = container.querySelector<HTMLElement>('#track-gps-warning');
  const text = container.querySelector<HTMLElement>('#track-gps-warning-text');
  if (!warning || !text) return;
  text.textContent = GPS_ERROR_MESSAGES[err.code] || 'תקלה בקבלת מיקום GPS';
  warning.hidden = false;
}

function beginTrack(): void {
  pendingTrack = null;
  trackEngagedThisSession = true;
  if (existingTrackForEdit && !seededFromExistingTrack) {
    seedFromDraft(existingTrackForEdit.points, new Date(existingTrackForEdit.startedAt).getTime());
    seededFromExistingTrack = true;
  }
  startTracking();
  qs(container, '#track-status').hidden = false;
  qs(container, '#track-gps-warning').hidden = true;
  lastFlashedPointT = 0;
  const mapEl = qs<HTMLElement>(container, '#track-live-map');
  mapEl.hidden = false;
  if (!liveTrackMap) liveTrackMap = createLiveTrackMap(mapEl);
  trackErrorUnsub?.();
  trackErrorUnsub = onTrackError(handleTrackGpsError);
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
  liveTrackMap?.update(snapshot()?.points ?? []);
  const warning = container.querySelector<HTMLElement>('#track-gps-warning');
  const warningText = container.querySelector<HTMLElement>('#track-gps-warning-text');
  const p = lastPoint();
  if (p) {
    // A real fix has come through — whatever GPS trouble caused an earlier
    // warning (if any) has resolved, so stop showing it.
    if (warning) warning.hidden = true;
    // A genuinely new fix (not just the same one still sitting there from a
    // second ago) — flash the status panel as a live "GPS is actually
    // working" heartbeat, restarting the CSS animation via a reflow since
    // just re-adding an already-present class wouldn't replay it.
    if (p.t !== lastFlashedPointT) {
      lastFlashedPointT = p.t;
      const status = container.querySelector<HTMLElement>('#track-status');
      if (status) {
        status.classList.remove('track-status-flash');
        void status.offsetWidth;
        status.classList.add('track-status-flash');
      }
    }
  } else if (warning && warning.hidden && elapsedMs() >= STALL_WARNING_MS) {
    // No fix yet, and watchPosition hasn't reported an outright error either
    // (that path already shows its own message via handleTrackGpsError) —
    // most likely a device permission granting only approximate/coarse
    // location, which silently stalls a high-accuracy watch instead of
    // failing it outright.
    if (warningText) warningText.textContent = STALL_WARNING_TEXT;
    warning.hidden = false;
  }
}

function stopTrackTimer(): void {
  if (trackTimerHandle) { clearInterval(trackTimerHandle); trackTimerHandle = null; }
  trackErrorUnsub?.();
  trackErrorUnsub = null;
  const status = container.querySelector<HTMLElement>('#track-status');
  if (status) status.hidden = true;
  const warning = container.querySelector<HTMLElement>('#track-gps-warning');
  if (warning) warning.hidden = true;
  liveTrackMap?.destroy();
  liveTrackMap = null;
  const mapEl = container.querySelector<HTMLElement>('#track-live-map');
  if (mapEl) mapEl.hidden = true;
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
      ...(linkedSeriesId ? { seriesId: linkedSeriesId } : {}),
    },
    track,
  };
  saveDraft(draft);
}

function startDraftAutosave(): void {
  stopDraftAutosave();
  // The interval is just a backstop for things that don't fire input/change
  // (GPS points arriving passively while recording) — every actual field
  // edit is saved immediately (debounced) via scheduleDraftSave() below, so
  // a crash/reload never loses more than a fraction of a second of typing.
  draftInterval = setInterval(persistDraft, 2000);
}

function stopDraftAutosave(): void {
  if (draftInterval) { clearInterval(draftInterval); draftInterval = null; }
  if (draftSaveDebounce) { clearTimeout(draftSaveDebounce); draftSaveDebounce = null; }
}

/** Debounced immediate save, triggered by field edits (as opposed to the
 * interval above, which only catches passively-arriving GPS points). */
function scheduleDraftSave(): void {
  if (draftSaveDebounce) clearTimeout(draftSaveDebounce);
  draftSaveDebounce = setTimeout(() => { draftSaveDebounce = null; persistDraft(); }, 400);
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
  linkedSeriesId = draft.fields.seriesId || null;
  void renderSeriesButton();
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
 * observation's id. Returns 'saved', 'not-started' (the toggle was never
 * turned on — nothing to report), or 'insufficient-points' (the toggle WAS
 * on, but buildTrack ended up with fewer than 2 fixes — e.g. a very brief
 * recording, or a weak GPS signal that only ever managed a single fix — and
 * silently discarded it) so the caller can tell the user when a route they
 * thought was being recorded didn't actually save. */
async function stopAndSaveTrack(id: string): Promise<'saved' | 'not-started' | 'insufficient-points'> {
  stopTrackTimer();
  const finalTrack = isTracking() ? buildTrack(stopTracking()) : pendingTrack;
  const engaged = trackEngagedThisSession;
  pendingTrack = null;
  if (!finalTrack) return engaged ? 'insufficient-points' : 'not-started';
  await saveTrack({ ...finalTrack, id, updatedAt: '' });
  return 'saved';
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
  prefillMediaId = params?.prefillMediaId || null;
  prefillSeriesId = params?.prefillSeriesId || null;
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

  await ensureDefaultTag();
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
  if (prefillMediaId) await attachPrefillMedia(prefillMediaId);
  if (prefillSeriesId) {
    linkedSeriesId = prefillSeriesId;
    await renderSeriesButton();
  }
  prefillSpecies = null;
  prefillCoords = null;
  prefillLocationName = null;
  prefillDate = null;
  prefillEntries = null;
  prefillTags = null;
  prefillNotes = null;
  prefillMediaId = null;
  prefillSeriesId = null;

  if (resumeDraftRequested) resumeFromDraft();
  resumeDraftRequested = false;
}

/** Claims an "orphan" Gallery photo (not yet attached to any observation)
 * for this brand-new draft and attaches it as the first species row's
 * photo — used by the Gallery's "תצפית חדשה" action, the mirror of
 * pickFromGallery() but starting from the photo side instead of the form. */
async function attachPrefillMedia(mediaId: string): Promise<void> {
  const media = await getMedia(mediaId);
  if (!media || media.obsId) return; // gone, or already claimed elsewhere
  await saveMedia({ ...media, obsId });
  const row = container.querySelector<HTMLElement>('#species-rows .sp-entry');
  if (!row) return;
  rowImages.get(row)!.kept.push({ localId: media.id, name: media.name });
  await renderRowThumbs(row);
  scheduleDraftSave();
}

/** Creates the default "כללי" tag once per household, if it doesn't exist
 * yet — never overwrites an existing one (so a user who recolors/renames it
 * isn't fought on every new observation). */
async function ensureDefaultTag(): Promise<void> {
  if (availableTags.some((t) => t.name === DEFAULT_TAG_NAME)) return;
  await addTag(DEFAULT_TAG_NAME, DEFAULT_TAG_COLORS[0]!, 'tagGeneric');
  availableTags = await listTagRows();
}

function resetForm(locate = true): void {
  editId = null;
  obsId = crypto.randomUUID();
  qs<HTMLFormElement>(container, '#obs-form').reset();
  input(container, '#f-datetime').value = toLocalInputValue();
  setEntries([{ species: '', quantity: 1 }]);
  qs(container, '#form-title').textContent = 'תצפית חדשה';
  qs(container, '#save-btn').innerHTML = `${icon('save')} שמירת התצפית`;
  selectedTags = new Set(availableTags.some((t) => t.name === DEFAULT_TAG_NAME) ? [DEFAULT_TAG_NAME] : []);
  renderTagPicker();
  selectedObservers = new Set();
  renderObserverPicker();
  linkedSeriesId = null;
  void renderSeriesButton();
  currentLat = null;
  currentLng = null;
  coordsLocked = false;
  updateLocationPinUI();
  if (locate) autoFillGps();
  pendingTrack = null;
  trackEngagedThisSession = false;
  existingTrackForEdit = null;
  seededFromExistingTrack = false;
  reportPins = [];
  stopTrackTimer();
  qs(container, '#track-toggle-row').hidden = false;
  // A brand-new observation opened normally (not from tapping a specific
  // point on the map, which places a pin for a location being looked at
  // rather than a walk in progress) starts GPS track recording right away —
  // birding sessions are usually "walk first, log species as you go", so
  // requiring a manual tap to turn it on every single time just meant it
  // was forgotten more often than not.
  qs<HTMLInputElement>(container, '#track-toggle').checked = locate;
  if (locate) beginTrack();
  startDraftAutosave();
}

async function loadForEdit(id: string): Promise<void> {
  const obs = await getObservation(id);
  if (!obs) { resetForm(); return; }
  obsId = id;
  pendingTrack = null;
  trackEngagedThisSession = false;
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
  linkedSeriesId = obs.seriesId || null;
  await renderSeriesButton();
}

/* ---------- series ("מעקב") linking ---------- */

/** Updates the link button's label to reflect the current linked series (if
 * any), with its day-counter computed against this form's own date field —
 * not "now" — so editing an old observation shows what day of the series it
 * actually was, and a brand-new one shows where "today" falls. */
async function renderSeriesButton(): Promise<void> {
  const btn = qs<HTMLButtonElement>(container, '#series-link-btn');
  const label = qs(container, '#series-link-label');
  if (!linkedSeriesId) {
    btn.classList.remove('active');
    label.textContent = 'קישור למעקב (קינון / נדידה...)';
    linkedSeriesCache = null;
    return;
  }
  const series = linkedSeriesCache?.id === linkedSeriesId ? linkedSeriesCache : ((await getSeries(linkedSeriesId)) ?? null);
  linkedSeriesCache = series;
  btn.classList.add('active');
  if (!series) { label.textContent = 'מעקב (נמחק)'; return; }
  const iso = fromLocalInputValue(input(container, '#f-datetime').value);
  const asOf = iso ? new Date(iso) : new Date();
  label.textContent = `${series.name} · ${seriesDayLabel(series, asOf)}`;
}

/** Lists active series (matching this form's own species entries surfaced
 * first) to link this observation to, with actions to create a brand-new
 * series or unlink the currently-linked one. */
async function openSeriesPicker(): Promise<void> {
  const active = (await listSeriesRows()).filter((s) => s.status === 'active');
  const currentSpecies = new Set(collectDraftEntries().map((e) => e.species));
  const iso = fromLocalInputValue(input(container, '#f-datetime').value);
  const asOf = iso ? new Date(iso) : new Date();
  const sorted = [...active].sort((a, b) => {
    const am = a.species && currentSpecies.has(a.species) ? 0 : 1;
    const bm = b.species && currentSpecies.has(b.species) ? 0 : 1;
    return am - bm;
  });

  const wrap = document.createElement('div');
  wrap.className = 'series-modal';
  const rowHtml = (s: SeriesRow): string => `
    <button type="button" class="series-pick-row ${linkedSeriesId === s.id ? 'active' : ''}" data-series-id="${s.id}">
      <span class="series-pick-main">
        <span class="series-pick-name">${escapeHtml(s.name)}</span>
        ${s.species ? `<span class="series-pick-species">${escapeHtml(s.species)}</span>` : ''}
      </span>
      <span class="series-pick-day">${escapeHtml(seriesDayLabel(s, asOf))}</span>
    </button>`;
  wrap.innerHTML = `
    <h3>קישור למעקב</h3>
    ${sorted.length ? `<div class="series-pick-list">${sorted.map(rowHtml).join('')}</div>` : '<p class="hint">אין מעקבים פעילים כרגע.</p>'}
    <div class="modal-actions">
      <button type="button" class="btn btn-sm btn-primary" id="series-create-new">${icon('plus')} מעקב חדש</button>
      ${linkedSeriesId ? `<button type="button" class="btn btn-sm" id="series-unlink">ביטול קישור</button>` : ''}
      <button type="button" class="btn btn-sm" id="series-modal-close">סגירה</button>
    </div>`;
  const close = showModal(wrap);

  wrap.querySelectorAll<HTMLElement>('.series-pick-row').forEach((row) => {
    row.addEventListener('click', () => {
      linkedSeriesId = row.dataset.seriesId!;
      close();
      void renderSeriesButton();
      scheduleDraftSave();
    });
  });
  wrap.querySelector('#series-create-new')?.addEventListener('click', () => {
    close();
    void openNewSeriesForLinking();
  });
  wrap.querySelector('#series-unlink')?.addEventListener('click', () => {
    linkedSeriesId = null;
    close();
    void renderSeriesButton();
    scheduleDraftSave();
  });
  wrap.querySelector('#series-modal-close')?.addEventListener('click', () => close());
}

/** Creates a brand-new series and links this observation to it in one step
 * — name/species/start-date/expected-duration all pre-filled from this
 * form's own state (species from the form's single entry if there's exactly
 * one, start date from the form's own date, expected duration remembered
 * from the last series logged for the same species per the user's request).
 * Uses the shared modal (lib/series.ts) so its fields/behavior stay
 * identical to every other place a series gets created. */
async function openNewSeriesForLinking(): Promise<void> {
  const entries = collectDraftEntries();
  const defaultSpecies = entries.length === 1 ? entries[0]!.species : '';
  const iso = fromLocalInputValue(input(container, '#f-datetime').value) || new Date().toISOString();
  const lastForSpecies = defaultSpecies ? await lastSeriesForSpecies(defaultSpecies) : undefined;
  const created = await openCreateSeriesModal(speciesCache, {
    species: defaultSpecies || undefined,
    startDate: iso.slice(0, 10),
    expectedDurationDays: lastForSpecies?.expectedDurationDays,
  });
  if (!created) return;
  linkedSeriesId = created.id;
  await renderSeriesButton();
  scheduleDraftSave();
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
        <span>${escapeHtml(t.name)}</span>
      </label>`).join('')
    : '<p class="hint" style="padding:2px 0">אין עדיין תגיות — אפשר להוסיף אחת למטה.</p>';
  updateTagsSelectLabel();
}

function updateTagsSelectLabel(): void {
  const el = qs(container, '#tags-select-label');
  el.innerHTML = selectedTags.size
    ? [...selectedTags].map((name) => {
      const t = availableTags.find((x) => x.name === name);
      return selectChipHtml(name, t?.color || colorForName(name));
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
  scheduleDraftSave();
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
  scheduleDraftSave();
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
  scheduleDraftSave();
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

/** Wires a right-swipe (or long-press) gesture on a species row's card that
 * reveals a delete action at the leading edge — mirrors lib/swipe-actions.ts
 * but single-action (delete only) and also opens on long-press, since a
 * species row doesn't have its own "open detail" tap target to protect. */
function wireSpeciesSwipe(front: HTMLElement, wrap: HTMLElement): void {
  const LONG_PRESS_MS = 500;
  let startX = 0;
  let startY = 0;
  let dx = 0;
  let dragging = false;
  let decided: 'h' | 'v' | null = null;
  let longPressTimer: ReturnType<typeof setTimeout> | null = null;

  const openSwipe = (): void => {
    front.style.transition = '';
    front.style.transform = `translateX(${SPECIES_SWIPE_OPEN_PX}px)`;
    if (openSpeciesSwipeWrap && openSpeciesSwipeWrap !== wrap) closeSpeciesSwipe(openSpeciesSwipeWrap);
    wrap.classList.add('sp-swipe-open');
    openSpeciesSwipeWrap = wrap;
    haptic();
  };

  front.addEventListener('pointerdown', (e: PointerEvent) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if ((e.target as HTMLElement).closest('button, a, input, select, textarea')) return;
    startX = e.clientX; startY = e.clientY; dx = 0; dragging = true; decided = null;
    front.setPointerCapture(e.pointerId);
    front.style.transition = 'none';
    longPressTimer = setTimeout(() => {
      longPressTimer = null;
      if (dragging && !decided) { dragging = false; openSwipe(); }
    }, LONG_PRESS_MS);
  });
  front.addEventListener('pointermove', (e: PointerEvent) => {
    if (!dragging) return;
    const moveX = e.clientX - startX;
    const moveY = e.clientY - startY;
    if (!decided) {
      if (Math.abs(moveX) < SPECIES_SWIPE_TAP_THRESHOLD && Math.abs(moveY) < SPECIES_SWIPE_TAP_THRESHOLD) return;
      if (longPressTimer) { clearTimeout(longPressTimer); longPressTimer = null; }
      decided = Math.abs(moveX) > Math.abs(moveY) ? 'h' : 'v';
    }
    if (decided !== 'h' || moveX < 0) return;
    e.preventDefault();
    dx = Math.min(SPECIES_SWIPE_OPEN_PX, moveX);
    front.style.transform = `translateX(${dx}px)`;
  });
  const endDrag = (): void => {
    if (longPressTimer) { clearTimeout(longPressTimer); longPressTimer = null; }
    if (!dragging) return;
    dragging = false;
    front.style.transition = '';
    if (decided !== 'h') {
      front.style.transform = wrap.classList.contains('sp-swipe-open') ? `translateX(${SPECIES_SWIPE_OPEN_PX}px)` : 'translateX(0)';
      return;
    }
    if (dx < SPECIES_SWIPE_OPEN_PX / 2) { closeSpeciesSwipe(wrap); return; }
    openSwipe();
  };
  front.addEventListener('pointerup', endDrag);
  front.addEventListener('pointercancel', endDrag);
  front.addEventListener('click', (e) => {
    if (decided === 'h') { e.stopPropagation(); e.preventDefault(); return; }
    if (wrap.classList.contains('sp-swipe-open')) { closeSpeciesSwipe(wrap); e.stopPropagation(); e.preventDefault(); }
  });
}

/** Opens a fresh new-observation form pre-filled with one species, copying
 * this observation's date/time/location/tags — with the option to also
 * remove that species from here (persisting the removal immediately if this
 * is an already-saved observation, so it doesn't linger duplicated). */
async function onSplitSpeciesToStandalone(species: string, quantity: number, note: string, removeFromHere: () => void): Promise<void> {
  if (!species) { toast('יש לבחור מין לפני פתיחתו כתצפית נפרדת', true); return; }
  const datePart = input(container, '#f-datetime').value.split('T')[0];
  const locationName = input(container, '#f-location').value.trim();
  const lat = currentLat;
  const lng = currentLng;
  const tags = [...selectedTags];

  const remove = await confirmDialog(`להסיר את "${species}" מהתצפית הנוכחית לאחר פתיחתה כתצפית נפרדת?`, 'הסרה מכאן');
  if (remove) {
    if (editId) {
      const obs = await getObservation(editId);
      if (obs) {
        const remaining = entriesOf(obs).filter((e) => !(e.species === species && e.quantity === quantity && (e.note || '') === note));
        if (remaining.length) await saveObservation({ ...obs, entries: remaining, updatedAt: '' });
      }
    }
    removeFromHere();
  }

  navigate('form', {
    prefillEntries: [note ? { species, quantity, note } : { species, quantity }],
    date: datePart,
    ...(lat != null && lng != null ? { lat, lng } : {}),
    locationName: locationName || undefined,
    prefillTags: tags,
  });
}

function addSpeciesRow(entry: SpeciesEntry, focus: boolean): void {
  const rows = qs(container, '#species-rows');
  const wrap = document.createElement('div');
  wrap.className = 'sp-swipe-wrap';
  const deleteAction = document.createElement('button');
  deleteAction.type = 'button';
  deleteAction.className = 'sp-swipe-delete';
  deleteAction.innerHTML = `${icon('trash')}<span>מחיקה</span>`;
  const row = document.createElement('div');
  row.className = 'sp-entry sp-swipe-front';
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
          <button type="button" class="sp-menu-item sp-pick-gallery">${icon('grid')} בחירה מהגלריה</button>
          <button type="button" class="sp-menu-item sp-note-toggle">${icon('document')} הערה למין זה</button>
          <button type="button" class="sp-menu-item sp-split">${icon('openOut')} פתיחה כתצפית עצמאית</button>
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
  wrap.append(deleteAction, row);
  rows.appendChild(wrap);
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
  // A species can only live in one row — if typing/picking one here now
  // matches another row's species, fold this row's count (and note/images,
  // if any) into that row and remove this one instead of leaving a duplicate
  // sitting next to it.
  const maybeMergeDuplicateSpecies = (): boolean => {
    const species = spInput.value.trim();
    if (!species) return false;
    const other = Array.from(container.querySelectorAll<HTMLElement>('#species-rows .sp-entry'))
      .find((r) => r !== row && r.querySelector<HTMLInputElement>('.sp-input')!.value.trim() === species);
    if (!other) return false;
    const otherQtyInput = other.querySelector<HTMLInputElement>('.sp-qty')!;
    const addQty = Math.max(1, parseInt(qtyInput.value, 10) || 1);
    otherQtyInput.value = String(Math.max(1, parseInt(otherQtyInput.value, 10) || 1) + addQty);
    const noteText = noteInput.value.trim();
    if (noteText) {
      const otherNoteInput = other.querySelector<HTMLInputElement>('.sp-note')!;
      otherNoteInput.value = otherNoteInput.value.trim() ? `${otherNoteInput.value.trim()}; ${noteText}` : noteText;
      other.querySelector<HTMLElement>('.sp-entry-second')!.hidden = false;
      other.querySelector<HTMLButtonElement>('.sp-edit-btn')!.classList.add('has-content');
    }
    const thisImages = rowImages.get(row);
    const otherImages = rowImages.get(other);
    if (thisImages && otherImages && (thisImages.kept.length || thisImages.pending.length)) {
      otherImages.kept.push(...thisImages.kept);
      otherImages.pending.push(...thisImages.pending);
      void renderRowThumbs(other);
    }
    toast(`המין "${species}" כבר קיים בשורה אחרת — הכמויות אוחדו`, false, 4000);
    doRemove();
    return true;
  };
  const step = (delta: number): void => {
    qtyInput.value = String(Math.max(1, (parseInt(qtyInput.value, 10) || 1) + delta));
  };
  row.querySelector('.qty-minus')!.addEventListener('click', () => step(-1));
  row.querySelector('.qty-plus')!.addEventListener('click', () => {
    step(1);
    dropReportPin(spInput.value, 'add');
  });
  spInput.addEventListener('change', () => { if (!maybeMergeDuplicateSpecies()) maybeDropNewSpeciesPin(); });

  const editBtn = row.querySelector<HTMLButtonElement>('.sp-edit-btn')!;
  const editMenu = row.querySelector<HTMLElement>('.sp-edit-menu')!;
  // A row in the middle of a long list otherwise has its open menu painted
  // *underneath* every row below it — `.sp-swipe-front` (this row) sets its
  // own `position:relative; z-index:1` for the swipe-to-delete reveal, which
  // makes it a self-contained stacking context, so the menu's own z-index
  // can never outrank a later sibling row no matter how high it's set. Lift
  // this row's whole context above its siblings for as long as its menu is
  // open (see `.sp-menu-open` in app.css) — every path that can close the
  // menu goes through closeEditMenu() so the class always comes back off.
  const closeEditMenu = (): void => {
    editMenu.hidden = true;
    editBtn.setAttribute('aria-expanded', 'false');
    row.classList.remove('sp-menu-open');
  };
  const disposeEditMenu = wireDropdown(editBtn, editMenu, (open) => {
    row.classList.toggle('sp-menu-open', open);
  });

  const noteToggleBtn = row.querySelector<HTMLButtonElement>('.sp-note-toggle')!;
  const secondRow = row.querySelector<HTMLElement>('.sp-entry-second')!;
  const noteInput = row.querySelector<HTMLInputElement>('.sp-note')!;
  noteToggleBtn.addEventListener('click', () => {
    closeEditMenu();
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
    { getDefault: () => seenSpeciesCache, onSelect: () => { if (!maybeMergeDuplicateSpecies()) maybeDropNewSpeciesPin(); } },
  );

  const fileInput = row.querySelector<HTMLInputElement>('.sp-file')!;
  row.querySelector('.sp-add-img')!.addEventListener('click', () => {
    closeEditMenu();
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

  row.querySelector('.sp-pick-gallery')!.addEventListener('click', () => {
    closeEditMenu();
    void pickFromGallery(obsId).then((picked) => {
      if (!picked.length) return;
      rowImages.get(row)!.kept.push(...picked);
      void renderRowThumbs(row);
      scheduleDraftSave();
    });
  });

  const doRemove = (): void => {
    closeEditMenu();
    if (container.querySelectorAll('#species-rows .sp-entry').length > 1) {
      disposeEditMenu();
      wrap.remove();
    } else {
      spInput.value = '';
      noteInput.value = '';
      secondRow.hidden = true;
      editBtn.classList.remove('has-content');
      qtyInput.value = '1';
      rowImages.set(row, { pending: [], kept: [] });
      pinnedSpeciesRows.delete(row);
      closeSpeciesSwipe(wrap);
      void renderRowThumbs(row);
    }
    scheduleDraftSave();
  };
  row.querySelector('.sp-remove')!.addEventListener('click', doRemove);
  deleteAction.addEventListener('click', () => { haptic(); doRemove(); });
  wireSpeciesSwipe(row, wrap);

  row.querySelector('.sp-split')!.addEventListener('click', () => {
    closeEditMenu();
    void onSplitSpeciesToStandalone(spInput.value.trim(), Math.max(1, parseInt(qtyInput.value, 10) || 1), noteInput.value.trim(), doRemove);
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

/** Races a promise against a timeout so a stuck IndexedDB transaction (e.g.
 * contending with a Firebase sync write) surfaces as a clear, retryable
 * error after a long GPS session instead of leaving the save button looking
 * permanently unresponsive with no feedback at all — the underlying
 * operation isn't actually cancelled, but `saveObservation`/`saveTrack` are
 * plain upserts keyed by this form's stable `obsId`, so a retry (or the
 * original call quietly finishing late) is always safe to land twice. */
function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(message)), ms)),
  ]);
}

async function onSave(e: Event): Promise<void> {
  e.preventDefault();
  const rowEls = Array.from(container.querySelectorAll<HTMLElement>('#species-rows .sp-entry'));
  const iso = fromLocalInputValue(input(container, '#f-datetime').value);
  if (!iso) { toast('תאריך לא תקין', true); return; }
  if (!input(container, '#f-location').value.trim()) { toast('יש להזין מיקום תצפית', true); return; }
  const mediaLink = input(container, '#f-media-link').value.trim();
  if (mediaLink && !safeHttpUrl(mediaLink)) {
    toast('קישור התמונות/סרטונים אינו תקין — יש להזין כתובת מלאה שמתחילה ב-https://', true, 5000);
    return;
  }

  const saveBtn = qs<HTMLButtonElement>(container, '#save-btn');
  if (saveBtn.disabled) return; // already saving — ignore a double-tap instead of racing two saves
  const originalLabel = saveBtn.innerHTML;
  saveBtn.disabled = true;
  saveBtn.innerHTML = `${icon('save')} שומר...`;

  // Everything from here on used to run with no failure handling at all: an
  // exception (a full IndexedDB, a stuck transaction, anything) became an
  // unhandled promise rejection that the submit handler swallowed silently —
  // the button just looked dead, with zero indication anything went wrong.
  // The draft (species/track already autosaved every couple of seconds) is
  // deliberately left untouched on failure, so it's still resumable from the
  // Home screen's draft banner even if this save attempt didn't make it.
  try {
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
        const { date, source } = await resolvePhotoDate(p.file);
        await saveMedia({
          id: p.id, obsId, name: p.file.name || 'image', mime: p.file.type, blob: p.file,
          takenAt: date.toISOString(), takenAtSource: source,
        });
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
      seriesId: linkedSeriesId || undefined,
      deleted: false,
      updatedAt: '',
    };
    await withTimeout(saveObservation(obs), 20000, 'שמירת התצפית ארכה זמן רב מדי');
    const trackResult = await withTimeout(stopAndSaveTrack(obsId), 20000, 'שמירת מסלול ה-GPS ארכה זמן רב מדי');
    stopDraftAutosave();
    clearDraft();
    const savedMsg = editId ? 'התצפית עודכנה ✓' : 'התצפית נשמרה ✓';
    if (trackResult === 'insufficient-points') {
      toast(`${savedMsg} — אך מסלול ה-GPS לא נשמר: נאספו פחות מ-2 נקודות מיקום (ההקלטה הייתה קצרה מדי, או שהמכשיר לא הספיק לקבל מיקום)`, true, 8000);
    } else {
      toast(savedMsg);
    }
    navigate('cards');
  } catch (err) {
    console.error('Observation save failed:', err);
    toast('שמירת התצפית נכשלה — נסו שוב. הטיוטה שלכם (כולל מסלול ה-GPS) נשמרה אוטומטית ותוכלו לשחזר אותה ממסך הבית אם תצטרכו לרענן את האפליקציה.', true, 9000);
  } finally {
    saveBtn.disabled = false;
    saveBtn.innerHTML = originalLabel;
  }
}
