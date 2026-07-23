/* views/settings.ts — הגדרות: מסך קטגוריות (עיצוב / סנכרון וגיבוי / רשימות /
 * ייבוא תמונות / התראות / נתונים מקומיים), כל קטגוריה נפתחת כמסך משלה. */

import {
  listSpecies, addSpecies, deleteSpecies, listSpeciesRows,
  listLocationRows, addLocation, updateLocationCoords, deleteLocation, seedLocationsFromObservations,
  listProjectRows, addProject, deleteProject, seedProjectsFromObservations,
  findDuplicateSpeciesGroups, findDuplicateLocationGroups, findDuplicateProjectGroups,
  mergeSpeciesNames, mergeLocationNames, mergeProjectNames,
  clearAllData, listObservations, listObservationsRaw, getObservation, saveObservation,
  putObservationRaw, saveMedia, mediaForObservation,
} from '../db/repository';
import type { DuplicateGroup } from '../db/repository';
import { getFirebaseSyncCode, configureFirebaseSync, onFirebaseSyncStatus, isFirebaseSyncActive, forceResyncListsFromCloud, type FirebaseSyncStatus } from '../firebase/firestore-sync';
import {
  notificationsSupported, permissionState, requestPermission,
  isEnabled, setEnabled, isMigrationEnabled, setMigrationEnabled, isOnThisDayEnabled, setOnThisDayEnabled,
  checkAndNotify, type NotifPermission,
} from '../lib/notifications';
import { pickLocation, type LatLng } from '../lib/location-picker';
import { toast, confirmDialog, fmtDateTime } from '../lib/ui';
import { escapeHtml } from '../lib/markdown';
import { qs, input } from '../lib/dom';
import { icon, type IconName } from '../lib/icons';
import { readExifDate } from '../lib/exif';
import { primarySpecies } from '../lib/observation';
import {
  THEMES, ACCENTS, FONT_COLORS, FONT_SIZES, FONT_WEIGHTS,
  currentTheme, currentAccent, currentFontColor, currentFontSize, currentFontWeight,
  setTheme, setAccent, setFontColor, setFontSize, setFontWeight,
  type ThemeId, type AccentId, type FontColorId, type FontSizeId, type FontWeightId,
} from '../lib/theme';
import type { Observation, LocationRow, ProjectRow } from '../types';

let container: HTMLElement;
let unsubStatus: (() => void) | null = null;
let speciesDupeGroups: DuplicateGroup[] = [];
let locationDupeGroups: DuplicateGroup[] = [];
let projectDupeGroups: DuplicateGroup[] = [];
let renamingSpecies: string | null = null;
let renamingLocation: string | null = null;
let renamingProject: string | null = null;
let selectedSpeciesNames = new Set<string>();
let selectedLocationNames = new Set<string>();
let newLocationCoords: LatLng | null = null;

interface PhotoImportRow {
  file: File;
  date: Date;
  dateSource: 'exif' | 'file';
  url: string;
  obsId: string | null;
}
let photoImportRows: PhotoImportRow[] = [];
let photoImportObsCache: Observation[] = [];

/* ---------- category menu ---------- */

type SettingsCategory = 'appearance' | 'sync' | 'lists' | 'photos' | 'notifications' | 'data';
let activeCategory: SettingsCategory | null = null;

const CATEGORY_META: Record<SettingsCategory, { icon: IconName; title: string; subtitle: string }> = {
  appearance: { icon: 'palette', title: 'עיצוב', subtitle: 'ערכת נושא, צבעים, גודל ומשקל טקסט' },
  sync: { icon: 'cloud', title: 'סנכרון וגיבוי', subtitle: 'סנכרון לענן (Firebase), גיבוי ושחזור' },
  lists: { icon: 'list', title: 'ניהול רשימות', subtitle: 'מינים, מיקומים ופרויקטים' },
  photos: { icon: 'camera', title: 'ייבוא תמונות', subtitle: 'שיוך תמונות לתצפיות לפי תאריך' },
  notifications: { icon: 'bell', title: 'התראות', subtitle: 'תזכורות נדידה ו"בתאריך הזה"' },
  data: { icon: 'database', title: 'נתונים מקומיים', subtitle: 'מידע על המכשיר, מחיקת הכל' },
};

export function init(el: HTMLElement): void {
  container = el;
}

function renderCategoryMenu(): void {
  container.innerHTML = `
    <h2>הגדרות</h2>
    <div class="settings-menu">
      ${(Object.keys(CATEGORY_META) as SettingsCategory[]).map((id) => {
        const c = CATEGORY_META[id];
        return `
        <button type="button" class="settings-menu-row" data-cat="${id}">
          <span class="settings-menu-icon">${icon(c.icon)}</span>
          <span class="settings-menu-text"><strong>${c.title}</strong><span class="hint">${c.subtitle}</span></span>
        </button>`;
      }).join('')}
    </div>
  `;
  qs(container, '.settings-menu').addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLElement>('.settings-menu-row');
    if (!btn) return;
    activeCategory = btn.dataset.cat as SettingsCategory;
    void activate();
  });
}

function fbStatusText(s: FirebaseSyncStatus): string {
  if (s.state === 'idle' && s.lastSync) return `הסנכרון לענן הושלם בהצלחה (${fmtDateTime(s.lastSync)})`;
  if (s.state === 'syncing') return 'מסנכרן עם הענן...';
  if (s.state === 'offline') {
    return s.pending
      ? 'יש שינויים מקומיים שטרם עלו לענן — יסתנכרנו אוטומטית כשיחזור החיבור'
      : 'הסנכרון לענן כשל — מצב אופליין / יש לבדוק חיבור לרשת';
  }
  if (s.state === 'error') return 'הסנכרון לענן כשל — יש לבדוק חיבור לרשת' + (s.message ? ` (${s.message})` : '');
  return 'לא מוגדר';
}

