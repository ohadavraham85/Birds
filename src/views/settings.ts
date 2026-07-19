/* views/settings.ts — הגדרות: סנכרון לשרת, גיבוי/שחזור, נתוני דמה, ניהול נתונים. */

import {
  listSpecies, addSpecies, deleteSpecies, listSpeciesRows,
  listLocationRows, addLocation, updateLocationCoords, deleteLocation, seedLocationsFromObservations,
  findDuplicateSpeciesGroups, findDuplicateLocationGroups, mergeSpeciesNames, mergeLocationNames,
  clearAllData, listObservations, listObservationsRaw, getObservation, saveObservation,
  putObservationRaw, saveMedia, mediaForObservation, getSetting,
} from '../db/repository';
import type { DuplicateGroup } from '../db/repository';
import { reconfigureSync, serverUrl, syncNow, onSyncStatus } from '../sync/sync-engine';
import { getFirebaseSyncCode, configureFirebaseSync, isFirebaseSyncActive } from '../firebase/firestore-sync';
import { pickLocation } from '../lib/location-picker';
import { toast, confirmDialog, fmtDateTime } from '../lib/ui';
import { escapeHtml } from '../lib/markdown';
import { qs, input } from '../lib/dom';
import { icon } from '../lib/icons';
import { readExifDate } from '../lib/exif';
import { primarySpecies } from '../lib/observation';
import { THEMES, currentTheme, setTheme, type ThemeId } from '../lib/theme';
import type { Observation, SyncStatus, LocationRow } from '../types';

let container: HTMLElement;
let unsubStatus: (() => void) | null = null;
let speciesDupeGroups: DuplicateGroup[] = [];
let locationDupeGroups: DuplicateGroup[] = [];

interface PhotoImportRow {
  file: File;
  date: Date;
  dateSource: 'exif' | 'file';
  url: string;
  obsId: string | null;
}
let photoImportRows: PhotoImportRow[] = [];
let photoImportObsCache: Observation[] = [];

export function init(el: HTMLElement): void {
  container = el;
}

const STATE_LABEL: Record<SyncStatus['state'], string> = {
  idle: 'מסונכרן', syncing: 'מסנכרן...', offline: 'לא מקוון — ימתין לחיבור',
  error: 'שגיאת סנכרון', disabled: 'סנכרון כבוי (מקומי בלבד)',
};

