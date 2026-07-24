/* main.ts — entry point: routing between the views, PWA registration,
 * species seeding, sync bootstrap, and the topbar sync/offline indicator. */

import './styles/app.css';
import { registerSW } from 'virtual:pwa-register';

import { seedSpeciesIfEmpty, onDataChanged, listObservations } from './db/repository';
import { SPECIES_SEED, SPECIES_SEED_VERSION } from './data/species-seed';
import { toast } from './lib/ui';
import { qs } from './lib/dom';
import { initTheme } from './lib/theme';
import { hydrateIcons, icon, type IconName } from './lib/icons';
import { initFirebaseSyncFromSettings, onFirebaseSyncStatus, type FirebaseSyncStatus } from './firebase/firestore-sync';
import { checkAndNotify } from './lib/notifications';
import type { View, ViewParams } from './views/view';

initTheme();

import * as homeView from './views/home';
import * as formView from './views/form';
import * as mapView from './views/map';
import * as tableView from './views/table';
import * as cardsView from './views/cards';
import * as detailView from './views/detail';
import * as speciesView from './views/species';
import * as calendarView from './views/calendar';
import * as settingsView from './views/settings';

const VIEWS: Record<string, View> = {
  home: homeView,
  form: formView,
  map: mapView,
  table: tableView,
  cards: cardsView,
  detail: detailView,
  species: speciesView,
  calendar: calendarView,
  settings: settingsView,
};

/** Views reachable from the bottom tab bar (order matters). */
const TAB_VIEWS = ['home', 'cards', 'calendar', 'map', 'species'];

/** The universal "root" screen: default landing view, and where the generic
 * top-bar back button and other screens' explicit back actions return to. */
const HOME_VIEW = 'home';

let currentView: string | null = null;
/** How many in-app history entries we've pushed beyond the initial screen —
 * lets goBack() fall back to the home screen instead of leaving the PWA
 * entirely when there's nothing left in our own stack to pop. */
let navDepth = 0;

function mainScrollTop(): number {
  return document.getElementById('main')?.scrollTop ?? 0;
}

interface NavState { view: string; scrollTop: number }

/** All navigation goes through here. `mode` controls how it's recorded in
 * the browser's history:
 *  - 'push' (regular forward navigation, e.g. navigate()): snapshots the
 *    screen being left (so returning to it later restores its scroll
 *    position — each view's own filters/toggles already persist in its
 *    module state) and pushes a fresh entry for the destination.
 *  - 'replace': swaps the current entry in place (used only at boot).
 *  - 'pop': the browser already moved the history pointer (back/forward
 *    button, or an in-app back action via goBack()) — just render the
 *    view the popstate event told us about and restore its saved scroll,
 *    without touching history again. */
async function showView(name: string, params?: ViewParams, mode: 'push' | 'replace' | 'pop' = 'push'): Promise<void> {
  if (!VIEWS[name]) name = HOME_VIEW;

  if (mode === 'push' && currentView) {
    const leavingState: NavState = { view: currentView, scrollTop: mainScrollTop() };
    history.replaceState(leavingState, '', location.hash || `#${currentView}`);
  }

  if (currentView && currentView !== name) VIEWS[currentView]!.deactivate?.();

  currentView = name;
  for (const key of Object.keys(VIEWS)) {
    document.getElementById(`view-${key}`)!.hidden = key !== name;
  }
  document.querySelectorAll<HTMLElement>('.tab').forEach((tab) => {
    tab.classList.toggle('active', tab.dataset.view === name);
  });
  updateChrome(name);

  if (mode === 'push') {
    const enteringState: NavState = { view: name, scrollTop: 0 };
    history.pushState(enteringState, '', `#${name}`);
    navDepth++;
  } else if (mode === 'replace') {
    const enteringState: NavState = { view: name, scrollTop: 0 };
    history.replaceState(enteringState, '', `#${name}`);
  }

  // Always call setParams on push/replace (with {} when no params were given) so a
  // view's stale params from a previous visit (e.g. form.ts's editId) get reset to
  // their defaults instead of silently carrying over into a bare navigation —
  // every view's setParams already treats a missing field as "use the default".
  if (mode !== 'pop' && VIEWS[name]!.setParams) VIEWS[name]!.setParams!(params ?? {});
  await VIEWS[name]!.activate();

  if (mode === 'pop') {
    const savedTop = (history.state as NavState | null)?.scrollTop ?? 0;
    requestAnimationFrame(() => { const main = document.getElementById('main'); if (main) main.scrollTop = savedTop; });
  }
}

/** Top-bar action button (⋯ overflow menu / ← back) and the FAB visibility. */
function updateChrome(name: string): void {
  const isTab = TAB_VIEWS.includes(name);
  const action = document.getElementById('nav-action')!;
  action.textContent = isTab ? '⋯' : '→';
  action.title = isTab ? 'תפריט' : 'חזרה';
  if (!isTab) document.getElementById('topbar-menu-list')!.hidden = true;
  const fab = document.getElementById('fab') as HTMLElement;
  fab.hidden = name !== 'cards' && name !== HOME_VIEW;
}

export function navigate(name: string, params?: ViewParams): void {
  void showView(name, params, 'push');
}