export async function activate(): Promise<void> {
  const obsCount = (await listObservations()).length;
  const fbCode = await getFirebaseSyncCode();
  let version = '';
  try { version = (await (await fetch('version.json')).json()).version; } catch { /* dev */ }

  const notifSupported = notificationsSupported();
  const notifPermission = permissionState();
  const notifEnabled = await isEnabled();
  const notifMigration = await isMigrationEnabled();
  const notifOnThisDay = await isOnThisDayEnabled();

  const activeTheme = currentTheme();
  const activeAccent = currentAccent();
  const activeFontColor = currentFontColor();
  const activeFontSize = currentFontSize();
  const activeFontWeight = currentFontWeight();

  unsubStatus?.();
  unsubStatus = null;

  if (!activeCategory) { renderCategoryMenu(); return; }

  const meta = CATEGORY_META[activeCategory];
  container.innerHTML = `
    <div class="settings-subhead">
      <button type="button" class="btn btn-sm" id="settings-back">→ הגדרות</button>
      <h2>${icon(meta.icon)} ${meta.title}</h2>
    </div>
    ${activeCategory === 'appearance' ? appearanceHtml(activeTheme, activeAccent, activeFontColor, activeFontSize, activeFontWeight) : ''}
    ${activeCategory === 'sync' ? syncHtml(fbCode) : ''}
    ${activeCategory === 'notifications' ? notificationsHtml(notifSupported, notifPermission, notifEnabled, notifMigration, notifOnThisDay) : ''}
    ${activeCategory === 'lists' ? listsHtml() : ''}
    ${activeCategory === 'photos' ? photosHtml() : ''}
    ${activeCategory === 'data' ? dataHtml(obsCount, version) : ''}
  `;

  qs(container, '#settings-back').addEventListener('click', () => { activeCategory = null; void activate(); });

  if (activeCategory === 'appearance') wireAppearance();
  if (activeCategory === 'sync') wireSync();
  if (activeCategory === 'notifications' && notifSupported) wireNotifications();
  if (activeCategory === 'lists') wireLists();
  if (activeCategory === 'photos') wirePhotos();
  if (activeCategory === 'data') wireData();
}

/* ---------- עיצוב ---------- */

function appearanceHtml(activeTheme: ThemeId, activeAccent: AccentId, activeFontColor: FontColorId, activeFontSize: FontSizeId, activeFontWeight: FontWeightId): string {
  return `
    <div class="settings-card">
      <p style="font-size:.9rem;color:var(--ink-soft);margin-top:0">
        התאימו את מראה האפליקציה — כל שינוי חל מיד ונשמר במכשיר זה.
      </p>

      <h4>ערכת נושא (רקע)</h4>
      <div class="theme-picker" id="s-theme-picker">
        ${THEMES.map((t) => `
          <button type="button" class="theme-swatch${t.id === activeTheme ? ' active' : ''}" data-theme="${t.id}" title="${escapeHtml(t.label)}">
            <span class="theme-dot" style="background:${t.swatch}"></span>
            <span>${escapeHtml(t.label)}</span>
          </button>`).join('')}
      </div>

      <h4>צבע דגש (Accent)</h4>
      <div class="theme-picker" id="s-accent-picker">
        ${ACCENTS.map((a) => `
          <button type="button" class="theme-swatch${a.id === activeAccent ? ' active' : ''}" data-accent="${a.id}" title="${escapeHtml(a.label)}">
            <span class="theme-dot${a.swatch ? '' : ' theme-dot-none'}" style="${a.swatch ? `background:${a.swatch}` : ''}"></span>
            <span>${escapeHtml(a.label)}</span>
          </button>`).join('')}
      </div>

      <h4>צבע טקסט</h4>
      <div class="theme-picker" id="s-font-color-picker">
        ${FONT_COLORS.map((f) => `
          <button type="button" class="theme-swatch${f.id === activeFontColor ? ' active' : ''}" data-font-color="${f.id}" title="${escapeHtml(f.label)}">
            <span class="theme-dot${f.swatch ? '' : ' theme-dot-none'}" style="${f.swatch ? `background:${f.swatch}` : ''}"></span>
            <span>${escapeHtml(f.label)}</span>
          </button>`).join('')}
      </div>

      <div class="row-2">
        <div>
          <h4>גודל טקסט</h4>
          <div class="seg-toggle" id="s-font-size-picker">
            ${FONT_SIZES.map((f) => `<button type="button" class="seg-btn${f.id === activeFontSize ? ' active' : ''}" data-font-size="${f.id}">${escapeHtml(f.label)}</button>`).join('')}
          </div>
        </div>
        <div>
          <h4>משקל טקסט</h4>
          <div class="seg-toggle" id="s-font-weight-picker">
            ${FONT_WEIGHTS.map((f) => `<button type="button" class="seg-btn${f.id === activeFontWeight ? ' active' : ''}" data-font-weight="${f.id}">${escapeHtml(f.label)}</button>`).join('')}
          </div>
        </div>
      </div>

      <h4>תצוגה מקדימה</h4>
      <div class="appearance-preview">
        <div class="appearance-preview-card">
          <span class="appearance-preview-eyebrow">${icon('bird')} ציפור היום</span>
          <span class="appearance-preview-title">חוגלה</span>
          <span class="appearance-preview-body">דוגמת טקסט משני — כך ייראו תיאורים ופרטים נוספים באפליקציה.</span>
          <button type="button" class="btn btn-primary appearance-preview-btn">${icon('save')} כפתור לדוגמה</button>
        </div>
      </div>
    </div>
  `;
}

function wireAppearance(): void {
  qs(container, '#s-theme-picker').addEventListener('click', onThemePick);
  qs(container, '#s-accent-picker').addEventListener('click', onAccentPick);
  qs(container, '#s-font-color-picker').addEventListener('click', onFontColorPick);
  qs(container, '#s-font-size-picker').addEventListener('click', onFontSizePick);
  qs(container, '#s-font-weight-picker').addEventListener('click', onFontWeightPick);
}

