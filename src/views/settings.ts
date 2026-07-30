/* views/settings.ts — הגדרות: עיצוב / גיבוי ושחזור / נתונים מקומיים. */

import {
  listAssetsRaw, putAssetRaw, listMaintenanceRaw, putMaintenanceRaw,
  saveMedia, mediaForAsset, listAssets, clearAllData,
} from '../db/repository';
import { toast, confirmDialog } from '../lib/ui';
import { escapeHtml } from '../lib/markdown';
import { qs } from '../lib/dom';
import { icon, type IconName } from '../lib/icons';
import {
  THEMES, ACCENTS, FONT_COLORS, FONT_SIZES, FONT_WEIGHTS,
  currentTheme, currentAccent, currentFontColor, currentFontSize, currentFontWeight,
  setTheme, setAccent, setFontColor, setFontSize, setFontWeight,
  type ThemeId, type AccentId, type FontColorId, type FontSizeId, type FontWeightId,
} from '../lib/theme';
import type { Asset, MaintenanceLog } from '../types';

let container: HTMLElement;

type SettingsCategory = 'appearance' | 'backup' | 'data';
let activeCategory: SettingsCategory | null = null;

const CATEGORY_META: Record<SettingsCategory, { icon: IconName; title: string; subtitle: string }> = {
  appearance: { icon: 'palette', title: 'עיצוב', subtitle: 'ערכת נושא, צבעים, גודל ומשקל טקסט' },
  backup: { icon: 'save', title: 'גיבוי ושחזור', subtitle: 'קובץ גיבוי מקומי הכולל תמונות' },
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

export async function activate(): Promise<void> {
  const assetCount = (await listAssets()).length;
  let version = '';
  try { version = (await (await fetch('version.json')).json()).version; } catch { /* dev */ }

  const activeTheme = currentTheme();
  const activeAccent = currentAccent();
  const activeFontColor = currentFontColor();
  const activeFontSize = currentFontSize();
  const activeFontWeight = currentFontWeight();

  if (!activeCategory) { renderCategoryMenu(); return; }

  const meta = CATEGORY_META[activeCategory];
  container.innerHTML = `
    <div class="settings-subhead">
      <button type="button" class="btn btn-sm" id="settings-back">→ הגדרות</button>
      <h2>${icon(meta.icon)} ${meta.title}</h2>
    </div>
    ${activeCategory === 'appearance' ? appearanceHtml(activeTheme, activeAccent, activeFontColor, activeFontSize, activeFontWeight) : ''}
    ${activeCategory === 'backup' ? backupHtml() : ''}
    ${activeCategory === 'data' ? dataHtml(assetCount, version) : ''}
  `;

  qs(container, '#settings-back').addEventListener('click', () => { activeCategory = null; void activate(); });

  if (activeCategory === 'appearance') wireAppearance();
  if (activeCategory === 'backup') wireBackup();
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
    </div>
  `;
}

function wireAppearance(): void {
  qs(container, '#s-theme-picker').addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLElement>('[data-theme]');
    if (!btn) return;
    setTheme(btn.dataset.theme as ThemeId);
    void activate();
  });
  qs(container, '#s-accent-picker').addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLElement>('[data-accent]');
    if (!btn) return;
    setAccent(btn.dataset.accent as AccentId);
    void activate();
  });
  qs(container, '#s-font-color-picker').addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLElement>('[data-font-color]');
    if (!btn) return;
    setFontColor(btn.dataset.fontColor as FontColorId);
    void activate();
  });
  qs(container, '#s-font-size-picker').addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLElement>('[data-font-size]');
    if (!btn) return;
    setFontSize(btn.dataset.fontSize as FontSizeId);
    void activate();
  });
  qs(container, '#s-font-weight-picker').addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLElement>('[data-font-weight]');
    if (!btn) return;
    setFontWeight(btn.dataset.fontWeight as FontWeightId);
    void activate();
  });
}

/* ---------- גיבוי ושחזור ---------- */

function backupHtml(): string {
  return `
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

function wireBackup(): void {
  qs(container, '#s-backup').addEventListener('click', () => void onBackup());
  qs<HTMLInputElement>(container, '#s-restore').addEventListener('change', (e) => void onRestore(e));
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result as string); r.onerror = rej; r.readAsDataURL(blob); });
}
async function dataUrlToBlob(dataUrl: string): Promise<Blob> {
  return (await fetch(dataUrl)).blob();
}

async function onBackup(): Promise<void> {
  toast('מכין קובץ גיבוי...', false, 8000);
  const assets = await listAssetsRaw();
  const maintenance = await listMaintenanceRaw();
  const media: Array<{ id: string; assetId: string; name: string; mime: string; data: string }> = [];
  for (const a of assets) {
    for (const m of await mediaForAsset(a.id)) {
      media.push({ id: m.id, assetId: m.assetId, name: m.name, mime: m.mime, data: await blobToDataUrl(m.blob) });
    }
  }
  const backup = { app: 'electric-assets', format: 1, exportedAt: new Date().toISOString(), assets, maintenance, media };
  const blob = new Blob([JSON.stringify(backup)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `גיבוי-נכסי-חשמל-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
  toast(`קובץ הגיבוי הורד ✓ (${assets.length} נכסים, ${media.length} תמונות)`);
}

async function onRestore(e: Event): Promise<void> {
  const fileInput = e.target as HTMLInputElement;
  const file = fileInput.files?.[0];
  fileInput.value = '';
  if (!file) return;
  let backup: {
    app?: string; assets?: Asset[]; maintenance?: MaintenanceLog[];
    media?: Array<{ id: string; assetId: string; name: string; mime: string; data: string }>;
  };
  try {
    backup = JSON.parse(await file.text());
    if (backup.app !== 'electric-assets' || !Array.isArray(backup.assets)) throw new Error();
  } catch { toast('קובץ גיבוי לא תקין', true); return; }
  if (!(await confirmDialog(`לשחזר ${backup.assets!.length} נכסים מהגיבוי?`, 'שחזור'))) return;
  for (const a of backup.assets!) await putAssetRaw(a);
  for (const m of backup.maintenance || []) await putMaintenanceRaw(m);
  for (const m of backup.media || []) {
    await saveMedia({ id: m.id, assetId: m.assetId, name: m.name, mime: m.mime, blob: await dataUrlToBlob(m.data) });
  }
  toast('השחזור הושלם ✓');
  await activate();
}

/* ---------- נתונים מקומיים ---------- */

function dataHtml(assetCount: number, version: string): string {
  return `
    <div class="settings-card">
      <p style="font-size:.9rem;color:var(--ink-soft);margin-top:0">
        במכשיר זה שמורים כרגע ${assetCount} נכסים. ${version ? `· גרסת אפליקציה: v${escapeHtml(version)}` : ''}
      </p>
      <button class="btn btn-danger" id="s-clear">${icon('trash')} מחיקת כל הנתונים</button>
    </div>
  `;
}

function wireData(): void {
  qs(container, '#s-clear').addEventListener('click', () => void onClearData());
}

async function onClearData(): Promise<void> {
  if (!(await confirmDialog('למחוק את כל הנתונים המקומיים (כל הנכסים, התחזוקות והתמונות)? הפעולה אינה הפיכה.', 'מחיקת הכל'))) return;
  await clearAllData();
  toast('כל הנתונים נמחקו');
  await activate();
}
