/* lib/theme.ts — appearance settings: background theme, accent color, font
 * color, font size, and font weight. All device-local (like the rest of
 * Settings' local-only preferences), persisted in localStorage so each can be
 * applied synchronously before first paint (see the inline snippet in
 * index.html) instead of waiting on an async IndexedDB read. Each dimension
 * is independent — e.g. any accent color can be combined with any background
 * theme — applied as separate data-attributes on <html> that app.css keys
 * its overrides off of. */

export const THEMES = [
  { id: 'classic', label: 'ירוק קלאסי', swatch: '#2d6a4f' },
  { id: 'forest', label: 'ירוק מאופק', swatch: '#3d5c46' },
  { id: 'slate', label: 'כחול-אפור ארגוני', swatch: '#3a5a7d' },
  { id: 'dark', label: 'כהה', swatch: '#3f8a7d' },
  { id: 'oled', label: 'כהה עמוק (OLED)', swatch: '#0a0a0a' },
  { id: 'nature', label: 'גווני טבע', swatch: '#8a5a34' },
] as const;
export type ThemeId = (typeof THEMES)[number]['id'];

export const ACCENTS = [
  { id: 'default', label: 'ברירת מחדל', swatch: null },
  { id: 'blue', label: 'כחול', swatch: '#2f6fed' },
  { id: 'purple', label: 'סגול', swatch: '#7c4dcc' },
  { id: 'orange', label: 'כתום', swatch: '#e07a2e' },
  { id: 'red', label: 'אדום', swatch: '#c1443c' },
  { id: 'teal', label: 'טורקיז', swatch: '#1f9a8f' },
] as const;
export type AccentId = (typeof ACCENTS)[number]['id'];

/** Ready-made color sets: background, cards, text and an accent color chosen
 * together, so they always match (picking theme / accent / text color one by
 * one can produce clashing mixes, like a blue-grey theme under an orange bar).
 * Each set sits on a base theme for everything not color-related (dark sets
 * on "dark") and its colors live in app.css under [data-palette]. The four
 * swatch colors here only draw its preview card in Settings. */
export const PALETTES = [
  { id: 'desert', label: 'מדבר', base: 'classic', bg: '#f4ebdd', card: '#fffaf2', text: '#3b2a1d', accent: '#b9582f' },
  { id: 'sea', label: 'ים תיכון', base: 'classic', bg: '#e8f1f5', card: '#ffffff', text: '#10293b', accent: '#1d6fa3' },
  { id: 'olive', label: 'זית ושמנת', base: 'classic', bg: '#f1efe3', card: '#fdfcf5', text: '#2b2d1c', accent: '#62752a' },
  { id: 'sunset', label: 'שקיעה', base: 'classic', bg: '#f7ebe6', card: '#fffaf7', text: '#3a1e28', accent: '#b0435a' },
  { id: 'lavender', label: 'לבנדר וצפחה', base: 'classic', bg: '#eeedf5', card: '#fcfcff', text: '#24213a', accent: '#6152c0' },
  { id: 'shore', label: 'חוף', base: 'classic', bg: '#f5efe4', card: '#fffdf8', text: '#1f3434', accent: '#1b7e78' },
  { id: 'night', label: 'לילה בשטח', base: 'dark', bg: '#12161b', card: '#1d232a', text: '#e9edf1', accent: '#b06d25' },
  { id: 'ember', label: 'פחם וגחלים', base: 'dark', bg: '#141010', card: '#211a19', text: '#f3ece9', accent: '#c4502d' },
] as const;
export type PaletteId = (typeof PALETTES)[number]['id'];

/** Curated primary+secondary text-color pairs, chosen to keep contrast
 * against any of the background themes above — rather than a free-form
 * color wheel, which could easily produce illegible text. */
export const FONT_COLORS = [
  { id: 'default', label: 'ברירת מחדל', swatch: null },
  { id: 'navy', label: 'כחול כהה', swatch: '#1b2a4a' },
  { id: 'charcoal', label: 'אפור פחם', swatch: '#26282b' },
  { id: 'forest-text', label: 'ירוק כהה', swatch: '#1c3324' },
  { id: 'plum', label: 'סגול כהה', swatch: '#3a1f3d' },
  { id: 'high-contrast', label: 'ניגודיות מרבית', swatch: '#000000' },
] as const;
export type FontColorId = (typeof FONT_COLORS)[number]['id'];

export const FONT_SIZES = [
  { id: 'sm', label: 'קטן' },
  { id: 'md', label: 'רגיל' },
  { id: 'lg', label: 'גדול' },
] as const;
export type FontSizeId = (typeof FONT_SIZES)[number]['id'];

export const FONT_WEIGHTS = [
  { id: 'regular', label: 'רגיל' },
  { id: 'bold', label: 'מודגש' },
] as const;
export type FontWeightId = (typeof FONT_WEIGHTS)[number]['id'];

/** Layout width/density. 'auto' just lets the existing fluid CSS respond to
 * the viewport (phone vs. desktop browser window); 'mobile'/'desktop' force
 * one layout regardless of actual screen size, for someone who prefers a
 * narrow single-column feel on a wide monitor or vice versa. */