/* ---------- סנכרון וגיבוי ---------- */

function syncHtml(fbCode: string): string {
  return `
    <div class="settings-card">
      <h3>${icon('cloud')} סנכרון לענן (Firebase)</h3>
      <p style="font-size:.9rem;color:var(--ink-soft);margin-top:0">
        סנכרון דו-כיווני בזמן-אמת דרך Firebase. מזינים אותו "קוד משפחה" בכל
        המכשירים (טלפון, מחשב וכו') ותצפיות/מינים/מיקומים/פרויקטים/תמונות
        שנשמרים באחד מופיעים אוטומטית בשאר. עובד גם ללא רשת — השינויים נשמרים
        מיידית במכשיר ומסתנכרנים אוטומטית כשחוזר החיבור.
      </p>
      <div class="field">
        <label for="s-fb-code">קוד משפחה <span class="hint">(בחרו מחרוזת ייחודית וסודית; אותו הקוד בכל המכשירים)</span></label>
        <input type="text" id="s-fb-code" dir="ltr" style="text-align:left" placeholder="לדוגמה: ohad-birds-2026" value="${escapeHtml(fbCode)}">
      </div>
      <button class="btn btn-primary" id="s-fb-save">${icon('save')} שמירה והפעלה</button>
      <div class="settings-status" id="s-fb-status"></div>
      ${isFirebaseSyncActive() ? `
        <div style="margin-top:14px;padding-top:14px;border-top:1px solid var(--line)">
          <p style="font-size:.85rem;color:var(--ink-soft);margin-top:0">
            אם מכשיר אחר עשה שינויים (למשל מיזוג כפילויות ברשימת המינים) שלא
            מופיעים כאן, אפשר לאלץ סנכרון מחדש של רשימות המינים/מיקומים/פרויקטים
            מהענן — זה דורס את המצב המקומי שלהן במכשיר הזה בלי תנאי.
          </p>
          <button class="btn btn-sm" id="s-fb-resync">${icon('refresh')} סנכרון מחדש של הרשימות מהענן</button>
        </div>` : ''}
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
  `;
}

function wireSync(): void {
  qs(container, '#s-fb-save').addEventListener('click', () => void onSaveFirebaseSync());
  qs(container, '#s-backup').addEventListener('click', () => void onBackup());
  input(container, '#s-restore').addEventListener('change', (e) => void onRestore(e));
  container.querySelector('#s-fb-resync')?.addEventListener('click', () => void onForceResync());

  unsubStatus = onFirebaseSyncStatus((s) => {
    const el = container.querySelector<HTMLElement>('#s-fb-status');
    if (!el) return;
    el.textContent = fbStatusText(s);
    const isErr = s.state === 'error' || (s.state === 'offline' && !s.pending);
    el.className = 'settings-status ' + (s.state === 'idle' ? 'ok' : isErr ? 'err' : '');
  });
}

/* ---------- התראות ---------- */

function notificationsHtml(notifSupported: boolean, notifPermission: NotifPermission, notifEnabled: boolean, notifMigration: boolean, notifOnThisDay: boolean): string {
  return `
    <div class="settings-card">
      ${!notifSupported ? `
        <p style="font-size:.9rem;color:var(--ink-soft);margin-top:0">
          הדפדפן או המכשיר הזה אינו תומך בהתראות.
        </p>` : `
        <p style="font-size:.9rem;color:var(--ink-soft);margin-top:0">
          התראות מקומיות בלבד — נבדקות ומוצגות רק כשהאפליקציה נפתחת במכשיר זה,
          ללא שרת דחיפה מרוחק. ההגדרה נשמרת במכשיר זה בלבד ואינה מסתנכרנת.
        </p>
        <label class="notif-toggle-row">
          <span>הפעלת התראות</span>
          <input type="checkbox" id="s-notif-enabled" ${notifEnabled && notifPermission === 'granted' ? 'checked' : ''}>
        </label>
        ${notifPermission === 'denied' ? `
          <p class="settings-status err">החסימה נעשתה ברמת הדפדפן — יש לאשר התראות עבור האתר בהגדרות הדפדפן/המכשיר ולרענן.</p>` : ''}
        <div id="s-notif-sub" ${notifEnabled && notifPermission === 'granted' ? '' : 'hidden'}>
          <label class="notif-toggle-row">
            <span>תזכורות עונות נדידה</span>
            <input type="checkbox" id="s-notif-migration" ${notifMigration ? 'checked' : ''}>
          </label>
          <label class="notif-toggle-row">
            <span>תזכורות "בתאריך הזה" (תצפיות משנים קודמות)</span>
            <input type="checkbox" id="s-notif-on-this-day" ${notifOnThisDay ? 'checked' : ''}>
          </label>
        </div>`}
    </div>
  `;
}

function wireNotifications(): void {
  container.querySelector('#s-notif-enabled')?.addEventListener('change', (e) => void onNotifEnabledChange(e));
  container.querySelector('#s-notif-migration')?.addEventListener('change', (e) => {
    void setMigrationEnabled((e.target as HTMLInputElement).checked);
  });
  container.querySelector('#s-notif-on-this-day')?.addEventListener('change', (e) => {
    void setOnThisDayEnabled((e.target as HTMLInputElement).checked);
  });
}

/* ---------- ייבוא תמונות ---------- */

function photosHtml(): string {
  return `
    <div class="settings-card">
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
  `;
}

