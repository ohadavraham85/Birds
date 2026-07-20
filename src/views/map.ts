/* views/map.ts — מסך מפת השטח: נקודה אחת לכל מיקום ייחודי (לפי הקואורדינטות
 * של התצפית הראשונה שנרשמה שם), עם תווית קטנה וצמודה של שם המיקום. לחיצה על
 * נקודה פותחת חלון תחתון (bottom sheet) עם שם המקום, רשימת כל התצפיות
 * ההיסטוריות באותו מיקום (מהחדשה לישנה, לחיצה על אחת פותחת אותה בתצוגת
 * צפייה), וכפתור קומפקטי להוספת תצפית חדשה; לחיצה ארוכה על המפה פותחת אותו
 * חלון במיקום חדש שנבחר. שכבת הלוויין במצב היברידי כוללת שכבת תוויות (שמות
 * מקומות/כבישים) מעל צילום האוויר. שכבת GPS מציגה את מיקום המשתמש בזמן
 * אמת, עם כפתור להתמרכזות עליו. */

import L from '../lib/leaflet-setup';
import { listObservations, getSetting, setSetting } from '../db/repository';
import { toast } from '../lib/ui';
import { escapeHtml } from '../lib/markdown';
import { speciesLabel } from '../lib/observation';
import { icon } from '../lib/icons';
import { qs } from '../lib/dom';
import { navigate } from '../main';
import type { Observation } from '../types';

let container: HTMLElement;
let map: L.Map | undefined;
let markersLayer: L.LayerGroup | undefined;
let dropMarker: L.Marker | undefined;
let myLocationMarker: L.CircleMarker | undefined;
let geoWatchId: number | null = null;
let streetLayer: L.TileLayer;
let satelliteLayer: L.TileLayer;
let roadsLayer: L.TileLayer;
let labelsLayer: L.TileLayer;
let allObservations: Observation[] = [];
let closeSheet: (() => void) | null = null;

/** Which base/overlay tiles are showing — persisted per device (like the color
 * theme) so the map reopens the way the user last left it. */
interface MapLayerState { satellite: boolean; roads: boolean; labels: boolean }
let layerState: MapLayerState = { satellite: true, roads: false, labels: true };

/** Round green badge with a bird glyph, replacing Leaflet's default pin.
 * tooltipAnchor keeps the small permanent name label snug against the badge. */
const birdIcon = L.divIcon({
  className: 'bird-div-icon',
  html: `<div class="bird-marker-badge">${icon('bird')}</div>`,
  iconSize: [30, 30],
  iconAnchor: [15, 15],
  tooltipAnchor: [0, -16],
  popupAnchor: [0, -17],
});

export function init(el: HTMLElement): void {
  container = el;
  container.innerHTML = `
    <div id="map-container"></div>
    <div class="map-hint">לחיצה ארוכה על המפה מוסיפה תצפית במיקום חדש · לחיצה על נקודה קיימת מציגה את היסטוריית התצפיות שם</div>
    <button id="locate-btn" class="map-locate-btn" type="button" title="התמרכזות על המיקום הנוכחי" aria-label="התמרכזות על המיקום הנוכחי">${icon('target')}</button>
    <button id="layer-toggle-btn" class="map-layer-btn" type="button" title="שכבות מפה" aria-label="שכבות מפה">${icon('layers')}</button>
    <div class="map-layers-menu" id="map-layers-menu" hidden>
      <label><input type="checkbox" id="ml-satellite"> שכבת לוויין</label>
      <label><input type="checkbox" id="ml-roads"> שכבת כבישים</label>
      <label><input type="checkbox" id="ml-labels"> תוויות גיאוגרפיות</label>
    </div>
    <div class="map-empty" id="map-empty" hidden>אין עדיין תצפיות עם קואורדינטות.<br>הוסיפו תצפית עם מיקום GPS והיא תופיע כאן.</div>
  `;
  qs(container, '#locate-btn').addEventListener('click', onLocateClick);
  const menu = qs(container, '#map-layers-menu');
  qs(container, '#layer-toggle-btn').addEventListener('click', () => { menu.hidden = !menu.hidden; });
  document.addEventListener('click', (e) => {
    if (!menu.hidden && !(e.target as HTMLElement).closest('.map-layer-btn, .map-layers-menu')) menu.hidden = true;
  });
  menu.addEventListener('change', (e) => void onLayerCheckboxChange(e));
}

