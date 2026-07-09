/* app.js — entry point: routing between the 4 main views (+settings),
 * service-worker registration, species seeding, global sync button. */

import { seedSpeciesIfEmpty, getSetting, setSetting } from './db.js';
import { SPECIES_SEED } from './species-seed.js';
import { toast } from './ui.js';
import { syncNow, hasClientId } from './drive.js';
import * as formView from './views/form.js';
import * as mapView from './views/map.js';
import * as tableView from './views/table.js';
import * as cardsView from './views/cards.js';
import * as settingsView from './views/settings.js';

const VIEWS = {
  form: formView,
  map: mapView,
  table: tableView,
  cards: cardsView,
  settings: settingsView,
};

let currentView = null;

async function showView(name) {
  if (!VIEWS[name]) name = 'form';
  currentView = name;
  for (const key of Object.keys(VIEWS)) {
    const section = document.getElementById(`view-${key}`);
    section.hidden = key !== name;
  }
  document.querySelectorAll('.tab').forEach((tab) => {
    tab.classList.toggle('active', tab.dataset.view === name);
  });
  if (location.hash !== `#${name}`) history.replaceState(null, '', `#${name}`);
  await VIEWS[name].activate();
}

/** Other modules can trigger navigation (e.g. "edit" jumps to the form). */
export function navigate(name, params) {
  if (params && VIEWS[name].setParams) VIEWS[name].setParams(params);
  showView(name);
}

/** Refresh the visible view after data changes (e.g. post-sync). */
export function refreshCurrentView() {
  if (currentView) VIEWS[currentView].activate();
}

function setupNav() {
  document.querySelectorAll('.tab').forEach((tab) => {
    tab.addEventListener('click', () => showView(tab.dataset.view));
  });
  window.addEventListener('hashchange', () => {
    showView(location.hash.replace('#', '') || 'form');
  });
}

function setupNetStatus() {
  const el = document.getElementById('net-status');
  const update = () => {
    el.classList.toggle('offline', !navigator.onLine);
    el.title = navigator.onLine ? 'מחובר לרשת' : 'ללא רשת — הנתונים נשמרים מקומית';
  };
  window.addEventListener('online', update);
  window.addEventListener('offline', update);
  update();
}

function setupSyncButton() {
  const btn = document.getElementById('sync-btn');
  btn.addEventListener('click', async () => {
    if (!(await hasClientId())) {
      toast('כדי לסנכרן יש להגדיר חיבור ל-Google Drive במסך ההגדרות', true, 4000);
      navigate('settings');
      return;
    }
    if (!navigator.onLine) {
      toast('אין חיבור לרשת — הסנכרון יתאפשר כשתחזרו לקליטה', true);
      return;
    }
    btn.classList.add('syncing');
    btn.disabled = true;
    try {
      const res = await syncNow((msg) => toast(msg, false, 10000));
      toast(`הסנכרון הושלם — ${res.count} תצפיות בענן`);
      refreshCurrentView();
    } catch (err) {
      console.error(err);
      toast(err.message || 'הסנכרון נכשל', true, 5000);
    } finally {
      btn.classList.remove('syncing');
      btn.disabled = false;
    }
  });
}

function registerServiceWorker() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch((err) => {
      console.warn('Service worker registration failed:', err);
    });
  }
}

async function init() {
  await seedSpeciesIfEmpty(SPECIES_SEED);
  for (const [name, view] of Object.entries(VIEWS)) {
    view.init(document.getElementById(`view-${name}`));
  }
  setupNav();
  setupNetStatus();
  setupSyncButton();
  registerServiceWorker();

  const first = location.hash.replace('#', '');
  await showView(first || 'form');

  // gentle first-run pointer to Drive setup
  if (!(await getSetting('googleClientId')) && !(await getSetting('setupHintShown'))) {
    setTimeout(() => toast('טיפ: חברו את האפליקציה ל-Google Drive דרך מסך ההגדרות', false, 5000), 1500);
    await setSetting('setupHintShown', true);
  }
}

init().catch((err) => {
  console.error(err);
  toast('שגיאה בטעינת האפליקציה: ' + err.message, true, 6000);
});