function wirePhotos(): void {
  input(container, '#s-photo-import-input').addEventListener('change', (e) => void onPhotoImportFilesChosen(e));
  qs(container, '#s-photo-import-list').addEventListener('change', (e) => onPhotoImportSelectChange(e));
  qs(container, '#s-photo-import-list').addEventListener('click', (e) => onPhotoImportRemoveClick(e));
  qs(container, '#s-photo-import-confirm').addEventListener('click', () => void onPhotoImportConfirm());
  photoImportRows = [];
  photoImportObsCache = [];
}

/* ---------- ניהול רשימות (מינים / מיקומים / פרויקטים) ---------- */

function listsHtml(): string {
  return `
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
        <button type="button" class="btn btn-sm btn-primary" id="s-sp-merge-selected" hidden>${icon('layers')} מיזוג הנבחרים (<span id="s-sp-sel-count">0</span>)</button>
      </div>
      <div class="dupe-list" id="s-species-dupes"></div>
      <div class="species-list" id="s-species-list"></div>
    </div>

    <div class="settings-card">
      <h3>${icon('pin')} ניהול רשימת המיקומים</h3>
      <p style="font-size:.9rem;color:var(--ink-soft);margin-top:0">
        מיקומים שמורים עם קואורדינטות קבועות, נבחרות על המפה — בחירת מיקום שמור
        בטופס תצפית חדשה תמלא את הקואורדינטות אוטומטית ותנעל אותן מפני שינוי.
        מחיקת מיקום מהרשימה אינה פוגעת בתצפיות קיימות — הן שומרות את השם
        והקואורדינטות שכבר נרשמו בהן, רק שהמיקום לא יינעל יותר אוטומטית בעריכה עתידית.
      </p>
      <div class="loc-add-row">
        <input type="text" id="s-loc-name" placeholder="שם מיקום חדש...">
        <button type="button" class="btn location-pin-btn" id="s-loc-pick">
          ${icon('pin')} <span id="s-loc-pick-label">בחירת מיקום על המפה</span>
        </button>
        <button class="btn" id="s-loc-add">${icon('plus')} הוספה</button>
      </div>
      <div class="dupe-toolbar">
        <button type="button" class="btn btn-sm" id="s-loc-find-dupes">${icon('search')} איתור כפילויות</button>
        <button type="button" class="btn btn-sm btn-primary" id="s-loc-merge-all" hidden>${icon('layers')} מיזוג הכל</button>
        <button type="button" class="btn btn-sm btn-primary" id="s-loc-merge-selected" hidden>${icon('layers')} מיזוג הנבחרים (<span id="s-loc-sel-count">0</span>)</button>
      </div>
      <div class="dupe-list" id="s-location-dupes"></div>
      <div class="species-list" id="s-location-list"></div>
      <button class="btn btn-sm" id="s-loc-seed" style="margin-top:10px">${icon('refresh')} ייבוא מיקומים מהתצפיות הקיימות</button>
    </div>

    <div class="settings-card">
      <h3>${icon('list')} ניהול רשימת הפרויקטים</h3>
      <p style="font-size:.9rem;color:var(--ink-soft);margin-top:0">
        הרשימה המוצעת בשדה "פרויקט" בטופס התצפית. שינוי שם פרויקט (עריכה) מעדכן
        אותו בכל התצפיות שכבר משתמשות בו; מחיקה מסירה אותו מהרשימה בלבד —
        תצפיות קיימות אינן נפגעות.
      </p>
      <div class="add-species-row">
        <input type="text" id="s-proj-new" placeholder="הוספת פרויקט חדש לרשימה...">
        <button class="btn" id="s-proj-add">${icon('plus')} הוספה</button>
      </div>
      <div class="dupe-toolbar">
        <button type="button" class="btn btn-sm" id="s-proj-find-dupes">${icon('search')} איתור כפילויות</button>
        <button type="button" class="btn btn-sm btn-primary" id="s-proj-merge-all" hidden>${icon('layers')} מיזוג הכל</button>
      </div>
      <div class="dupe-list" id="s-project-dupes"></div>
      <div class="species-list" id="s-project-list"></div>
      <button class="btn btn-sm" id="s-proj-seed" style="margin-top:10px">${icon('refresh')} ייבוא פרויקטים מהתצפיות הקיימות</button>
    </div>
  `;
}

function wireLists(): void {
  qs(container, '#s-sp-add').addEventListener('click', () => void onAddSpeciesManaged());
  input(container, '#s-sp-new').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); void onAddSpeciesManaged(); } });
  qs(container, '#s-species-list').addEventListener('click', (e) => void onSpeciesListClick(e));
  qs(container, '#s-species-list').addEventListener('change', (e) => onSpeciesListSelChange(e));
  void renderSpeciesManageList();

  speciesDupeGroups = [];
  renamingSpecies = null;
  selectedSpeciesNames = new Set();
  qs(container, '#s-sp-find-dupes').addEventListener('click', () => void onFindSpeciesDupes());
  qs(container, '#s-sp-merge-all').addEventListener('click', () => void onMergeAllSpeciesDupes());
  qs(container, '#s-sp-merge-selected').addEventListener('click', () => void onMergeSelectedSpecies());
  qs(container, '#s-species-dupes').addEventListener('click', (e) => void onSpeciesDupesClick(e));

  newLocationCoords = null;
  qs(container, '#s-loc-add').addEventListener('click', () => void onAddLocationManaged());
  qs(container, '#s-loc-pick').addEventListener('click', () => void onPickLocationForAdd());
  qs(container, '#s-loc-seed').addEventListener('click', () => void onSeedLocations());
  qs(container, '#s-location-list').addEventListener('click', (e) => void onLocationListClick(e));
  qs(container, '#s-location-list').addEventListener('change', (e) => onLocationListSelChange(e));
  void renderLocationManageList();

  locationDupeGroups = [];
  renamingLocation = null;
  selectedLocationNames = new Set();
  qs(container, '#s-loc-find-dupes').addEventListener('click', () => void onFindLocationDupes());
  qs(container, '#s-loc-merge-all').addEventListener('click', () => void onMergeAllLocationDupes());
  qs(container, '#s-loc-merge-selected').addEventListener('click', () => void onMergeSelectedLocations());
  qs(container, '#s-location-dupes').addEventListener('click', (e) => void onLocationDupesClick(e));

  qs(container, '#s-proj-add').addEventListener('click', () => void onAddProjectManaged());
  input(container, '#s-proj-new').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); void onAddProjectManaged(); } });
  qs(container, '#s-proj-seed').addEventListener('click', () => void onSeedProjects());
  qs(container, '#s-project-list').addEventListener('click', (e) => void onProjectListClick(e));
  void renderProjectManageList();

  projectDupeGroups = [];
  renamingProject = null;
  qs(container, '#s-proj-find-dupes').addEventListener('click', () => void onFindProjectDupes());
  qs(container, '#s-proj-merge-all').addEventListener('click', () => void onMergeAllProjectDupes());
  qs(container, '#s-project-dupes').addEventListener('click', (e) => void onProjectDupesClick(e));
}

