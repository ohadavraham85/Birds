/* main.ts — entry point: routing between the views, PWA registration. */

import './styles/app.css';
import { registerSW } from 'virtual:pwa-register';

import { onDataChanged } from './db/repository';
import { toast } from './lib/ui';
import { qs } from './lib/dom';
import { initTheme } from './lib/theme';
import { hydrateIcons, icon } from './lib/icons';
import type { View, ViewParams } from './views/view';

initTheme();

import * as homeView from './views/home';
import * as formView from './views/form';
import * as mapView from './views/map';
import * as tableView from './views/table';
import * as detailView from './views/detail';
import * as settingsView from './views/settings';
import * as diagramsView from './views/diagrams';
import * as diagramView from './views/diagram';

const VIEWS: Record<string, View> = {
  home: homeView,
  form: formView,
  map: mapView,
  list: tableView,
  detail: detailView,
  settings: settingsView,
  diagrams: diagramsView,
  diagram: diagramView,
};

/** Views reachable from the bottom tab bar (order matters). */
const TAB_VIEWS = ['home', 'list', 'map', 'diagrams'];

/** Views where the floating "+" (add asset) button appears. */
const FAB_VIEWS = ['home', 'list'];

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
 *    position) and pushes a fresh entry for the destination.
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

  if (mode !== 'pop' && VIEWS[name]!.setParams) VIEWS[name]!.setParams!(params ?? {});
  await VIEWS[name]!.activate();

  if (mode === 'pop') {
    const savedTop = (history.state as NavState | null)?.scrollTop ?? 0;
    requestAnimationFrame(() => { const main = document.getElementById('main'); if (main) main.scrollTop = savedTop; });
  }
}

/** Top-bar action button (gear → settings / ← back) and the FAB visibility. */
function updateChrome(name: string): void {
  const isTab = TAB_VIEWS.includes(name);
  const action = document.getElementById('nav-action')!;
  action.innerHTML = isTab ? icon('gear', 'icon-lg') : '→';
  action.title = isTab ? 'הגדרות' : 'חזרה';
  const fab = document.getElementById('fab') as HTMLElement;
  fab.hidden = !FAB_VIEWS.includes(name);
}

export function navigate(name: string, params?: ViewParams): void {
  void showView(name, params, 'push');
}

/** The single "go back" action — used by the topbar back arrow and every
 * screen's explicit back button, so in-app back and the device/browser back
 * button behave identically and always land exactly where the user came
 * from. Falls back to the home screen if there's nothing left to pop. */
export function goBack(): void {
  if (navDepth > 0) { navDepth--; history.back(); }
  else navigate(HOME_VIEW);
}

function setupNav(): void {
  document.querySelectorAll<HTMLElement>('.tab').forEach((tab) => {
    tab.addEventListener('click', () => navigate(tab.dataset.view!));
  });

  document.getElementById('nav-action')!.addEventListener('click', () => {
    if (TAB_VIEWS.includes(currentView || '')) navigate('settings');
    else goBack();
  });

  document.getElementById('fab')!.addEventListener('click', () => navigate('form'));

  window.addEventListener('popstate', (e: PopStateEvent) => {
    const state = e.state as NavState | null;
    if (navDepth > 0) navDepth--;
    void showView(state?.view || HOME_VIEW, undefined, 'pop');
  });
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
  const paintNet = (): void => {
    dot.classList.toggle('offline', !navigator.onLine);
    dot.title = navigator.onLine ? 'מחובר לרשת' : 'ללא רשת — הכול נשמר מקומית';
  };
  window.addEventListener('online', paintNet);
  window.addEventListener('offline', paintNet);
  paintNet();
}

async function init(): Promise<void> {
  hydrateIcons(document.body);

  for (const [name, view] of Object.entries(VIEWS)) {
    view.init(document.getElementById(`view-${name}`) as HTMLElement);
  }
  setupNav();
  setupStatusIndicator();
  setupClock();

  // register the Workbox service worker (auto-updates on new deploys)
  registerSW({ immediate: true });

  // Refresh whatever screen is open when a local write elsewhere fires
  // onDataChanged — except the form, whose activate() reloads the asset
  // being edited and would discard in-progress edits.
  let refreshTimer: ReturnType<typeof setTimeout> | undefined;
  onDataChanged(() => {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => { if (currentView && currentView !== 'form') void VIEWS[currentView]!.activate(); }, 150);
  });

  // A hard refresh always lands on Home — per-view params (which asset,
  // which filter) live only in memory and can't survive a reload anyway.
  await showView(HOME_VIEW, undefined, 'replace');
}

void init().catch((err: unknown) => {
  console.error(err);
  toast('שגיאה בטעינת האפליקציה: ' + (err as Error).message, true, 6000);
});
