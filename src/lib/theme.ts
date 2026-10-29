/* lib/theme.ts — appearance settings: the color set, font size and weight,
 * layout, background-photo wash and card transparency. All device-local,
 * persisted in localStorage so each can be applied synchronously before
 * first paint (see the inline snippet in index.html) instead of waiting on an
 * async IndexedDB read.
 *
 * Colors come only from ready-made sets (PALETTES): each is a background, a
 * card color, a text color and two accent colors that blend into a gradient
 * on the top bar, the main buttons and the selected tab. Every other shade
 * the CSS uses (--accent-50…900, --ink-soft, --line, shadows…) is derived
 * from those here, set as custom properties on <html>, and cached as one
 * style string for the before-first-paint snippet. Picking background /
 * accent / text color separately is gone — mixing them produced clashes. */

export interface Palette {
  id: string;
  label: string;
  dark: boolean;
  bg: string;
  card: string;
  text: string;
  /** Main accent — buttons, links, the right end of gradients (white text on it). */
  accent: string;
  /** Second accent — the far end of the gradients. */
  accent2: string;
}

export const PALETTES: readonly Palette[] = [
  { id: 'sunset', label: 'שקיעה טרופית', dark: false, bg: '#fff6ef', card: '#fffdfb', text: '#2b1d2e', accent: '#d9434f', accent2: '#f08a4b' },
  { id: 'ocean', label: 'אוקיינוס', dark: false, bg: '#eef7fb', card: '#ffffff', text: '#0d2b3e', accent: '#0a6fb5', accent2: '#00a6c7' },
  { id: 'rainforest', label: 'יער גשם', dark: false, bg: '#eefaf2', card: '#ffffff', text: '#12301f', accent: '#13894f', accent2: '#5aa832' },
  { id: 'grape', label: 'ענבים', dark: false, bg: '#f6f1fc', card: '#ffffff', text: '#261a3d', accent: '#6c2bd9', accent2: '#b05ce8' },
  { id: 'raspberry', label: 'פטל', dark: false, bg: '#fdf0f5', card: '#ffffff', text: '#3a1028', accent: '#c8215f', accent2: '#f0568c' },
  { id: 'desert', label: 'זריחה במדבר', dark: false, bg: '#fbf3e4', card: '#fffcf6', text: '#3b2614', accent: '#c4581b', accent2: '#e3922a' },
  { id: 'lagoon', label: 'לגונה', dark: false, bg: '#ecfaf7', card: '#ffffff', text: '#0f2f2c', accent: '#00897b', accent2: '#1fb39a' },
  { id: 'electric', label: 'כחול חשמלי', dark: false, bg: '#f0f3ff', card: '#ffffff', text: '#141b3d', accent: '#3450f0', accent2: '#7a4dff' },
  { id: 'lava', label: 'לבה', dark: false, bg: '#fff3ef', card: '#ffffff', text: '#2e1410', accent: '#d62839', accent2: '#f26419' },
  { id: 'meadow', label: 'אחו פורח', dark: false, bg: '#f6f8ec', card: '#ffffff', text: '#22301b', accent: '#3d8b37', accent2: '#c9a227' },
  { id: 'neon', label: 'לילה זוהר', dark: true, bg: '#0f1020', card: '#1a1b33', text: '#eceeff', accent: '#7c5cff', accent2: '#00b8e6' },
  { id: 'embers', label: 'גחלים', dark: true, bg: '#140f0e', card: '#221a18', text: '#f6ece8', accent: '#d4481a', accent2: '#f5a000' },
  { id: 'aurora', label: 'זוהר צפוני', dark: true, bg: '#0b1a1f', card: '#13262d', text: '#e6fbf7', accent: '#7b54c9', accent2: '#00a88c' },
  { id: 'midnight', label: 'חצות כחולה', dark: true, bg: '#0d1726', card: '#16233a', text: '#e8f0ff', accent: '#2f74e0', accent2: '#38b6e8' },
  { id: 'nightrose', label: 'ורד לילה', dark: true, bg: '#160d18', card: '#24162a', text: '#fbeefc', accent: '#e0359a', accent2: '#8a52c4' },
];
export const DEFAULT_PALETTE = 'ocean';

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
  /** 'classic' | 'dark' — the base for dark-specific CSS; read by index.html. */
  theme: 'birds-theme',
  fontSize: 'birds-font-size',
  fontWeight: 'birds-font-weight',
  displayMode: 'birds-display-mode',
  bgPhoto: 'birds-bg-photo',
  cardTransparency: 'birds-card-transparency',
  palette: 'birds-palette',
  /** The set's computed custom properties, applied by index.html before first paint. */
  paletteCss: 'birds-palette-css',
} as const;
/** Settings of the old separate pickers, cleared on load. */
const OLD_KEYS = ['birds-accent', 'birds-font-color'];

export const MAX_CARD_TRANSPARENCY = 90;

/** How much of the background photo shows through the light wash over it, 0–100 %. */
export const DEFAULT_BG_PHOTO = 25;

function readId<T extends string>(key: string, valid: readonly { id: T }[], fallback: T): T {
  const saved = localStorage.getItem(key);
  return (valid.some((v) => v.id === saved) ? saved : fallback) as T;
}

