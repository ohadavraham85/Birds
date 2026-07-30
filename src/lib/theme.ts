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

const KEYS = {
  theme: 'assets-theme',
  accent: 'assets-accent',
  fontColor: 'assets-font-color',
  fontSize: 'assets-font-size',
  fontWeight: 'assets-font-weight',
} as const;

function readId<T extends string>(key: string, valid: readonly { id: T }[], fallback: T): T {
  const saved = localStorage.getItem(key);
  return (valid.some((v) => v.id === saved) ? saved : fallback) as T;
}

export function currentTheme(): ThemeId {
  return readId(KEYS.theme, THEMES, 'slate');
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

function applyAll(): void {
  const root = document.documentElement;
  root.setAttribute('data-theme', currentTheme());
  root.setAttribute('data-accent', currentAccent());
  root.setAttribute('data-font-color', currentFontColor());
  root.setAttribute('data-font-size', currentFontSize());
  root.setAttribute('data-font-weight', currentFontWeight());
}

export function setTheme(v: ThemeId): void { localStorage.setItem(KEYS.theme, v); applyAll(); }
export function setAccent(v: AccentId): void { localStorage.setItem(KEYS.accent, v); applyAll(); }
export function setFontColor(v: FontColorId): void { localStorage.setItem(KEYS.fontColor, v); applyAll(); }
export function setFontSize(v: FontSizeId): void { localStorage.setItem(KEYS.fontSize, v); applyAll(); }
export function setFontWeight(v: FontWeightId): void { localStorage.setItem(KEYS.fontWeight, v); applyAll(); }

/** Call once at startup — idempotent with the inline head snippet in index.html. */
export function initTheme(): void {
  applyAll();
}
