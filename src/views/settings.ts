/* views/settings.ts — הגדרות: סנכרון לשרת, גיבוי/שחזור, נתוני דמה, ניהול נתונים. */

import {
  listSpecies, addSpecies, deleteSpecies, listSpeciesRows,
  listLocationRows, addLocation, updateLocationCoords, deleteLocation, seedLocationsFromObservations,
  clearAllData, listObservations, listObservationsRaw,
  putObservationRaw, saveMedia, mediaForObservation, getSetting,
} from '../db/repository';
import { reconfigureSync, serverUrl, syncNow, onSyncStatus } from '../sync/sync-engine';
import { pickLocation } from '../lib/location-picker';
import { toast, confirmDialog, fmtDateTime } from '../lib/ui';
import { escapeHtml } from '../lib/markdown';
import { qs, input } from '../lib/dom';
import { icon } from '../lib/icons';
import { THEMES, currentTheme, setTheme, type ThemeId } from '../lib/theme';
import type { Observation, SyncStatus, LocationRow } from '../types';

let container: HTMLElement;
let unsubStatus: (() => void) | null = null;

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
      <h3>${icon('bird')} ניהול רשימת המינים</h3>
      <p style="font-size:.9rem;color:var(--ink-soft);margin-top:0">
        הרשימה המוצעת בטופס התצפית ובטאב "מינים". מחיקת מין מסירה אותו מהרשימה בלבד —
        תצפיות קיימות שכבר תיעדו אותו אינן נפגעות.
      </p>
      <div class="add-species-row">
        <input type="text" id="s-sp-new" placeholder="הוספת מין חדש לרשימה...">
        <button class="btn" id="s-sp-add">${icon('plus')} הוספה</button>
      </div>
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
  qs(container, '#s-backup').addEventListener('click', () => void onBackup());
  input(container, '#s-restore').addEventListener('change', (e) => void onRestore(e));
  qs(container, '#s-demo-load').addEventListener('click', () => void onLoadDemo());
  qs(container, '#s-demo-remove').addEventListener('click', () => void onRemoveDemo());
  qs(container, '#s-clear').addEventListener('click', () => void onClearData());

  qs(container, '#s-sp-add').addEventListener('click', () => void onAddSpeciesManaged());
  input(container, '#s-sp-new').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); void onAddSpeciesManaged(); } });
  qs(container, '#s-species-list').addEventListener('click', (e) => void onSpeciesListClick(e));
  void renderSpeciesManageList();

  qs(container, '#s-loc-add').addEventListener('click', () => void onAddLocationManaged());
  qs(container, '#s-loc-pick').addEventListener('click', () => void onPickLocationForAdd());
  qs(container, '#s-loc-seed').addEventListener('click', () => void onSeedLocations());
  qs(container, '#s-location-list').addEventListener('click', (e) => void onLocationListClick(e));
  qs(container, '#s-location-list').addEventListener('change', (e) => void onLocationCoordsChange(e));
  void renderLocationManageList();

  unsubStatus?.();
  unsubStatus = onSyncStatus((s) => {
    const el = container.querySelector<HTMLElement>('#s-sync-status');
    if (!el) return;
    el.textContent = STATE_LABEL[s.state] + (s.pending ? ` · ${s.pending} ממתינים` : '') + (s.message ? ` — ${s.message}` : '');
    el.className = 'settings-status ' + (s.state === 'idle' ? 'ok' : s.state === 'error' ? 'err' : '');
  });
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