export function currentPalette(): Palette {
  const id = localStorage.getItem(KEYS.palette);
  return PALETTES.find((p) => p.id === id) ?? PALETTES.find((p) => p.id === DEFAULT_PALETTE)!;
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
export function currentBgPhoto(): number {
  const n = parseInt(localStorage.getItem(KEYS.bgPhoto) ?? '', 10);
  return Number.isFinite(n) ? Math.min(100, Math.max(0, n)) : DEFAULT_BG_PHOTO;
}
export function currentCardTransparency(): number {
  const n = parseInt(localStorage.getItem(KEYS.cardTransparency) ?? '', 10);
  return Number.isFinite(n) ? Math.min(MAX_CARD_TRANSPARENCY, Math.max(0, n)) : 0;
}

/* ---------- deriving every shade from a set's five colors ---------- */

function rgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
}
function hex([r, g, b]: number[]): string {
  return '#' + [r, g, b].map((c) => Math.round(Math.min(255, Math.max(0, c!))).toString(16).padStart(2, '0')).join('');
}
/** `a` mixed with `b`, `t` = share of `b` (0…1). */
function mix(a: string, b: string, t: number): string {
  const x = rgb(a), y = rgb(b);
  return hex(x.map((c, i) => c + (y[i]! - c) * t));
}
function rgba(color: string, alpha: number): string {
  return `rgba(${rgb(color).join(', ')}, ${alpha})`;
}

export function paletteVars(p: Palette): Record<string, string> {
  const white = '#ffffff';
  const black = '#000000';
  const v: Record<string, string> = {
    '--paper': p.bg,
    '--card': p.card,
    '--ink': p.text,
    '--ink-soft': mix(p.text, p.bg, 0.42),
    '--line': mix(p.text, p.bg, p.dark ? 0.82 : 0.86),
    '--accent-700': p.accent,
    '--accent-600': mix(p.accent, white, 0.18),
    '--accent-2': p.accent2,
    '--accent-mid': mix(p.accent, p.accent2, 0.5),
    '--primary-shadow': rgba(p.accent, p.dark ? 0.45 : 0.38),
    '--topbar-end': p.accent2,
    '--empty-overlay': rgba(p.bg, 0.85),
  };
  if (p.dark) {
    // --accent-900 doubles as emphasized text, so on dark it's a light tint.
    Object.assign(v, {
      '--accent-900': mix(p.accent, white, 0.55),
      '--accent-100': mix(p.accent, p.bg, 0.72),
      '--accent-50': mix(p.accent, p.bg, 0.84),
      '--toast-bg': mix(p.accent, black, 0.6),
      '--danger': '#e0685e', '--amber': '#dba13e', '--danger-soft': '#3a201d',
      '--shadow': '0 1px 2px rgba(0, 0, 0, .3)', '--shadow-lg': '0 6px 18px rgba(0, 0, 0, .42)',
    });
  } else {
    Object.assign(v, {
      '--accent-900': mix(p.accent, black, 0.45),
      '--accent-100': mix(p.accent, white, 0.84),
      '--accent-50': mix(p.accent, white, 0.92),
      '--toast-bg': mix(p.accent, black, 0.5),
      '--danger': '#c1443c', '--amber': '#b07d1e', '--danger-soft': '#fbe4e2',
      '--shadow': `0 1px 2px ${rgba(p.text, 0.1)}`, '--shadow-lg': `0 6px 18px ${rgba(p.text, 0.15)}`,
    });
  }
  return v;
}

function applyAll(): void {
  const root = document.documentElement;
  const palette = currentPalette();
  const vars = paletteVars(palette);
  for (const [k, val] of Object.entries(vars)) root.style.setProperty(k, val);
  const theme = palette.dark ? 'dark' : 'classic';
  root.setAttribute('data-theme', theme);
  root.setAttribute('data-palette', palette.id);
  root.removeAttribute('data-accent');
  root.removeAttribute('data-font-color');
  root.setAttribute('data-font-size', currentFontSize());
  root.setAttribute('data-font-weight', currentFontWeight());
  root.setAttribute('data-display-mode', currentDisplayMode());
  root.style.setProperty('--bg-wash', String(1 - currentBgPhoto() / 100));
  root.style.setProperty('--card-opacity', String(1 - currentCardTransparency() / 100));
  try {
    localStorage.setItem(KEYS.theme, theme);
    localStorage.setItem(KEYS.paletteCss, Object.entries(vars).map(([k, val]) => `${k}:${val}`).join(';'));
    for (const k of OLD_KEYS) localStorage.removeItem(k);
  } catch { /* private mode */ }
  // The phone's own status bar follows the set too.
  const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (meta) meta.content = palette.accent;
}

export function setPalette(id: string): void { localStorage.setItem(KEYS.palette, id); applyAll(); }
export function setFontSize(v: FontSizeId): void { localStorage.setItem(KEYS.fontSize, v); applyAll(); }
export function setFontWeight(v: FontWeightId): void { localStorage.setItem(KEYS.fontWeight, v); applyAll(); }
export function setDisplayMode(v: DisplayModeId): void { localStorage.setItem(KEYS.displayMode, v); applyAll(); }
export function setBgPhoto(v: number): void { localStorage.setItem(KEYS.bgPhoto, String(v)); applyAll(); }
export function setCardTransparency(v: number): void { localStorage.setItem(KEYS.cardTransparency, String(v)); applyAll(); }

/** Call once at startup — idempotent with the inline head snippet in index.html. */
export function initTheme(): void {
  applyAll();
}
