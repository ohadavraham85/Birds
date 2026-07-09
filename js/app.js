/* app.js — entry point: routing between the 4 main views (+settings)
 * and service-worker registration. POC: fully client-side, no server. */

import { seedSpeciesIfEmpty } from './db.js';
import { SPECIES_SEED, SPECIES_SEED_VERSION } from './species-seed.js';
import { toast } from './ui.js';
import * as formView from './views/form.js';
import * as mapView from './views/map.js';
import * as tableView from './views/table.js';
import * as cardsView from './views/cards.js';
import * as speciesView from './views/species.js';
import * as settingsView from './views/settings.js';

const VIEWS = {
  form: formView,
  map: mapView,
  table: tableView,
  cards: cardsView,
  species: speciesView,
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
    el.title = navigator.onLine ? 'מחובר לרשת' : 'ללא רשת — הכול ממשיך לעבוד מקומית';
  };
  window.addEventListener('online', update);
  window.addEventListener('offline', update);
  update();
}

function registerServiceWorker() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch((err) => {
      console.warn('Service worker registration failed:', err);
    });
  }
}

async function init() {
  await seedSpeciesIfEmpty(SPECIES_SEED, SPECIES_SEED_VERSION);
  for (const [name, view] of Object.entries(VIEWS)) {
    view.init(document.getElementById(`view-${name}`));
  }
  setupNav();
  setupNetStatus();
  registerServiceWorker();
  await showView(location.hash.replace('#', '') || 'form');
}

init().catch((err) => {
  console.error(err);
  toast('שגיאה בטעינת האפליקציה: ' + err.message, true, 6000);
});