export async function activate(): Promise<void> {
  const obsCount = (await listObservations()).length;
  const url = await serverUrl();
  const token = await getSetting<string>('syncToken', '');
  const lastSync = await getSetting<string | null>('lastSync', null);
  const fbCode = await getFirebaseSyncCode();
  let version = '';
  try { version = (await (await fetch('version.json')).json()).version; } catch { /* dev */ }

  const activeTheme = currentTheme();
  container.innerHTML = `
    <h2>הגדרות</h2>

    <div class="settings-card">
      <h3>${icon('palette')} עיצוב</h3>
      <p style="font-size:.9rem;color:var(--ink-soft);margin-top:0">בחרו ערכת צבעים לאפליקציה — משתנה מיד, ונשמרת במכשיר זה.</p>
      <div class="theme-picker" id="s-theme-picker">
        ${THEMES.map((t) => `
          <button type="button" class="theme-swatch${t.id === activeTheme ? ' active' : ''}" data-theme="${t.id}" title="${escapeHtml(t.label)}">
            <span class="theme-dot" style="background:${t.swatch}"></span>
            <span>${escapeHtml(t.label)}</span>
          </button>`).join('')}
      </div>
    </div>

    <div class="settings-card">
      <h3>${icon('cloud')} סנכרון לשרת</h3>
      <p style="font-size:.9rem;color:var(--ink-soft);margin-top:0">
        עבודה מלאה גם ללא רשת; כשמוגדרת כתובת שרת, השינויים מסתנכרנים אוטומטית
        כשחוזרת התקשורת. השאירו ריק לעבודה מקומית בלבד.
      </p>
      <div class="field">
        <label for="s-server">כתובת שרת הסנכרון (URL)</label>
        <input type="url" id="s-server" dir="ltr" style="text-align:left" placeholder="https://birds-sync.xxxxx.workers.dev" value="${escapeHtml(url)}">
      </div>
      <div class="field">
        <label for="s-token">קוד סנכרון <span class="hint">(סוד משותף לך ולחברים)</span></label>
        <input type="password" id="s-token" dir="ltr" style="text-align:left" placeholder="••••••••" value="${escapeHtml(token)}">
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn btn-primary" id="s-save-server">${icon('save')} שמירה</button>
        <button class="btn" id="s-sync-now">${icon('refresh')} סנכרון עכשיו</button>
      </div>
      <div class="settings-status" id="s-sync-status"></div>
      ${lastSync ? `<div class="settings-status">סנכרון אחרון: ${fmtDateTime(lastSync)}</div>` : ''}
    </div>

    <div class="settings-card">
      <h3>${icon('cloud')} סנכרון לענן (Firebase)</h3>
      <p style="font-size:.9rem;color:var(--ink-soft);margin-top:0">
        חלופה ל"סנכרון לשרת" למעלה — סנכרון דו-כיווני בזמן-אמת דרך Firebase.
        מזינים אותו "קוד משפחה" בכל המכשירים (טלפון, מחשב וכו') ותצפיות/מינים/
        מיקומים/תמונות שנשמרים באחד מופיעים אוטומטית בשאר, כולל אופליין.
      </p>
      <div class="field">
        <label for="s-fb-code">קוד משפחה <span class="hint">(בחרו מחרוזת ייחודית וסודית; אותו הקוד בכל המכשירים)</span></label>
        <input type="text" id="s-fb-code" dir="ltr" style="text-align:left" placeholder="לדוגמה: ohad-birds-2026" value="${escapeHtml(fbCode)}">
      </div>
      <button class="btn btn-primary" id="s-fb-save">${icon('save')} שמירה והפעלה</button>
      <div class="settings-status ${isFirebaseSyncActive() ? 'ok' : ''}" id="s-fb-status">
        ${fbCode ? (isFirebaseSyncActive() ? 'פעיל — מסתנכרן עם Firebase' : 'קוד שמור, מתחבר...') : 'לא מוגדר'}
      </div>
    </div>

    <div class="settings-card">
      <h3>${icon('save')} גיבוי ושחזור</h3>
      <p style="font-size:.9rem;color:var(--ink-soft);margin-top:0">
        קובץ גיבוי יחיד (כולל תמונות באיכות מקור). ניתן לשחזור בכל מכשיר.
      </p>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn btn-primary" id="s-backup">${icon('download')} הורדת קובץ גיבוי מלא</button>
        <label class="btn" style="cursor:pointer">${icon('upload')} שחזור מקובץ גיבוי
          <input type="file" id="s-restore" accept=".json,application/json" hidden>
        </label>
      </div>
    </div>

    <div class="settings-card">
      <h3>${icon('camera')} ייבוא תמונות לפי תאריך</h3>
      <p style="font-size:.9rem;color:var(--ink-soft);margin-top:0">
        בוחרים כמה תמונות בבת אחת — האפליקציה מזהה את תאריך הצילום (מתוך נתוני
        התמונה, ואם אין — מתאריך הקובץ) ומשייכת אוטומטית כל תמונה לתצפית הקרובה
        אליה ביותר בזמן. אפשר לשנות שיוך לכל תמונה או לדלג עליה לפני האישור.
        התמונות מצורפות למין הראשון שנרשם בתצפית.
      </p>
      <label class="btn btn-primary" style="cursor:pointer">${icon('upload')} בחירת תמונות
        <input type="file" id="s-photo-import-input" accept="image/*" multiple hidden>
      </label>
      <div class="photo-import-list" id="s-photo-import-list"></div>
      <button type="button" class="btn btn-primary" id="s-photo-import-confirm" style="margin-top:10px" hidden>${icon('save')} ייבוא תמונות</button>
    </div>

    <div class="settings-card">
      <h3>${icon('bird')} ניהול רשימת המינים</h3>
      <p style="font-size:.9rem;color:var(--ink-soft);margin-top:0">
        הרשימה המוצעת בטופס התצפית ובטאב "מינים". מחיקת מין מסירה אותו מהרשימה בלבד —
        תצפיות קיימות שכבר תיעדו אותו אינן נפגעות.
      </p>
      <div class="add-species-row">
        <input type="text" id="s-sp-new" placeholder="הוספת מין חדש לרשימה...">
        <button class="btn" id="s-sp-add">${icon('plus')} הוספה</button>
      </div>
      <div class="dupe-toolbar">
        <button type="button" class="btn btn-sm" id="s-sp-find-dupes">${icon('search')} איתור כפילויות</button>
        <button type="button" class="btn btn-sm btn-primary" id="s-sp-merge-all" hidden>${icon('layers')} מיזוג הכל</button>
      </div>
      <div class="dupe-list" id="s-species-dupes"></div>
      <div class="species-list" id="s-species-list"></div>
    </div>

    <div class="settings-card">
      <h3>${icon('pin')} ניהול רשימת המיקומים</h3>
      <p style="font-size:.9rem;color:var(--ink-soft);margin-top:0">
        מיקומים שמורים עם קואורדינטות קבועות — בחירת מיקום שמור בטופס תצפית חדשה
        תמלא את הקואורדינטות אוטומטית.
      </p>
      <div class="loc-add-row">
        <input type="text" id="s-loc-name" placeholder="שם מיקום חדש...">
        <input type="number" step="any" id="s-loc-lat" placeholder="קו רוחב" inputmode="decimal">
        <input type="number" step="any" id="s-loc-lng" placeholder="קו אורך" inputmode="decimal">
        <button type="button" class="btn btn-icon" id="s-loc-pick" title="בחירה על המפה" aria-label="בחירה על המפה">${icon('pin')}</button>
        <button class="btn" id="s-loc-add">${icon('plus')} הוספה</button>
      </div>
      <div class="dupe-toolbar">
        <button type="button" class="btn btn-sm" id="s-loc-find-dupes">${icon('search')} איתור כפילויות</button>
        <button type="button" class="btn btn-sm btn-primary" id="s-loc-merge-all" hidden>${icon('layers')} מיזוג הכל</button>
      </div>
      <div class="dupe-list" id="s-location-dupes"></div>
      <div class="species-list" id="s-location-list"></div>
      <button class="btn btn-sm" id="s-loc-seed" style="margin-top:10px">${icon('refresh')} ייבוא מיקומים מהתצפיות הקיימות</button>
    </div>

    <div class="settings-card">
      <h3>נתוני הדגמה</h3>
      <p style="font-size:.9rem;color:var(--ink-soft);margin-top:0">
        טעינת 20 תצפיות לדוגמה. אפשר להסירן בלחיצה בלי לפגוע בתצפיות אמיתיות.
      </p>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn btn-primary" id="s-demo-load">טעינת נתוני דמה</button>
        <button class="btn" id="s-demo-remove">${icon('trash')} הסרת נתוני הדמה</button>
      </div>
    </div>

    <div class="settings-card">
      <h3>${icon('database')} נתונים מקומיים</h3>
      <p style="font-size:.9rem;color:var(--ink-soft);margin-top:0">
        במכשיר זה שמורות כרגע ${obsCount} תצפיות. ${version ? `· גרסת אפליקציה: v${escapeHtml(version)}` : ''}
      </p>
      <button class="btn btn-danger" id="s-clear">${icon('trash')} מחיקת כל הנתונים</button>
    </div>
  `;

  qs(container, '#s-theme-picker').addEventListener('click', onThemePick);
  qs(container, '#s-save-server').addEventListener('click', () => void onSaveServer());
  qs(container, '#s-sync-now').addEventListener('click', () => void syncNow());
  qs(container, '#s-fb-save').addEventListener('click', () => void onSaveFirebaseSync());
  qs(container, '#s-backup').addEventListener('click', () => void onBackup());
  input(container, '#s-restore').addEventListener('change', (e) => void onRestore(e));
  input(container, '#s-photo-import-input').addEventListener('change', (e) => void onPhotoImportFilesChosen(e));
  qs(container, '#s-photo-import-list').addEventListener('change', (e) => onPhotoImportSelectChange(e));
  qs(container, '#s-photo-import-list').addEventListener('click', (e) => onPhotoImportRemoveClick(e));
  qs(container, '#s-photo-import-confirm').addEventListener('click', () => void onPhotoImportConfirm());
  photoImportRows = [];
  photoImportObsCache = [];
  qs(container, '#s-demo-load').addEventListener('click', () => void onLoadDemo());
  qs(container, '#s-demo-remove').addEventListener('click', () => void onRemoveDemo());
  qs(container, '#s-clear').addEventListener('click', () => void onClearData());

  qs(container, '#s-sp-add').addEventListener('click', () => void onAddSpeciesManaged());
  input(container, '#s-sp-new').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); void onAddSpeciesManaged(); } });
  qs(container, '#s-species-list').addEventListener('click', (e) => void onSpeciesListClick(e));
  void renderSpeciesManageList();

  speciesDupeGroups = [];
  qs(container, '#s-sp-find-dupes').addEventListener('click', () => void onFindSpeciesDupes());
  qs(container, '#s-sp-merge-all').addEventListener('click', () => void onMergeAllSpeciesDupes());
  qs(container, '#s-species-dupes').addEventListener('click', (e) => void onSpeciesDupesClick(e));

  qs(container, '#s-loc-add').addEventListener('click', () => void onAddLocationManaged());
  qs(container, '#s-loc-pick').addEventListener('click', () => void onPickLocationForAdd());
  qs(container, '#s-loc-seed').addEventListener('click', () => void onSeedLocations());
  qs(container, '#s-location-list').addEventListener('click', (e) => void onLocationListClick(e));
  qs(container, '#s-location-list').addEventListener('change', (e) => void onLocationCoordsChange(e));
  void renderLocationManageList();

  locationDupeGroups = [];
  qs(container, '#s-loc-find-dupes').addEventListener('click', () => void onFindLocationDupes());
  qs(container, '#s-loc-merge-all').addEventListener('click', () => void onMergeAllLocationDupes());
  qs(container, '#s-location-dupes').addEventListener('click', (e) => void onLocationDupesClick(e));

  unsubStatus?.();
  unsubStatus = onSyncStatus((s) => {
    const el = container.querySelector<HTMLElement>('#s-sync-status');
    if (!el) return;
    el.textContent = STATE_LABEL[s.state] + (s.pending ? ` · ${s.pending} ממתינים` : '') + (s.message ? ` — ${s.message}` : '');
    el.className = 'settings-status ' + (s.state === 'idle' ? 'ok' : s.state === 'error' ? 'err' : '');
  });
}