/* ---------- נתונים מקומיים ---------- */

function dataHtml(obsCount: number, version: string): string {
  return `
    <div class="settings-card">
      <p style="font-size:.9rem;color:var(--ink-soft);margin-top:0">
        במכשיר זה שמורות כרגע ${obsCount} תצפיות. ${version ? `· גרסת אפליקציה: v${escapeHtml(version)}` : ''}
      </p>
      <button class="btn btn-danger" id="s-clear">${icon('trash')} מחיקת כל הנתונים</button>
    </div>
  `;
}

function wireData(): void {
  qs(container, '#s-clear').addEventListener('click', () => void onClearData());
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
    ? rows.map((r) => {
      const isRenaming = renamingSpecies === r.name;
      return `
      <div class="sp-row" data-name="${escapeHtml(r.name)}">
        <input type="checkbox" class="sel" data-name="${escapeHtml(r.name)}" title="בחירה למיזוג" ${selectedSpeciesNames.has(r.name) ? 'checked' : ''}>
        ${isRenaming
          ? `<input type="text" class="rename-input" value="${escapeHtml(r.name)}">`
          : `<span>${escapeHtml(r.name)}</span>`}
        ${isRenaming
          ? `<button type="button" class="rename-save" data-name="${escapeHtml(r.name)}" title="שמירת שם" aria-label="שמירת שם">${icon('check')}</button>
             <button type="button" class="rename-cancel" title="ביטול" aria-label="ביטול">✕</button>`
          : `<button type="button" class="rename" data-name="${escapeHtml(r.name)}" title="שינוי שם / מיזוג" aria-label="שינוי שם / מיזוג">${icon('edit')}</button>`}
        <button type="button" class="del" data-name="${escapeHtml(r.name)}" title="הסרה מהרשימה" aria-label="הסרה מהרשימה">${icon('trash')}</button>
      </div>`;
    }).join('')
    : '<p class="hint" style="padding:10px 12px">אין מינים ברשימה.</p>';
  if (renamingSpecies) el.querySelector<HTMLInputElement>('.rename-input')?.focus();
  updateSpeciesSelToolbar();
}