async function loadLayerState(): Promise<void> {
  layerState = {
    satellite: await getSetting('mapLayerSatellite', true),
    roads: await getSetting('mapLayerRoads', false),
    labels: await getSetting('mapLayerLabels', true),
  };
}

function syncLayerCheckboxes(): void {
  qs<HTMLInputElement>(container, '#ml-satellite').checked = layerState.satellite;
  qs<HTMLInputElement>(container, '#ml-roads').checked = layerState.roads;
  qs<HTMLInputElement>(container, '#ml-labels').checked = layerState.labels;
}

/** Applies the current layerState to the live map — satellite/street are a
 * mutually-exclusive base, roads and labels are independent overlays that
 * can layer on top of either base. */
function applyLayerState(): void {
  if (!map) return;
  if (layerState.satellite) { map.removeLayer(streetLayer); satelliteLayer.addTo(map); }
  else { map.removeLayer(satelliteLayer); streetLayer.addTo(map); }
  if (layerState.roads) roadsLayer.addTo(map); else map.removeLayer(roadsLayer);
  if (layerState.labels) labelsLayer.addTo(map); else map.removeLayer(labelsLayer);
}

async function onLayerCheckboxChange(e: Event): Promise<void> {
  const target = e.target as HTMLInputElement;
  if (target.id === 'ml-satellite') { layerState.satellite = target.checked; await setSetting('mapLayerSatellite', layerState.satellite); }
  else if (target.id === 'ml-roads') { layerState.roads = target.checked; await setSetting('mapLayerRoads', layerState.roads); }
  else if (target.id === 'ml-labels') { layerState.labels = target.checked; await setSetting('mapLayerLabels', layerState.labels); }
  else return;
  applyLayerState();
}

function ensureMap(): void {
  if (map) return;
  map = L.map('map-container', { zoomControl: true }).setView([31.5, 35.0], 8);
  streetLayer = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; OpenStreetMap',
  });
  satelliteLayer = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
    maxZoom: 19,
    zIndex: 1,
    attribution: 'Tiles &copy; Esri',
  });
  roadsLayer = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}', {
    maxZoom: 19,
    zIndex: 2,
  });
  labelsLayer = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}', {
    maxZoom: 19,
    zIndex: 3,
  });
  markersLayer = L.layerGroup().addTo(map);

  // long-press (contextmenu on touch) drops a pin at a new location
  map.on('contextmenu', (e: L.LeafletMouseEvent) => dropPin(e.latlng));

  startGeoWatch();
}

/** Bottom sheet: place name, the full observation history at that point
 * (newest first, tap to open in View Mode), and a compact "+" to log a new
 * visit there. Used both for existing marker taps and for a freshly dropped
 * pin (where the history list is simply empty). */
function openLocationSheet(label: string, history: Observation[], params: { lat: number; lng: number; locationName?: string }): void {
  closeSheet?.();

  const backdrop = document.createElement('div');
  backdrop.className = 'sheet-backdrop';
  const sheet = document.createElement('div');
  sheet.className = 'map-sheet';
  sheet.innerHTML = `
    <div class="map-sheet-head">
      <h3>${escapeHtml(label)}</h3>
      <button type="button" class="btn btn-icon map-sheet-close" title="סגירה" aria-label="סגירה">✕</button>
    </div>
    <div class="map-sheet-list"></div>
    <button type="button" class="btn btn-primary btn-block map-sheet-add">${icon('plus')} הוספת תצפית כאן</button>
  `;
  backdrop.appendChild(sheet);
  document.getElementById('modal-root')!.appendChild(backdrop);

  const close = (): void => { backdrop.remove(); if (closeSheet === close) closeSheet = null; };
  closeSheet = close;
  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(); });
  sheet.querySelector('.map-sheet-close')!.addEventListener('click', close);
  sheet.querySelector('.map-sheet-add')!.addEventListener('click', () => { close(); navigate('form', params); });

  const list = sheet.querySelector<HTMLElement>('.map-sheet-list')!;
  if (!history.length) {
    list.innerHTML = '<p class="map-sheet-empty">אין עדיין תצפיות במיקום זה.</p>';
  } else {
    for (const o of history) {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'map-sheet-item';
      const time = new Date(o.dateTime).toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit', year: 'numeric' });
      item.innerHTML = `
        <span class="map-sheet-item-species">${escapeHtml(speciesLabel(o) || 'ללא מין')}</span>
        <span class="map-sheet-item-date">${time}</span>`;
      item.addEventListener('click', () => { close(); navigate('detail', { viewId: o.id }); });
      list.appendChild(item);
    }
  }
}