/* ---------- shared duplicate-group rendering ---------- */

function renderDupeGroups(el: HTMLElement | null, groups: DuplicateGroup[], radioPrefix: string): void {
  if (!el) return;
  if (!groups.length) { el.innerHTML = ''; return; }
  el.innerHTML = groups.map((g, i) => `
    <div class="dupe-group" data-idx="${i}">
      <div class="dupe-names">
        ${g.names.map((n, j) => `
          <label class="dupe-radio">
            <input type="radio" name="${radioPrefix}-canon-${i}" value="${escapeHtml(n)}" ${j === 0 ? 'checked' : ''}>
            <span>${escapeHtml(n)}</span>
          </label>`).join('')}
      </div>
      <button type="button" class="btn btn-sm merge-btn" data-idx="${i}">${icon('layers')} מיזוג</button>
    </div>`).join('');
}

function pickedCanonical(dupeListSelector: string, idx: number, group: DuplicateGroup): string {
  const checked = container.querySelector<HTMLInputElement>(
    `${dupeListSelector} .dupe-group[data-idx="${idx}"] input[type="radio"]:checked`,
  );
  return checked?.value || group.names[0];
}

/* ---------- species list management ---------- */

async function renderSpeciesManageList(): Promise<void> {
  const rows = await listSpeciesRows();
  const el = container.querySelector<HTMLElement>('#s-species-list');
  if (!el) return;
  el.innerHTML = rows.length
    ? rows.map((r) => `
      <div class="sp-row">
        <span>${escapeHtml(r.name)}</span>
        <button type="button" class="del" data-name="${escapeHtml(r.name)}" title="הסרה מהרשימה" aria-label="הסרה מהרשימה">${icon('trash')}</button>
      </div>`).join('')
    : '<p class="hint" style="padding:10px 12px">אין מינים ברשימה.</p>';
}