/** The single "go back" action — used by the topbar back arrow and every
 * screen's explicit back button, so in-app back and the device/browser back
 * button behave identically and always land exactly where the user came
 * from. Falls back to the home screen if there's nothing left to pop (e.g.
 * the app was opened directly on an inner screen via a deep link). */
export function goBack(): void {
  if (navDepth > 0) { navDepth--; history.back(); }
  else navigate(HOME_VIEW);
}

function setupNav(): void {
  document.querySelectorAll<HTMLElement>('.tab').forEach((tab) => {
    tab.addEventListener('click', () => navigate(tab.dataset.view!));
  });

  const menuList = document.getElementById('topbar-menu-list')!;
  document.getElementById('nav-action')!.addEventListener('click', () => {
    if (TAB_VIEWS.includes(currentView || '')) { menuList.hidden = !menuList.hidden; }
    else goBack();
  });
  menuList.querySelectorAll<HTMLElement>('button[data-view]').forEach((btn) => {
    btn.addEventListener('click', () => { menuList.hidden = true; navigate(btn.dataset.view!); });
  });
  document.addEventListener('click', (e) => {
    if (!(e.target as HTMLElement).closest('.topbar-menu')) menuList.hidden = true;
  });

  document.getElementById('fab')!.addEventListener('click', () => navigate('form'));

  window.addEventListener('popstate', (e: PopStateEvent) => {
    const state = e.state as NavState | null;
    if (navDepth > 0) navDepth--;
    void showView(state?.view || HOME_VIEW, undefined, 'pop');
  });
}

/** Maps a status to what the topbar pill shows. The spinner only appears
 * while `syncing` (a local write is actively being pushed and we're online);
 * `idle` is a quiet, static "synced" icon — it does not auto-hide. Offline
 * with queued-but-unsent changes gets a small badge dot instead of a spin,
 * since nothing is actually being transmitted while offline. */
function syncPillContent(s: FirebaseSyncStatus): { icon: IconName | null; label: string; badge: boolean } {
  if (s.state === 'disabled') return { icon: null, label: '', badge: false };
  if (s.state === 'syncing') return { icon: 'refresh', label: 'מסנכרן...', badge: false };
  if (s.state === 'offline') {
    return s.pending
      ? { icon: 'wifiOff', label: 'שינויים ממתינים', badge: true }
      : { icon: 'wifiOff', label: 'לא מקוון', badge: false };
  }
  if (s.state === 'error') return { icon: 'alert', label: 'שגיאת סנכרון', badge: false };
  return { icon: 'check', label: 'מסונכרן', badge: false };
}

/** Live-updating date/time under the (fixed) app title in the top bar. */
function formatClock(d: Date): string {
  const weekday = d.toLocaleDateString('he-IL', { weekday: 'long' });
  const pad = (n: number): string => String(n).padStart(2, '0');
  const date = `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  return `${weekday}, ${date} | ${time}`;
}

function setupClock(): void {
  const el = document.getElementById('topbar-datetime');
  if (!el) return;
  const tick = (): void => { el.textContent = formatClock(new Date()); };
  tick();
  setInterval(tick, 1000);
}

function setupStatusIndicator(): void {
  const dot = qs(document.body, '#net-status');
  const pill = qs(document.body, '#sync-pill');

  const paintNet = (): void => {
    dot.classList.toggle('offline', !navigator.onLine);
    dot.title = navigator.onLine ? 'מחובר לרשת' : 'ללא רשת — הכול נשמר מקומית';
  };
  window.addEventListener('online', paintNet);
  window.addEventListener('offline', paintNet);
  paintNet();

  onFirebaseSyncStatus((s) => {
    const { icon: iconName, label, badge } = syncPillContent(s);
    pill.innerHTML = iconName ? icon(iconName) + ` <span>${label}</span>` + (badge ? '<span class="sync-pill-dot"></span>' : '') : '';
    pill.title = s.message || label;
    pill.hidden = s.state === 'disabled';
    pill.className = 'sync-pill ' + s.state;
  });
}

async function init(): Promise<void> {
  hydrateIcons(document.body);
  await seedSpeciesIfEmpty(SPECIES_SEED, SPECIES_SEED_VERSION);

  for (const [name, view] of Object.entries(VIEWS)) {
    view.init(document.getElementById(`view-${name}`) as HTMLElement);
  }
  setupNav();
  setupStatusIndicator();
  setupClock();

  // register the Workbox service worker (auto-updates on new deploys)
  registerSW({ immediate: true });

  await initFirebaseSyncFromSettings();
  void checkAndNotify(await listObservations());

  // when a sync pulls remote changes, refresh whatever screen is open
  let refreshTimer: ReturnType<typeof setTimeout> | undefined;
  onDataChanged(() => {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => { if (currentView) void VIEWS[currentView]!.activate(); }, 150);
  });

  // A hard refresh always lands on Home — in-session back/forward is the only
  // thing the hash fragment is meant to drive; per-view params (which
  // observation, which filter) live only in memory and can't survive a
  // reload anyway, so reopening whatever view the hash names would show a
  // stale/empty screen instead of a working one.
  await showView(HOME_VIEW, undefined, 'replace');
}

void init().catch((err: unknown) => {
  console.error(err);
  toast('שגיאה בטעינת האפליקציה: ' + (err as Error).message, true, 6000);
});
