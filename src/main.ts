/* main.ts — entry point: routing between the views, PWA registration,
 * species seeding, sync bootstrap, and the topbar sync/offline indicator. */

import './styles/app.css';
import { registerSW } from 'virtual:pwa-register';

import { seedSpeciesIfEmpty, onDataChanged } from './db/repository';
import { SPECIES_SEED, SPECIES_SEED_VERSION } from './data/species-seed';
import { toast } from './lib/ui';
import { qs } from './lib/dom';
import { initTheme } from './lib/theme';
import { hydrateIcons } from './lib/icons';
import { initSync, onSyncStatus, requestSync } from './sync/sync-engine';
import { initFirebaseSyncFromSettings } from './firebase/firestore-sync';
import type { View, ViewParams } from './views/view';
import type { SyncStatus } from './types';

initTheme();

import * as formView from './views/form';
import * as mapView from './views/map';
import * as tableView from './views/table';
import * as cardsView from './views/cards';
import * as detailView from './views/detail';
import * as speciesView from './views/species';
import * as calendarView from './views/calendar';
import * as settingsView from './views/settings';
import * as statsView from './views/stats';

const VIEWS: Record<string, View> = {
  form: formView,
  map: mapView,
  table: tableView,
  cards: cardsView,
  detail: detailView,
  species: speciesView,
  calendar: calendarView,
  settings: settingsView,
  stats: statsView,
};

/** Views reachable from the bottom tab bar (order matters). */
const TAB_VIEWS = ['cards', 'calendar', 'map', 'species'];

let currentView: string | null = null;

async function showView(name: string): Promise<void> {
  if (!VIEWS[name]) name = 'cards';
  currentView = name;
  for (const key of Object.keys(VIEWS)) {
    document.getElementById(`view-${key}`)!.hidden = key !== name;
  }
  document.querySelectorAll<HTMLElement>('.tab').forEach((tab) => {
    tab.classList.toggle('active', tab.dataset.view === name);
  });
  updateChrome(name);
  if (location.hash !== `#${name}`) history.replaceState(null, '', `#${name}`);
  await VIEWS[name]!.activate();
}

/** Top-bar action button (⋯ overflow menu / ← back) and the FAB visibility. */
function updateChrome(name: string): void {
  const isTab = TAB_VIEWS.includes(name);
  const action = document.getElementById('nav-action')!;
  action.textContent = isTab ? '⋯' : '→';
  action.title = isTab ? 'תפריט' : 'חזרה ליומן';
  if (!isTab) document.getElementById('topbar-menu-list')!.hidden = true;
  const fab = document.getElementById('fab') as HTMLElement;
  fab.hidden = name !== 'cards';
}

export function navigate(name: string, params?: ViewParams): void {
  const view = VIEWS[name];
  if (params && view?.setParams) view.setParams(params);
  void showView(name);
}

function setupNav(): void {
  document.querySelectorAll<HTMLElement>('.tab').forEach((tab) => {
    tab.addEventListener('click', () => void showView(tab.dataset.view!));
  });

  const menuList = document.getElementById('topbar-menu-list')!;
  document.getElementById('nav-action')!.addEventListener('click', () => {
    if (TAB_VIEWS.includes(currentView || '')) { menuList.hidden = !menuList.hidden; }
    else navigate('cards');
  });
  menuList.querySelectorAll<HTMLElement>('button[data-view]').forEach((btn) => {
    btn.addEventListener('click', () => { menuList.hidden = true; navigate(btn.dataset.view!); });
  });
  document.addEventListener('click', (e) => {
    if (!(e.target as HTMLElement).closest('.topbar-menu')) menuList.hidden = true;
  });

  document.getElementById('fab')!.addEventListener('click', () => navigate('form'));
  window.addEventListener('hashchange', () => void showView(location.hash.replace('#', '') || 'cards'));
}

function setupStatusIndicator(): void {
  const dot = qs(document.body, '#net-status');
  const pill = qs(document.body, '#sync-pill');
  const paint = (s: SyncStatus): void => {
    dot.classList.toggle('offline', !navigator.onLine);
    dot.title = navigator.onLine ? 'מחובר לרשת' : 'ללא רשת — הכול נשמר מקומית';
    const map: Record<SyncStatus['state'], string> = {
      idle: '✓ מסונכרן', syncing: '↻ מסנכרן', offline: '⌁ לא מקוון',
      error: '⚠ שגיאת סנכרון', disabled: '', // hidden when local-only
    };
    const label = map[s.state] + (s.pending ? ` (${s.pending})` : '');
    pill.textContent = label;
    pill.hidden = s.state === 'disabled';
    pill.className = 'sync-pill ' + s.state;
  };
  window.addEventListener('online', () => paint({ ...lastStatus }));
  window.addEventListener('offline', () => paint({ ...lastStatus, state: 'offline' }));
  let lastStatus: SyncStatus = { state: 'disabled', pending: 0, lastSync: null };
  onSyncStatus((s) => { lastStatus = s; paint(s); });
}

async function init(): Promise<void> {
  hydrateIcons(document.body);
  await seedSpeciesIfEmpty(SPECIES_SEED, SPECIES_SEED_VERSION);

  for (const [name, view] of Object.entries(VIEWS)) {
    view.init(document.getElementById(`view-${name}`) as HTMLElement);
  }
  setupNav();
  setupStatusIndicator();

  // register the Workbox service worker (auto-updates on new deploys)
  registerSW({ immediate: true });

  await initSync();
  await initFirebaseSyncFromSettings();

  // when a sync pulls remote changes, refresh whatever screen is open
  let refreshTimer: ReturnType<typeof setTimeout> | undefined;
  onDataChanged(() => {
    requestSync();
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => { if (currentView) void VIEWS[currentView]!.activate(); }, 150);
  });

  await showView(location.hash.replace('#', '') || 'cards');
}

void init().catch((err: unknown) => {
  console.error(err);
  toast('שגיאה בטעינת האפליקציה: ' + (err as Error).message, true, 6000);
});