async function onAddSpeciesManaged(): Promise<void> {
  const inp = input(container, '#s-sp-new');
  const name = inp.value.trim();
  if (!name) return;
  await addSpecies(name);
  inp.value = '';
  await renderSpeciesManageList();
  toast(`"${name}" נוסף לרשימת המינים`);
}

async function onSpeciesListClick(e: Event): Promise<void> {
  const btn = (e.target as HTMLElement).closest<HTMLElement>('.del');
  if (!btn) return;
  const name = btn.dataset.name!;
  if (!(await confirmDialog(`להסיר את "${name}" מרשימת המינים? תצפיות קיימות לא ייפגעו.`, 'הסרה'))) return;
  await deleteSpecies(name);
  await renderSpeciesManageList();
  toast(`"${name}" הוסר מהרשימה`);
}

/* ---------- species duplicate finder / merge ---------- */

async function onFindSpeciesDupes(): Promise<void> {
  speciesDupeGroups = await findDuplicateSpeciesGroups();
  renderSpeciesDupes();
  if (!speciesDupeGroups.length) toast('לא נמצאו כפילויות ברשימת המינים');
}

function renderSpeciesDupes(): void {
  renderDupeGroups(container.querySelector<HTMLElement>('#s-species-dupes'), speciesDupeGroups, 'sp');
  const mergeAllBtn = container.querySelector<HTMLButtonElement>('#s-sp-merge-all');
  if (mergeAllBtn) mergeAllBtn.hidden = speciesDupeGroups.length < 2;
}

async function onSpeciesDupesClick(e: Event): Promise<void> {
  const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('.merge-btn');
  if (!btn) return;
  const idx = Number(btn.dataset.idx);
  const group = speciesDupeGroups[idx];
  if (!group) return;
  const canonical = pickedCanonical('#s-species-dupes', idx, group);
  if (!(await confirmDialog(
    `למזג ${group.names.length} וריאציות של אותו מין ל-"${canonical}"? כל התצפיות הרלוונטיות יעודכנו, שאר הפרטים (כמות, הערות, תמונות) לא ייפגעו.`,
    'מיזוג',
  ))) return;
  const n = await mergeSpeciesNames(group.names, canonical);
  toast(`מוזגו ${group.names.length} שמות ל-"${canonical}" (${n} תצפיות עודכנו)`);
  speciesDupeGroups.splice(idx, 1);
  renderSpeciesDupes();
  await renderSpeciesManageList();
}