function updateSpeciesSelToolbar(): void {
  const btn = container.querySelector<HTMLButtonElement>('#s-sp-merge-selected');
  const countEl = container.querySelector<HTMLElement>('#s-sp-sel-count');
  if (!btn) return;
  btn.hidden = selectedSpeciesNames.size < 2;
  if (countEl) countEl.textContent = String(selectedSpeciesNames.size);
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
  const target = e.target as HTMLElement;
  if (target.closest('.rename')) {
    renamingSpecies = target.closest<HTMLElement>('.rename')!.dataset.name!;
    await renderSpeciesManageList();
    return;
  }
  if (target.closest('.rename-cancel')) {
    renamingSpecies = null;
    await renderSpeciesManageList();
    return;
  }
  if (target.closest('.rename-save')) {
    const oldName = target.closest<HTMLElement>('.rename-save')!.dataset.name!;
    const row = target.closest<HTMLElement>('.sp-row')!;
    const newName = row.querySelector<HTMLInputElement>('.rename-input')!.value.trim();
    renamingSpecies = null;
    if (!newName || newName === oldName) { await renderSpeciesManageList(); return; }
    const n = await mergeSpeciesNames([oldName], newName);
    await renderSpeciesManageList();
    toast(`"${oldName}" מוזג ל-"${newName}" (${n} תצפיות עודכנו)`);
    return;
  }
  const btn = target.closest<HTMLElement>('.del');
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

function onSpeciesListSelChange(e: Event): void {
  const target = e.target as HTMLInputElement;
  if (!target.classList.contains('sel')) return;
  const name = target.dataset.name!;
  if (target.checked) selectedSpeciesNames.add(name); else selectedSpeciesNames.delete(name);
  updateSpeciesSelToolbar();
}

/** Merges a group the user assembled by hand (checkboxes), not one the
 * automatic duplicate-finder detected — handed to the same group-picker UI
 * so choosing the canonical name and merging works identically either way. */
async function onMergeSelectedSpecies(): Promise<void> {
  if (selectedSpeciesNames.size < 2) return;
  speciesDupeGroups = [{ key: 'manual', names: [...selectedSpeciesNames] }, ...speciesDupeGroups];
  selectedSpeciesNames = new Set();
  renderSpeciesDupes();
  await renderSpeciesManageList();
  toast('בחרו את השם הנכון בקבוצה למטה ולחצו "מיזוג"');
}

/* ---------- locations list management ---------- */

async function renderLocationManageList(): Promise<void> {
  const rows = await listLocationRows();
  const el = container.querySelector<HTMLElement>('#s-location-list');
  if (!el) return;
  el.innerHTML = rows.length
    ? rows.map((r) => {
      const isRenaming = renamingLocation === r.name;
      const hasCoords = r.lat != null && r.lng != null;
      return `
      <div class="sp-row loc-row" data-name="${escapeHtml(r.name)}">
        <input type="checkbox" class="sel" data-name="${escapeHtml(r.name)}" title="בחירה למיזוג" ${selectedLocationNames.has(r.name) ? 'checked' : ''}>
        ${isRenaming
          ? `<input type="text" class="rename-input" value="${escapeHtml(r.name)}">`
          : `<span class="loc-row-name" title="${escapeHtml(r.name)}">${escapeHtml(r.name)}</span>`}
        <button type="button" class="btn btn-sm loc-pick-coords${hasCoords ? ' locked' : ''}" data-name="${escapeHtml(r.name)}" title="בחירת מיקום על המפה">
          ${icon('pin')} ${hasCoords ? 'מיקום נקבע' : 'לא נקבע'}
        </button>
        ${isRenaming
          ? `<button type="button" class="rename-save" data-name="${escapeHtml(r.name)}" title="שמירת שם" aria-label="שמירת שם">${icon('check')}</button>
             <button type="button" class="rename-cancel" title="ביטול" aria-label="ביטול">✕</button>`
          : `<button type="button" class="rename" data-name="${escapeHtml(r.name)}" title="שינוי שם" aria-label="שינוי שם">${icon('edit')}</button>`}
        <button type="button" class="del" data-name="${escapeHtml(r.name)}" title="מחיקה" aria-label="מחיקה">${icon('trash')}</button>
      </div>`;
    }).join('')
    : '<p class="hint" style="padding:10px 12px">אין מיקומים שמורים.</p>';
  if (renamingLocation) el.querySelector<HTMLInputElement>('.rename-input')?.focus();
  updateLocationSelToolbar();
}

function updateLocationSelToolbar(): void {
  const btn = container.querySelector<HTMLButtonElement>('#s-loc-merge-selected');
  const countEl = container.querySelector<HTMLElement>('#s-loc-sel-count');
  if (!btn) return;
  btn.hidden = selectedLocationNames.size < 2;
  if (countEl) countEl.textContent = String(selectedLocationNames.size);
}

async function onAddLocationManaged(): Promise<void> {
  const nameInp = input(container, '#s-loc-name');
  const name = nameInp.value.trim();
  if (!name) { toast('יש להזין שם מיקום', true); return; }
  await addLocation(name, newLocationCoords?.lat ?? null, newLocationCoords?.lng ?? null);
  nameInp.value = '';
  newLocationCoords = null;
  const label = container.querySelector<HTMLElement>('#s-loc-pick-label');
  if (label) label.textContent = 'בחירת מיקום על המפה';
  await renderLocationManageList();
  toast(`"${name}" נוסף לרשימת המיקומים`);
}

async function onPickLocationForAdd(): Promise<void> {
  const result = await pickLocation(newLocationCoords);
  if (result) {
    newLocationCoords = result;
    const label = container.querySelector<HTMLElement>('#s-loc-pick-label');
    if (label) label.textContent = 'מיקום נבחר על המפה';
  }
}

async function onSeedLocations(): Promise<void> {
  const n = await seedLocationsFromObservations();
  toast(n ? `נוספו ${n} מיקומים מהתצפיות הקיימות` : 'אין מיקומים חדשים לייבוא');
  if (n) await renderLocationManageList();
}

async function onLocationListClick(e: Event): Promise<void> {
  const target = e.target as HTMLElement;
  if (target.closest('.loc-pick-coords')) {
    const name = target.closest<HTMLElement>('.loc-pick-coords')!.dataset.name!;
    const rows = await listLocationRows();
    const row = rows.find((r) => r.name === name);
    const initial = row?.lat != null && row?.lng != null ? { lat: row.lat, lng: row.lng } : null;
    const result = await pickLocation(initial);
    if (result) {
      await updateLocationCoords(name, result.lat, result.lng);
      await renderLocationManageList();
      toast('הקואורדינטות עודכנו');
    }
    return;
  }
  if (target.closest('.rename')) {
    renamingLocation = target.closest<HTMLElement>('.rename')!.dataset.name!;
    await renderLocationManageList();
    return;
  }
  if (target.closest('.rename-cancel')) {
    renamingLocation = null;
    await renderLocationManageList();
    return;
  }
  if (target.closest('.rename-save')) {
    const oldName = target.closest<HTMLElement>('.rename-save')!.dataset.name!;
    const row = target.closest<HTMLElement>('.loc-row')!;
    const newName = row.querySelector<HTMLInputElement>('.rename-input')!.value.trim();
    renamingLocation = null;
    if (!newName || newName === oldName) { await renderLocationManageList(); return; }
    const n = await mergeLocationNames([oldName], newName);
    await renderLocationManageList();
    toast(`"${oldName}" שונה ל-"${newName}" (${n} תצפיות עודכנו)`);
    return;
  }
  const btn = target.closest<HTMLElement>('.del');
  if (!btn) return;
  const name = btn.dataset.name!;
  if (!(await confirmDialog(`למחוק את "${name}" מרשימת המיקומים? תצפיות קיימות ישמרו את השם והקואורדינטות שכבר נרשמו בהן.`, 'מחיקה'))) return;
  await deleteLocation(name);
  await renderLocationManageList();
  toast(`"${name}" נמחק מרשימת המיקומים`);
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

function onLocationListSelChange(e: Event): void {
  const target = e.target as HTMLInputElement;
  if (!target.classList.contains('sel')) return;
  const name = target.dataset.name!;
  if (target.checked) selectedLocationNames.add(name); else selectedLocationNames.delete(name);
  updateLocationSelToolbar();
}

/** Merges a group the user assembled by hand (checkboxes), not one the
 * automatic duplicate-finder detected — handed to the same group-picker UI
 * so choosing the canonical name and merging works identically either way. */
async function onMergeSelectedLocations(): Promise<void> {
  if (selectedLocationNames.size < 2) return;
  locationDupeGroups = [{ key: 'manual', names: [...selectedLocationNames] }, ...locationDupeGroups];
  selectedLocationNames = new Set();
  renderLocationDupes();
  await renderLocationManageList();
  toast('בחרו את השם הנכון בקבוצה למטה ולחצו "מיזוג"');
}

/* ---------- projects list management ---------- */

async function renderProjectManageList(): Promise<void> {
  const rows = await listProjectRows();
  const el = container.querySelector<HTMLElement>('#s-project-list');
  if (!el) return;
  el.innerHTML = rows.length
    ? rows.map((r) => {
      const isRenaming = renamingProject === r.name;
      return `
      <div class="sp-row proj-row" data-name="${escapeHtml(r.name)}">
        ${isRenaming
          ? `<input type="text" class="rename-input" value="${escapeHtml(r.name)}">`
          : `<span>${escapeHtml(r.name)}</span>`}
        ${isRenaming
          ? `<button type="button" class="rename-save" data-name="${escapeHtml(r.name)}" title="שמירת שם" aria-label="שמירת שם">${icon('check')}</button>
             <button type="button" class="rename-cancel" title="ביטול" aria-label="ביטול">✕</button>`
          : `<button type="button" class="rename" data-name="${escapeHtml(r.name)}" title="שינוי שם" aria-label="שינוי שם">${icon('edit')}</button>`}
        <button type="button" class="del" data-name="${escapeHtml(r.name)}" title="הסרה מהרשימה" aria-label="הסרה מהרשימה">${icon('trash')}</button>
      </div>`;
    }).join('')
    : '<p class="hint" style="padding:10px 12px">אין פרויקטים ברשימה.</p>';
  if (renamingProject) el.querySelector<HTMLInputElement>('.rename-input')?.focus();
}

async function onAddProjectManaged(): Promise<void> {
  const inp = input(container, '#s-proj-new');
  const name = inp.value.trim();
  if (!name) return;
  await addProject(name);
  inp.value = '';
  await renderProjectManageList();
  toast(`"${name}" נוסף לרשימת הפרויקטים`);
}

async function onSeedProjects(): Promise<void> {
  const n = await seedProjectsFromObservations();
  toast(n ? `נוספו ${n} פרויקטים מהתצפיות הקיימות` : 'אין פרויקטים חדשים לייבוא');
  if (n) await renderProjectManageList();
}

async function onProjectListClick(e: Event): Promise<void> {
  const target = e.target as HTMLElement;
  if (target.closest('.rename')) {
    renamingProject = target.closest<HTMLElement>('.rename')!.dataset.name!;
    await renderProjectManageList();
    return;
  }
  if (target.closest('.rename-cancel')) {
    renamingProject = null;
    await renderProjectManageList();
    return;
  }
  if (target.closest('.rename-save')) {
    const oldName = target.closest<HTMLElement>('.rename-save')!.dataset.name!;
    const row = target.closest<HTMLElement>('.proj-row')!;
    const newName = row.querySelector<HTMLInputElement>('.rename-input')!.value.trim();
    renamingProject = null;
    if (!newName || newName === oldName) { await renderProjectManageList(); return; }
    const n = await mergeProjectNames([oldName], newName);
    await renderProjectManageList();
    toast(`"${oldName}" שונה ל-"${newName}" (${n} תצפיות עודכנו)`);
    return;
  }
  const btn = target.closest<HTMLElement>('.del');
  if (!btn) return;
  const name = btn.dataset.name!;
  if (!(await confirmDialog(`להסיר את "${name}" מרשימת הפרויקטים? תצפיות קיימות לא ייפגעו.`, 'הסרה'))) return;
  await deleteProject(name);
  await renderProjectManageList();
  toast(`"${name}" הוסר מהרשימה`);
}

async function onFindProjectDupes(): Promise<void> {
  projectDupeGroups = await findDuplicateProjectGroups();
  renderProjectDupes();
  if (!projectDupeGroups.length) toast('לא נמצאו כפילויות ברשימת הפרויקטים');
}

function renderProjectDupes(): void {
  renderDupeGroups(container.querySelector<HTMLElement>('#s-project-dupes'), projectDupeGroups, 'proj');
  const mergeAllBtn = container.querySelector<HTMLButtonElement>('#s-proj-merge-all');
  if (mergeAllBtn) mergeAllBtn.hidden = projectDupeGroups.length < 2;
}

async function onProjectDupesClick(e: Event): Promise<void> {
  const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('.merge-btn');
  if (!btn) return;
  const idx = Number(btn.dataset.idx);
  const group = projectDupeGroups[idx];
  if (!group) return;
  const canonical = pickedCanonical('#s-project-dupes', idx, group);
  if (!(await confirmDialog(
    `למזג ${group.names.length} וריאציות של אותו פרויקט ל-"${canonical}"? כל התצפיות הרלוונטיות יעודכנו.`,
    'מיזוג',
  ))) return;
  const n = await mergeProjectNames(group.names, canonical);
  toast(`מוזגו ${group.names.length} שמות ל-"${canonical}" (${n} תצפיות עודכנו)`);
  projectDupeGroups.splice(idx, 1);
  renderProjectDupes();
  await renderProjectManageList();
}

async function onMergeAllProjectDupes(): Promise<void> {
  if (!projectDupeGroups.length) return;
  if (!(await confirmDialog(
    `למזג את כל ${projectDupeGroups.length} קבוצות הכפילויות, כל אחת לפי השם שנבחר לה? התצפיות יעודכנו.`,
    'מיזוג הכל',
  ))) return;
  let totalObs = 0;
  const groups = projectDupeGroups.map((g, i) => ({ group: g, canonical: pickedCanonical('#s-project-dupes', i, g) }));
  for (const { group, canonical } of groups) totalObs += await mergeProjectNames(group.names, canonical);
  toast(`מוזגו ${groups.length} קבוצות כפילויות (${totalObs} תצפיות עודכנו)`);
  projectDupeGroups = [];
  renderProjectDupes();
  await renderProjectManageList();
}

function pickSwatch(groupSelector: string, e: Event, apply: (btn: HTMLElement) => void): void {
  const btn = (e.target as HTMLElement).closest<HTMLElement>('.theme-swatch');
  if (!btn) return;
  apply(btn);
  qs(container, groupSelector).querySelectorAll('.theme-swatch').forEach((el) => {
    el.classList.toggle('active', el === btn);
  });
}

function pickSeg(groupSelector: string, e: Event, apply: (btn: HTMLElement) => void): void {
  const btn = (e.target as HTMLElement).closest<HTMLElement>('.seg-btn');
  if (!btn) return;
  apply(btn);
  qs(container, groupSelector).querySelectorAll('.seg-btn').forEach((el) => {
    el.classList.toggle('active', el === btn);
  });
}

function onThemePick(e: Event): void {
  pickSwatch('#s-theme-picker', e, (btn) => setTheme(btn.dataset.theme as ThemeId));
}
function onAccentPick(e: Event): void {
  pickSwatch('#s-accent-picker', e, (btn) => setAccent(btn.dataset.accent as AccentId));
}
function onFontColorPick(e: Event): void {
  pickSwatch('#s-font-color-picker', e, (btn) => setFontColor(btn.dataset.fontColor as FontColorId));
}
function onFontSizePick(e: Event): void {
  pickSeg('#s-font-size-picker', e, (btn) => setFontSize(btn.dataset.fontSize as FontSizeId));
}
function onFontWeightPick(e: Event): void {
  pickSeg('#s-font-weight-picker', e, (btn) => setFontWeight(btn.dataset.fontWeight as FontWeightId));
}

async function onSaveFirebaseSync(): Promise<void> {
  const code = input(container, '#s-fb-code').value.trim();
  const btn = qs<HTMLButtonElement>(container, '#s-fb-save');
  btn.disabled = true;
  try {
    await configureFirebaseSync(code);
    toast(code ? 'קוד המשפחה נשמר — מסתנכרן עם Firebase...' : 'סנכרון Firebase כובה');
  } catch (err) {
    toast('שגיאה בהתחברות ל-Firebase: ' + (err as Error).message, true, 6000);
  } finally {
    btn.disabled = false;
  }
}

async function onForceResync(): Promise<void> {
  if (!(await confirmDialog(
    'לדרוס את רשימות המינים/מיקומים/פרויקטים במכשיר הזה בערכים מהענן? שינויים מקומיים שטרם עלו לענן עלולים ללכת לאיבוד.',
    'סנכרון מחדש',
  ))) return;
  const btn = qs<HTMLButtonElement>(container, '#s-fb-resync');
  btn.disabled = true;
  try {
    const n = await forceResyncListsFromCloud();
    toast(`הרשימות סונכרנו מחדש (${n.species} מינים, ${n.locations} מיקומים, ${n.projects} פרויקטים)`);
  } catch (err) {
    toast('סנכרון מחדש נכשל: ' + (err as Error).message, true, 6000);
  } finally {
    btn.disabled = false;
  }
}

/* ---------- notifications ---------- */

async function onNotifEnabledChange(e: Event): Promise<void> {
  const checkbox = e.target as HTMLInputElement;
  const subSection = container.querySelector<HTMLElement>('#s-notif-sub');
  if (!checkbox.checked) {
    await setEnabled(false);
    if (subSection) subSection.hidden = true;
    return;
  }
  const result = await requestPermission();
  if (result !== 'granted') {
    checkbox.checked = false;
    await setEnabled(false);
    if (result === 'denied') {
      toast('הדפדפן חסם התראות עבור האתר — יש לאשר בהגדרות הדפדפן/המכשיר', true, 6000);
    }
    return;
  }
  await setEnabled(true);
  if (subSection) subSection.hidden = false;
  toast('התראות מקומיות הופעלו');
  void checkAndNotify(await listObservations());
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
  const projects = await listProjectRows();
  const media: Array<{ id: string; obsId: string; name: string; mime: string; data: string }> = [];
  for (const o of observations) {
    for (const m of await mediaForObservation(o.id)) {
      media.push({ id: m.id, obsId: m.obsId, name: m.name, mime: m.mime, data: await blobToDataUrl(m.blob) });
    }
  }
  const backup = { app: 'birds-journal', format: 2, exportedAt: new Date().toISOString(), species, locations, projects, observations, media };
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
  let backup: { app?: string; observations?: Observation[]; species?: string[]; locations?: LocationRow[]; projects?: ProjectRow[]; media?: Array<{ id: string; obsId: string; name: string; mime: string; data: string }> };
  try {
    backup = JSON.parse(await file.text());
    if (backup.app !== 'birds-journal' || !Array.isArray(backup.observations)) throw new Error();
  } catch { toast('קובץ גיבוי לא תקין', true); return; }
  if (!(await confirmDialog(`לשחזר ${backup.observations!.length} תצפיות מהגיבוי?`, 'שחזור'))) return;
  for (const name of backup.species || []) await addSpecies(name);
  for (const l of backup.locations || []) await addLocation(l.name, l.lat, l.lng);
  for (const p of backup.projects || []) await addProject(p.name);
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

/* ---------- clear ---------- */

async function onClearData(): Promise<void> {
  if (!(await confirmDialog('למחוק את כל התצפיות והתמונות במכשיר זה? מומלץ להוריד גיבוי קודם.', 'מחיקת הכל'))) return;
  await clearAllData();
  toast('כל הנתונים נמחקו');
  await activate();
}
