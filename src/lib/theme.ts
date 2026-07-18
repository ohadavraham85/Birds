/* lib/theme.ts — color theme selection. Device-local only (like the other
 * local-only settings in sync-engine.ts), persisted in localStorage so it can
 * be applied synchronously before first paint (see the inline snippet in
 * index.html) instead of waiting on an async IndexedDB read. */

export const THEMES = [
  { id: 'classic', label: 'ירוק קלאסי', swatch: '#2d6a4f' },
  { id: 'forest', label: 'ירוק מאופק', swatch: '#3d5c46' },
  { id: 'slate', label: 'כחול-אפור ארגוני', swatch: '#3a5a7d' },
  { id: 'dark', label: 'כהה', swatch: '#3f8a7d' },
] as const;

export type ThemeId = (typeof THEMES)[number]['id'];

const STORAGE_KEY = 'birds-theme';

export function currentTheme(): ThemeId {
  const saved = localStorage.getItem(STORAGE_KEY);
  return (THEMES.some((t) => t.id === saved) ? saved : 'classic') as ThemeId;
}

function applyTheme(theme: ThemeId): void {
  document.documentElement.setAttribute('data-theme', theme);
}

export function setTheme(theme: ThemeId): void {
  localStorage.setItem(STORAGE_KEY, theme);
  applyTheme(theme);
}

/** Call once at startup — idempotent with the inline head snippet in index.html. */
export function initTheme(): void {
  applyTheme(currentTheme());
}