async function onMergeAllSpeciesDupes(): Promise<void> {
  if (!speciesDupeGroups.length) return;
  if (!(await confirmDialog(
    `למזג את כל ${speciesDupeGroups.length} קבוצות הכפילויות, כל אחת לפי השם שנבחר לה? התצפיות יעודכנו, שאר הפרטים לא ייפגעו.`,
    'מיזוג הכל',
  ))) return;
  let totalObs = 0;
  const groups = speciesDupeGroups.map((g, i) => ({ group: g, canonical: pickedCanonical('#s-species-dupes', i, g) }));
  for (const { group, canonical } of groups) totalObs += await mergeSpeciesNames(group.names, canonical);
  toast(`מוזגו ${groups.length} קבוצות כפילויות (${totalObs} תצפיות עודכנו)`);
  speciesDupeGroups = [];
  renderSpeciesDupes();
  await renderSpeciesManageList();
}

/* ---------- locations list management ---------- */

async function renderLocationManageList(): Promise<void> {
  const rows = await listLocationRows();
  const el = container.querySelector<HTMLElement>('#s-location-list');
  if (!el) return;
  el.innerHTML = rows.length
    ? rows.map((r) => `
      <div class="sp-row loc-row" data-name="${escapeHtml(r.name)}">
        <span class="loc-row-name" title="${escapeHtml(r.name)}">${escapeHtml(r.name)}</span>
        <input type="number" step="any" class="loc-lat" placeholder="קו רוחב" value="${r.lat ?? ''}" inputmode="decimal">
        <input type="number" step="any" class="loc-lng" placeholder="קו אורך" value="${r.lng ?? ''}" inputmode="decimal">
        <button type="button" class="del" data-name="${escapeHtml(r.name)}" title="מחיקה" aria-label="מחיקה">${icon('trash')}</button>
      </div>`).join('')
    : '<p class="hint" style="padding:10px 12px">אין מיקומים שמורים.</p>';
}

async function onAddLocationManaged(): Promise<void> {
  const nameInp = input(container, '#s-loc-name');
  const latInp = input(container, '#s-loc-lat');
  const lngInp = input(container, '#s-loc-lng');
  const name = nameInp.value.trim();
  if (!name) { toast('יש להזין שם מיקום', true); return; }
  const lat = latInp.value === '' ? null : parseFloat(latInp.value);
  const lng = lngInp.value === '' ? null : parseFloat(lngInp.value);
  await addLocation(name, lat != null && Number.isFinite(lat) ? lat : null, lng != null && Number.isFinite(lng) ? lng : null);
  nameInp.value = '';
  latInp.value = '';
  lngInp.value = '';
  await renderLocationManageList();
  toast(`"${name}" נוסף לרשימת המיקומים`);
}

async function onPickLocationForAdd(): Promise<void> {
  const latInp = input(container, '#s-loc-lat');
  const lngInp = input(container, '#s-loc-lng');
  const lat = parseFloat(latInp.value);
  const lng = parseFloat(lngInp.value);
  const initial = Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
  const result = await pickLocation(initial);
  if (result) {
    latInp.value = String(result.lat);
    lngInp.value = String(result.lng);
  }
}

async function onSeedLocations(): Promise<void> {
  const n = await seedLocationsFromObservations();
  toast(n ? `נוספו ${n} מיקומים מהתצפיות הקיימות` : 'אין מיקומים חדשים לייבוא');
  if (n) await renderLocationManageList();
}

async function onLocationListClick(e: Event): Promise<void> {
  const btn = (e.target as HTMLElement).closest<HTMLElement>('.del');
  if (!btn) return;
  const name = btn.dataset.name!;
  if (!(await confirmDialog(`למחוק את "${name}" מרשימת המיקומים?`, 'מחיקה'))) return;
  await deleteLocation(name);
  await renderLocationManageList();
  toast(`"${name}" נמחק מרשימת המיקומים`);
}

async function onLocationCoordsChange(e: Event): Promise<void> {
  const target = e.target as HTMLInputElement;
  if (!target.classList.contains('loc-lat') && !target.classList.contains('loc-lng')) return;
  const row = target.closest<HTMLElement>('.loc-row')!;
  const name = row.dataset.name!;
  const latVal = row.querySelector<HTMLInputElement>('.loc-lat')!.value;
  const lngVal = row.querySelector<HTMLInputElement>('.loc-lng')!.value;
  const lat = latVal === '' ? null : parseFloat(latVal);
  const lng = lngVal === '' ? null : parseFloat(lngVal);
  await updateLocationCoords(name, lat != null && Number.isFinite(lat) ? lat : null, lng != null && Number.isFinite(lng) ? lng : null);
  toast('הקואורדינטות נשמרו');
}