export const DISPLAY_MODES = [
  { id: 'auto', label: 'אוטומטי (לפי המכשיר)' },
  { id: 'mobile', label: 'נייד' },
  { id: 'desktop', label: 'מחשב' },
] as const;
export type DisplayModeId = (typeof DISPLAY_MODES)[number]['id'];

const KEYS = {
  theme: 'birds-theme',
  accent: 'birds-accent',
  fontColor: 'birds-font-color',
  fontSize: 'birds-font-size',
  fontWeight: 'birds-font-weight',
  displayMode: 'birds-display-mode',
  bgPhoto: 'birds-bg-photo',
  cardTransparency: 'birds-card-transparency',
  palette: 'birds-palette',
} as const;

export const MAX_CARD_TRANSPARENCY = 90;

/** How much of the background photo shows through the light wash over it, 0–100 %. */
export const DEFAULT_BG_PHOTO = 25;

function readId<T extends string>(key: string, valid: readonly { id: T }[], fallback: T): T {
  const saved = localStorage.getItem(key);
  return (valid.some((v) => v.id === saved) ? saved : fallback) as T;
}

export function currentTheme(): ThemeId {
  return readId(KEYS.theme, THEMES, 'classic');
}
export function currentAccent(): AccentId {
  return readId(KEYS.accent, ACCENTS, 'default');
}
export function currentFontColor(): FontColorId {
  return readId(KEYS.fontColor, FONT_COLORS, 'default');
}
export function currentFontSize(): FontSizeId {
  return readId(KEYS.fontSize, FONT_SIZES, 'md');
}
export function currentFontWeight(): FontWeightId {
  return readId(KEYS.fontWeight, FONT_WEIGHTS, 'regular');
}
export function currentDisplayMode(): DisplayModeId {
  return readId(KEYS.displayMode, DISPLAY_MODES, 'auto');
}
/** '' = no set: the theme / accent / text color picked one by one. */
export function currentPalette(): PaletteId | '' {
  return readId(KEYS.palette, PALETTES, '' as PaletteId) || '';
}
export function currentBgPhoto(): number {
  const n = parseInt(localStorage.getItem(KEYS.bgPhoto) ?? '', 10);
  return Number.isFinite(n) ? Math.min(100, Math.max(0, n)) : DEFAULT_BG_PHOTO;
}
export function currentCardTransparency(): number {
  const n = parseInt(localStorage.getItem(KEYS.cardTransparency) ?? '', 10);
  return Number.isFinite(n) ? Math.min(MAX_CARD_TRANSPARENCY, Math.max(0, n)) : 0;
}

function applyAll(): void {
  const root = document.documentElement;
  root.setAttribute('data-theme', currentTheme());
  root.setAttribute('data-accent', currentAccent());
  root.setAttribute('data-font-color', currentFontColor());
  root.setAttribute('data-font-size', currentFontSize());
  root.setAttribute('data-font-weight', currentFontWeight());
  root.setAttribute('data-display-mode', currentDisplayMode());
  const palette = currentPalette();
  if (palette) root.setAttribute('data-palette', palette);
  else root.removeAttribute('data-palette');
  root.style.setProperty('--bg-wash', String(1 - currentBgPhoto() / 100));
  root.style.setProperty('--card-opacity', String(1 - currentCardTransparency() / 100));
  // The phone's own status bar follows the chosen color too (index.html's
  // static theme-color is the default green).
  const barColor = getComputedStyle(root).getPropertyValue('--accent-700').trim();
  const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (meta && barColor) meta.content = barColor;
}

/* Picking a theme, accent or text color by hand leaves the ready-made set. */
export function setTheme(v: ThemeId): void { localStorage.removeItem(KEYS.palette); localStorage.setItem(KEYS.theme, v); applyAll(); }
export function setAccent(v: AccentId): void { localStorage.removeItem(KEYS.palette); localStorage.setItem(KEYS.accent, v); applyAll(); }
export function setFontColor(v: FontColorId): void { localStorage.removeItem(KEYS.palette); localStorage.setItem(KEYS.fontColor, v); applyAll(); }
/** A set brings its own colors: its base theme, with the accent and text
 * color reset so nothing picked earlier mixes into it. */
export function setPalette(v: PaletteId): void {
  const p = PALETTES.find((x) => x.id === v)!;
  localStorage.setItem(KEYS.palette, v);
  localStorage.setItem(KEYS.theme, p.base);
  localStorage.setItem(KEYS.accent, 'default');
  localStorage.setItem(KEYS.fontColor, 'default');
  applyAll();
}
export function setFontSize(v: FontSizeId): void { localStorage.setItem(KEYS.fontSize, v); applyAll(); }
export function setFontWeight(v: FontWeightId): void { localStorage.setItem(KEYS.fontWeight, v); applyAll(); }
export function setDisplayMode(v: DisplayModeId): void { localStorage.setItem(KEYS.displayMode, v); applyAll(); }
export function setBgPhoto(v: number): void { localStorage.setItem(KEYS.bgPhoto, String(v)); applyAll(); }
export function setCardTransparency(v: number): void { localStorage.setItem(KEYS.cardTransparency, String(v)); applyAll(); }

/** Call once at startup — idempotent with the inline head snippet in index.html. */
export function initTheme(): void {
  applyAll();
}
