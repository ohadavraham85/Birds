/* lib/icons.ts — small inline-SVG line-icon set, replacing the colorful
 * emoji previously used as functional UI icons throughout the app. Icons
 * inherit color/size from their surrounding text via the `.icon` CSS class,
 * so they drop into template strings the same way an emoji character did. */

const PATHS = {
  logo: '<circle cx="7.5" cy="12" r="4.2"/><circle cx="16.5" cy="12" r="4.2"/><path d="M11.2 12h1.6"/><circle cx="7.5" cy="12" r="1.4" fill="currentColor" stroke="none"/><circle cx="16.5" cy="12" r="1.4" fill="currentColor" stroke="none"/>',
  journal: '<path d="M4 5.5c2-1 5-1 8 0v13c-3-1-6-1-8 0v-13Z"/><path d="M20 5.5c-2-1-5-1-8 0v13c3-1 6-1 8 0v-13Z"/>',
  home: '<path d="M4 11.5 12 4l8 7.5"/><path d="M6 10v9h12v-9"/><path d="M10 19v-5h4v5"/>',
  calendar: '<rect x="3.5" y="5" width="17" height="15" rx="2.2"/><path d="M8 3v4M16 3v4M3.5 10h17"/>',
  map: '<path d="M9 4 3.5 6v14L9 18l6 2 5.5-2V4L15 6 9 4Z"/><path d="M9 4v14M15 6v14"/>',
  bird: '<path d="M4 15c1.5 2 4 3 7 2.5"/><path d="M4 15c2-6 8-10 15-9-1 1.6-1.9 2.6-3.4 3.2 1 .4 1.8 1 2.4 1.8-3 .4-5 1.6-6.3 3.6-.8 1.2-1.2 2.6-1.2 4.4"/><circle cx="17.3" cy="7.6" r=".8" fill="currentColor" stroke="none"/>',
  list: '<path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4.5" cy="6" r="1.1" fill="currentColor" stroke="none"/><circle cx="4.5" cy="12" r="1.1" fill="currentColor" stroke="none"/><circle cx="4.5" cy="18" r="1.1" fill="currentColor" stroke="none"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M12 2.5v3M12 18.5v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2.5 12h3M18.5 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  target: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>',
  layers: '<path d="m12 3 8 4.5-8 4.5-8-4.5L12 3Z"/><path d="m4 12 8 4.5 8-4.5"/><path d="m4 16.5 8 4.5 8-4.5"/>',
  pin: '<path d="M12 21s7-6.2 7-11.5A7 7 0 0 0 5 9.5C5 14.8 12 21 12 21Z"/><circle cx="12" cy="9.5" r="2.3"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.2 2"/>',
  compass: '<circle cx="12" cy="12" r="9"/><path d="m14.5 9.5-2 5-5 2 2-5 5-2Z"/>',
  edit: '<path d="M4 20h4L20 8l-4-4L4 16v4Z"/><path d="m14.5 5.5 4 4"/>',
  document: '<path d="M6 3h9l4 4v14H6V3Z"/><path d="M15 3v4h4"/><path d="M9 12h6M9 16h6"/>',
  camera: '<path d="M4 8h3l1.5-2h7L17 8h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1Z"/><circle cx="12" cy="13" r="3.3"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m20 20-4.5-4.5"/>',
  trash: '<path d="M5 7h14M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2m-9 0 1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13"/>',
  save: '<path d="M5 4h11l3 3v13H5V4Z"/><path d="M8 4v6h8V4M8 14h8v6"/>',
  refresh: '<path d="M4 12a8 8 0 0 1 13.7-5.7L20 8"/><path d="M20 4v4h-4"/><path d="M20 12a8 8 0 0 1-13.7 5.7L4 16"/><path d="M4 20v-4h4"/>',
  cloud: '<path d="M7 18h10a4 4 0 0 0 .5-8 5.5 5.5 0 0 0-10.6-1.7A4.5 4.5 0 0 0 7 18Z"/>',
  database: '<ellipse cx="12" cy="5.5" rx="7" ry="2.5"/><path d="M5 5.5v13c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5v-13"/><path d="M5 12c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5"/>',
  palette: '<path d="M12 3a9 9 0 1 0 0 18c1 0 1.4-.6 1.4-1.3 0-.4-.2-.7-.4-1-.2-.3-.4-.6-.4-1 0-.7.6-1.2 1.3-1.2H16a4 4 0 0 0 4-4c0-5-3.6-9.5-8-9.5Z"/><circle cx="7.5" cy="11" r="1.1" fill="currentColor" stroke="none"/><circle cx="10.5" cy="7.5" r="1.1" fill="currentColor" stroke="none"/><circle cx="15" cy="8" r="1.1" fill="currentColor" stroke="none"/>',
  grid: '<rect x="4" y="4" width="7" height="7" rx="1"/><rect x="13" y="4" width="7" height="7" rx="1"/><rect x="4" y="13" width="7" height="7" rx="1"/><rect x="13" y="13" width="7" height="7" rx="1"/>',
  upload: '<path d="M12 20V6"/><path d="m6 11 6-6 6 6"/><path d="M4 20h16"/>',
  download: '<path d="M12 4v14"/><path d="m6 12 6 6 6-6"/><path d="M4 20h16"/>',
  filter: '<path d="M4 5h16l-6.2 7.2v5.3l-3.6 2v-7.3L4 5Z"/>',
  chevronsDown: '<path d="m7 8.5 5 5 5-5"/><path d="m7 14.5 5 5 5-5"/>',
  chevronsUp: '<path d="m7 15.5 5-5 5 5"/><path d="m7 9.5 5-5 5 5"/>',
  sortArrows: '<path d="M8 20V5"/><path d="m4.5 8.5 3.5-3.5 3.5 3.5"/><path d="M16 4v15"/><path d="m12.5 15.5 3.5 3.5 3.5-3.5"/>',
  chart: '<path d="M4 20V10M11 20V4M18 20v-7"/><path d="M3 20h18"/>',
  pieChart: '<circle cx="12" cy="12" r="9"/><path d="M12 3v9h9"/>',
  lineChart: '<path d="M4 19V5"/><path d="M4 19h16"/><path d="m4.5 14.5 4.5-5 4 3.2 6-7.2"/>',
  gridRect: '<rect x="3.5" y="4.5" width="17" height="6.5" rx="1.2"/><rect x="3.5" y="13" width="17" height="6.5" rx="1.2"/>',
  check: '<path d="M5 12.5 10 17.5 19 7"/>',
  wifiOff: '<path d="M2 8.5a15.5 15.5 0 0 1 5-3M9.5 4.5A15.5 15.5 0 0 1 22 8.5"/><path d="M5 12a11 11 0 0 1 3.3-2.1M15.7 9.9A11 11 0 0 1 19 12"/><path d="M8.5 15.5a6 6 0 0 1 7 0"/><circle cx="12" cy="19.5" r="1" fill="currentColor" stroke="none"/><path d="M3 3l18 18"/>',
  alert: '<path d="M12 3 22 20H2L12 3Z"/><path d="M12 10v4"/><circle cx="12" cy="17.3" r=".9" fill="currentColor" stroke="none"/>',
  bell: '<path d="M6 17v-5.5a6 6 0 0 1 12 0V17l2 2.5H4L6 17Z"/><path d="M10 20a2 2 0 0 0 4 0"/>',
  lock: '<rect x="5" y="11" width="14" height="9" rx="1.6"/><path d="M8 11V7.5a4 4 0 0 1 8 0V11"/>',
  folder: '<path d="M4 6.5a2 2 0 0 1 2-2h4.2l2 2H18a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-11Z"/>',
  eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z"/><circle cx="12" cy="12" r="3"/>',
  mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0"/><path d="M12 17.5v3M9 20.5h6"/>',
  star: '<path d="M12 3.5 14.6 9l6 .9-4.3 4.2 1 6-5.3-2.8-5.3 2.8 1-6L3.4 9.9l6-.9L12 3.5Z"/>',

  /* ---- tag icons: bird-family pictograms for the tag color/icon picker ---- */
  tagRaptor: '<path d="M12 6c-3.5 1-7 4-9.5 3.3C4 11 7 12 9.5 11.8L12 15l2.5-3.2c2.5.2 5.5-.8 7-2.5C19 10 15.5 7 12 6Z"/><path d="M12 15v3.5"/><path d="m9.5 21 2.5-2 2.5 2"/>',
  tagOwl: '<path d="M6 10c0-3.5 2.7-6 6-6s6 2.5 6 6-1.5 8-6 8-6-4.5-6-8Z"/><circle cx="9.3" cy="10" r="1.6"/><circle cx="14.7" cy="10" r="1.6"/><path d="M12 12.5 11 14h2l-1 1.5"/><path d="M4 8c1-1.5 2.3-2 3.3-1.8M20 8c-1-1.5-2.3-2-3.3-1.8"/>',
  tagHeron: '<path d="M7 20c0-3 .5-5 2-6.5"/><path d="M10.5 20c0-3.5.5-6 2-7.5"/><path d="M17 4c-2.5 0-5 2-5 5 0 2 1 3 1 3l-3.5 1.2L12 15l3-1.3c2.5-.7 4-2.7 4-5.2 0-2-.8-3.3-2-4.5Z"/><circle cx="16.3" cy="6.2" r=".9" fill="currentColor" stroke="none"/>',
  tagDuck: '<path d="M4 15c0-4 3-7 7-7 3.5 0 6 2 7 5h1.5c1 0 1.5.6 1.5 1.3 0 .8-.6 1.4-1.5 1.4H18c-1 2-3 3.3-6 3.3-4.5 0-8-1.5-8-4Z"/><circle cx="9" cy="10.3" r=".9" fill="currentColor" stroke="none"/><path d="M4 15c-1 0-2-.5-2-1.5"/>',
  tagSongbird: '<path d="M6 14c0-3.5 3-6.5 7-6.5 3.8 0 6.5 2 6.5 4.7 0 2.5-2.3 4.3-5.5 4.3-.7 1.6-2.3 2.5-4 2.5-1 0-1.7-.3-1.7-.3"/><circle cx="16.3" cy="9.8" r=".9" fill="currentColor" stroke="none"/><path d="M6 14c-1.3 0-2.5-.6-3-1.8"/><path d="M9 20v-3M13 20v-2.5"/>',
  tagGull: '<path d="M2.5 12c2.5-3 5-3.3 7-1 1.3-2.6 3.7-2.6 5 0 2-2.3 4.5-2 7 1-2.5-1-4.3-.6-5.7 1-1-1.7-2.6-1.7-3.6 0-1.7-2-4-1.7-6.3 0-1.4-1.6-3.2-2-4.4-1Z"/>',
  tagWoodpecker: '<path d="M9 21V9"/><path d="M13.5 6.5c2.3 0 4.2 1 5.5 2.7-1.7.6-3-.2-3.6-1-1 1.3-2.7 1.8-4.4 1.2-1-2 .3-3.7 2.5-2.9Z"/><path d="M11 10c-1.7 0-3-.6-3.7-1.8"/><path d="m15.5 9 2 1.3"/>',
  tagDove: '<path d="M5 13.5c0-3 2.7-5.5 6.5-5.5 4 0 6.5 2.2 6.5 4.8 0 2.4-2.2 4-5 4.2-.6 1.3-2 2-3.5 2-2.6 0-4.5-1-4.5-2.6 0-1 .8-1.7 1.7-1.9"/><circle cx="15.2" cy="9.8" r=".8" fill="currentColor" stroke="none"/>',
  tagShorebird: '<path d="M6 20v-5.5c0-1 .3-1.6 1-2.2L9.5 10"/><path d="M9.5 10c1.7-1.7 3.6-1.7 4.5 0"/><ellipse cx="12" cy="10.5" rx="4" ry="2.7"/><path d="M16 10.2 19 9"/><path d="M9 20v-3.5"/>',
  tagGeneric: '<path d="M4 4h7l9 9-7 7-9-9V4Z"/><circle cx="8.3" cy="8.3" r="1.3"/>',
} as const;

export type IconName = keyof typeof PATHS;

export function icon(name: IconName, extraClass = ''): string {
  return `<svg class="icon${extraClass ? ' ' + extraClass : ''}" viewBox="0 0 24 24" aria-hidden="true">${PATHS[name]}</svg>`;
}

/** Fills every `[data-icon]` placeholder in static HTML (index.html chrome)
 * with its SVG. Dynamically-rendered view templates call icon() directly. */
export function hydrateIcons(root: ParentNode = document): void {
  root.querySelectorAll<HTMLElement>('[data-icon]').forEach((el) => {
    el.innerHTML = icon(el.dataset.icon as IconName);
  });
}