/* ---------- location duplicate finder / merge ---------- */

async function onFindLocationDupes(): Promise<void> {
  locationDupeGroups = await findDuplicateLocationGroups();
  renderLocationDupes();
  if (!locationDupeGroups.length) toast('לא נמצאו כפילויות ברשימת המיקומים');
}

function renderLocationDupes(): void {
  renderDupeGroups(container.querySelector<HTMLElement>('#s-location-dupes'), locationDupeGroups, 'loc');
  const mergeAllBtn = container.querySelector<HTMLButtonElement>('#s-loc-merge-all');
  if (mergeAllBtn) mergeAllBtn.hidden = locationDupeGroups.length < 2;
}

async function onLocationDupesClick(e: Event): Promise<void> {
  const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('.merge-btn');
  if (!btn) return;
  const idx = Number(btn.dataset.idx);
  const group = locationDupeGroups[idx];
  if (!group) return;
  const canonical = pickedCanonical('#s-location-dupes', idx, group);
  if (!(await confirmDialog(
    `למזג ${group.names.length} וריאציות של אותו מיקום ל-"${canonical}"? כל התצפיות הרלוונטיות יעודכנו, שאר הפרטים לא ייפגעו. הקואורדינטות הקיימות (של היעד או של אחת הוריאציות) יישמרו.`,
    'מיזוג',
  ))) return;
  const n = await mergeLocationNames(group.names, canonical);
  toast(`מוזגו ${group.names.length} שמות ל-"${canonical}" (${n} תצפיות עודכנו)`);
  locationDupeGroups.splice(idx, 1);
  renderLocationDupes();
  await renderLocationManageList();
}

async function onMergeAllLocationDupes(): Promise<void> {
  if (!locationDupeGroups.length) return;
  if (!(await confirmDialog(
    `למזג את כל ${locationDupeGroups.length} קבוצות הכפילויות, כל אחת לפי השם שנבחר לה? התצפיות יעודכנו, שאר הפרטים לא ייפגעו.`,
    'מיזוג הכל',
  ))) return;
  let totalObs = 0;
  const groups = locationDupeGroups.map((g, i) => ({ group: g, canonical: pickedCanonical('#s-location-dupes', i, g) }));
  for (const { group, canonical } of groups) totalObs += await mergeLocationNames(group.names, canonical);
  toast(`מוזגו ${groups.length} קבוצות כפילויות (${totalObs} תצפיות עודכנו)`);
  locationDupeGroups = [];
  renderLocationDupes();
  await renderLocationManageList();
}

function onThemePick(e: Event): void {
  const btn = (e.target as HTMLElement).closest<HTMLElement>('.theme-swatch');
  if (!btn) return;
  setTheme(btn.dataset.theme as ThemeId);
  qs(container, '#s-theme-picker').querySelectorAll('.theme-swatch').forEach((el) => {
    el.classList.toggle('active', el === btn);
  });
}

async function onSaveServer(): Promise<void> {
  const url = input(container, '#s-server').value.trim();
  const token = input(container, '#s-token').value.trim();
  await reconfigureSync(url, token);
  toast(url ? 'הגדרות הסנכרון נשמרו — מסנכרן...' : 'סנכרון כובה (עבודה מקומית)');
}

async function onSaveFirebaseSync(): Promise<void> {
  const code = input(container, '#s-fb-code').value.trim();
  const btn = qs<HTMLButtonElement>(container, '#s-fb-save');
  const statusEl = qs(container, '#s-fb-status');
  btn.disabled = true;
  try {
    await configureFirebaseSync(code);
    statusEl.textContent = code ? 'מתחבר ל-Firebase...' : 'לא מוגדר';
    statusEl.classList.remove('err');
    statusEl.classList.toggle('ok', !!code);
    toast(code ? 'קוד המשפחה נשמר — מסתנכרן עם Firebase...' : 'סנכרון Firebase כובה');
  } catch (err) {
    statusEl.textContent = 'שגיאת חיבור ל-Firebase — ודאו ש-Firestore ו-Storage מופעלים בפרויקט';
    statusEl.classList.remove('ok');
    statusEl.classList.add('err');
    toast('שגיאה בהתחברות ל-Firebase: ' + (err as Error).message, true, 6000);
  } finally {
    btn.disabled = false;
  }
}

/* ---------- backup / restore ---------- */

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result as string); r.onerror = rej; r.readAsDataURL(blob); });
}
async function dataUrlToBlob(dataUrl: string): Promise<Blob> {
  return (await fetch(dataUrl)).blob();
}