/** All observations that share a location (by exact trimmed name), newest first.
 * Observations without a location name are treated as their own single-item history. */
function historyFor(key: string): Observation[] {
  return allObservations
    .filter((o) => groupKey(o) === key)
    .sort((a, b) => (a.dateTime < b.dateTime ? 1 : a.dateTime > b.dateTime ? -1 : 0));
}

function dropPin(latlng: L.LatLng): void {
  const params = { lat: +latlng.lat.toFixed(6), lng: +latlng.lng.toFixed(6) };
  dropMarker?.remove();
  dropMarker = L.marker(latlng, { icon: birdIcon }).addTo(map!);
  dropMarker.on('click', () => openLocationSheet('מיקום חדש', [], params));
  openLocationSheet('מיקום חדש', [], params);
}

/** Groups observations that share a location name, so repeat visits to the
 * same named place collapse into one map point. Observations without a name
 * (or with coordinates only) each keep their own point. */
function groupKey(o: Observation): string {
  return o.locationName.trim() || `#${o.id}`;
}

interface LocationGroup { first: Observation; count: number }

function groupByLocation(withCoords: Observation[]): LocationGroup[] {
  const groups = new Map<string, Observation[]>();
  for (const o of withCoords) {
    const key = groupKey(o);
    (groups.get(key) ?? groups.set(key, []).get(key)!).push(o);
  }
  return [...groups.values()].map((list) => {
    const sorted = [...list].sort((a, b) => (a.dateTime < b.dateTime ? -1 : a.dateTime > b.dateTime ? 1 : 0));
    return { first: sorted[0]!, count: list.length };
  });
}

let layersInitialized = false;

export async function activate(): Promise<void> {
  ensureMap();
  setTimeout(() => map?.invalidateSize(), 60);

  if (!layersInitialized) {
    layersInitialized = true;
    await loadLayerState();
    syncLayerCheckboxes();
    applyLayerState();
  }

  markersLayer!.clearLayers();
  allObservations = await listObservations();
  const withCoords = allObservations.filter((o) => o.lat != null && o.lng != null);
  qsEmpty(withCoords.length === 0);

  const bounds: [number, number][] = [];
  for (const { first, count } of groupByLocation(withCoords)) {
    const marker = L.marker([first.lat!, first.lng!], { icon: birdIcon });
    const label = (first.locationName || 'מיקום ללא שם') + (count > 1 ? ` (${count})` : '');
    const key = groupKey(first);
    marker.on('click', () => openLocationSheet(label, historyFor(key), { lat: first.lat!, lng: first.lng!, locationName: first.locationName }));
    marker.addTo(markersLayer!);
    bounds.push([first.lat!, first.lng!]);
  }
  if (bounds.length) map!.fitBounds(bounds, { padding: [40, 40], maxZoom: 14 });
}

/* ---------- GPS "my location" ---------- */

function startGeoWatch(): void {
  if (!navigator.geolocation) return;
  if (geoWatchId != null) navigator.geolocation.clearWatch(geoWatchId);
  geoWatchId = navigator.geolocation.watchPosition(
    (pos) => {
      const latlng: [number, number] = [pos.coords.latitude, pos.coords.longitude];
      if (!myLocationMarker) {
        myLocationMarker = L.circleMarker(latlng, {
          radius: 8, weight: 3, color: '#fff', fillColor: '#2f7dff', fillOpacity: 1,
        }).addTo(map!);
        myLocationMarker.bindTooltip('המיקום שלי', { direction: 'top' });
      } else {
        myLocationMarker.setLatLng(latlng);
      }
    },
    () => { /* location unavailable — the recenter button falls back to a one-shot request */ },
    { enableHighAccuracy: true, maximumAge: 15000 },
  );
}

function onLocateClick(): void {
  if (myLocationMarker) {
    map!.setView(myLocationMarker.getLatLng(), Math.max(map!.getZoom(), 15));
    return;
  }
  if (!navigator.geolocation) { toast('מיקום GPS אינו זמין במכשיר זה', true); return; }
  toast('מאתר מיקום...');
  navigator.geolocation.getCurrentPosition(
    (pos) => map!.setView([pos.coords.latitude, pos.coords.longitude], 15),
    () => toast('לא ניתן לאתר מיקום', true),
    { enableHighAccuracy: true },
  );
}

function qsEmpty(show: boolean): void {
  const e = container.querySelector<HTMLElement>('#map-empty');
  if (e) e.hidden = !show;
}