async function onBackup(): Promise<void> {
  toast('מכין קובץ גיבוי...', false, 8000);
  const observations = await listObservationsRaw();
  const species = await listSpecies();
  const locations = await listLocationRows();
  const media: Array<{ id: string; obsId: string; name: string; mime: string; data: string }> = [];
  for (const o of observations) {
    for (const m of await mediaForObservation(o.id)) {
      media.push({ id: m.id, obsId: m.obsId, name: m.name, mime: m.mime, data: await blobToDataUrl(m.blob) });
    }
  }
  const backup = { app: 'birds-journal', format: 2, exportedAt: new Date().toISOString(), species, locations, observations, media };
  const blob = new Blob([JSON.stringify(backup)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `גיבוי-תצפיות-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
  toast(`קובץ הגיבוי הורד ✓ (${observations.length} תצפיות, ${media.length} תמונות)`);
}

async function onRestore(e: Event): Promise<void> {
  const fileInput = e.target as HTMLInputElement;
  const file = fileInput.files?.[0];
  fileInput.value = '';
  if (!file) return;
  let backup: { app?: string; observations?: Observation[]; species?: string[]; locations?: LocationRow[]; media?: Array<{ id: string; obsId: string; name: string; mime: string; data: string }> };
  try {
    backup = JSON.parse(await file.text());
    if (backup.app !== 'birds-journal' || !Array.isArray(backup.observations)) throw new Error();
  } catch { toast('קובץ גיבוי לא תקין', true); return; }
  if (!(await confirmDialog(`לשחזר ${backup.observations!.length} תצפיות מהגיבוי?`, 'שחזור'))) return;
  for (const name of backup.species || []) await addSpecies(name, { sync: false });
  for (const l of backup.locations || []) await addLocation(l.name, l.lat, l.lng);
  for (const o of backup.observations!) {
    // migrate older backups that used a single species/quantity per row
    const legacy = o as unknown as { species?: string; quantity?: number };
    const entries = Array.isArray(o.entries)
      ? o.entries
      : [{ species: legacy.species ?? '', quantity: legacy.quantity ?? 1 }];
    await putObservationRaw({ ...o, entries, updatedAt: o.updatedAt || new Date().toISOString() });
  }
  for (const m of backup.media || []) {
    await saveMedia({ id: m.id, obsId: m.obsId, name: m.name, mime: m.mime, blob: await dataUrlToBlob(m.data) });
  }
  toast('השחזור הושלם ✓');
  await activate();
}

/* ---------- photo import (match by date to existing observations) ---------- */

function nearestObservation(obsList: Observation[], date: Date): Observation | null {
  let best: Observation | null = null;
  let bestDiff = Infinity;
  for (const o of obsList) {
    const diff = Math.abs(new Date(o.dateTime).getTime() - date.getTime());
    if (diff < bestDiff) { bestDiff = diff; best = o; }
  }
  return best;
}

async function onPhotoImportFilesChosen(e: Event): Promise<void> {
  const fileInput = e.target as HTMLInputElement;
  const files = Array.from(fileInput.files || []);
  fileInput.value = '';
  if (!files.length) return;
  photoImportObsCache = await listObservations();
  if (!photoImportObsCache.length) { toast('אין תצפיות קיימות לשיוך התמונות', true); return; }
  for (const file of files) {
    const exifDate = await readExifDate(file);
    const date = exifDate || new Date(file.lastModified);
    const nearest = nearestObservation(photoImportObsCache, date);
    photoImportRows.push({
      file, date, dateSource: exifDate ? 'exif' : 'file',
      url: URL.createObjectURL(file), obsId: nearest?.id ?? null,
    });
  }
  renderPhotoImportList();
}

function photoCountLabel(n: number): string {
  return n === 1 ? 'תמונה אחת' : `${n} תמונות`;
}
function obsCountLabel(n: number): string {
  return n === 1 ? 'תצפית אחת' : `${n} תצפיות`;
}

function renderPhotoImportList(): void {
  const el = container.querySelector<HTMLElement>('#s-photo-import-list');
  const confirmBtn = container.querySelector<HTMLButtonElement>('#s-photo-import-confirm');
  if (!el || !confirmBtn) return;
  if (!photoImportRows.length) { el.innerHTML = ''; confirmBtn.hidden = true; return; }
  el.innerHTML = photoImportRows.map((r, i) => {
    const sorted = [...photoImportObsCache]
      .sort((a, b) => Math.abs(new Date(a.dateTime).getTime() - r.date.getTime()) - Math.abs(new Date(b.dateTime).getTime() - r.date.getTime()))
      .slice(0, 30);
    return `
      <div class="photo-import-row" data-idx="${i}">
        <img class="photo-import-thumb" src="${r.url}" alt="">
        <div class="photo-import-info">
          <div class="photo-import-date">
            ${escapeHtml(fmtDateTime(r.date.toISOString()))}
            <span class="hint">${r.dateSource === 'exif' ? '(מתוך התמונה)' : '(תאריך קובץ)'}</span>
          </div>
          <select class="photo-import-select">
            <option value="">— לא לצרף —</option>
            ${sorted.map((o) => `
              <option value="${o.id}" ${o.id === r.obsId ? 'selected' : ''}>
                ${escapeHtml(fmtDateTime(o.dateTime))} · ${escapeHtml(o.locationName)}${primarySpecies(o) ? ' · ' + escapeHtml(primarySpecies(o)) : ''}
              </option>`).join('')}
          </select>
        </div>
        <button type="button" class="btn btn-icon photo-import-remove" title="הסרה" aria-label="הסרה">${icon('trash')}</button>
      </div>`;
  }).join('');
  confirmBtn.hidden = false;
  confirmBtn.innerHTML = `${icon('save')} ייבוא ${photoCountLabel(photoImportRows.filter((r) => r.obsId).length)}`;
}

function onPhotoImportSelectChange(e: Event): void {
  const target = e.target as HTMLElement;
  if (!target.classList.contains('photo-import-select')) return;
  const row = target.closest<HTMLElement>('.photo-import-row');
  if (!row) return;
  const idx = Number(row.dataset.idx);
  if (photoImportRows[idx]) photoImportRows[idx].obsId = (target as HTMLSelectElement).value || null;
  const confirmBtn = container.querySelector<HTMLButtonElement>('#s-photo-import-confirm');
  if (confirmBtn) confirmBtn.innerHTML = `${icon('save')} ייבוא ${photoImportRows.filter((r) => r.obsId).length} תמונות`;
}

function onPhotoImportRemoveClick(e: Event): void {
  const btn = (e.target as HTMLElement).closest<HTMLElement>('.photo-import-remove');
  if (!btn) return;
  const row = btn.closest<HTMLElement>('.photo-import-row');
  if (!row) return;
  const idx = Number(row.dataset.idx);
  const removed = photoImportRows.splice(idx, 1)[0];
  if (removed) URL.revokeObjectURL(removed.url);
  renderPhotoImportList();
}

async function onPhotoImportConfirm(): Promise<void> {
  const toImport = photoImportRows.filter((r) => r.obsId);
  if (!toImport.length) { toast('לא נבחרו תצפיות לשיוך', true); return; }
  if (!(await confirmDialog(`לצרף ${photoCountLabel(toImport.length)} לתצפיות שנבחרו?`, 'ייבוא'))) return;
  const touchedObsIds = new Set<string>();
  for (const row of toImport) {
    const obs = await getObservation(row.obsId!);
    if (!obs) continue;
    const mediaId = crypto.randomUUID();
    await saveMedia({ id: mediaId, obsId: obs.id, name: row.file.name || 'image', mime: row.file.type, blob: row.file });
    const entries = obs.entries?.length ? obs.entries : [{ species: '', quantity: 1 }];
    entries[0].images = [...(entries[0].images || []), { localId: mediaId, name: row.file.name || 'image' }];
    obs.entries = entries;
    await saveObservation(obs);
    touchedObsIds.add(obs.id);
  }
  for (const r of photoImportRows) URL.revokeObjectURL(r.url);
  photoImportRows = [];
  renderPhotoImportList();
  toast(`יובאו ${photoCountLabel(toImport.length)} ל-${obsCountLabel(touchedObsIds.size)} ✓`);
}

/* ---------- demo & clear ---------- */

async function onLoadDemo(): Promise<void> {
  const btn = qs<HTMLButtonElement>(container, '#s-demo-load');
  btn.disabled = true;
  try {
    const { loadDemoData } = await import('../data/demo-data');
    const n = await loadDemoData();
    toast(`נטענו ${n} תצפיות לדוגמה — עברו למסכי היומן, הרשימה והמפה`, false, 5000);
    await activate();
  } finally { btn.disabled = false; }
}

async function onRemoveDemo(): Promise<void> {
  const { removeDemoData } = await import('../data/demo-data');
  const n = await removeDemoData();
  toast(n ? `הוסרו ${n} תצפיות דמה` : 'אין נתוני דמה להסרה');
  await activate();
}

async function onClearData(): Promise<void> {
  if (!(await confirmDialog('למחוק את כל התצפיות והתמונות במכשיר זה? מומלץ להוריד גיבוי קודם.', 'מחיקת הכל'))) return;
  await clearAllData();
  toast('כל הנתונים נמחקו');
  await activate();
}
