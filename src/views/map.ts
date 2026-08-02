/* views/map.ts — מסך מפת השטח: נקודה אחת לכל מיקום ייחודי (לפי הקואורדינטות
 * של התצפית הראשונה שנרשמה שם), עם תווית קטנה וצמודה של שם המיקום. לחיצה על
 * נקודה פותחת חלון תחתון (bottom sheet) עם שם המקום, רשימת כל התצפיות
 * ההיסטוריות באותו מיקום (מהחדשה לישנה, לחיצה על אחת פותחת אותה בתצוגת
 * צפייה), וכפתור קומפקטי להוספת תצפית חדשה; לחיצה ארוכה על המפה פותחת אותו
 * חלון במיקום חדש שנבחר. שכבת הלוויין במצב היברידי כוללת שכבת תוויות (שמות
 * מקומות/כבישים) מעל צילום האוויר. שכבת GPS מציגה את מיקום המשתמש בזמן
 * אמת, עם כפתור להתמרכזות עליו. */

import L from '../lib/leaflet-setup';
import { listObservations, listTracks, getSetting, setSetting } from '../db/repository';
import { toast } from '../lib/ui';
import { escapeHtml } from '../lib/markdown';
import { speciesLabel, allImages } from '../lib/observation';
import { getImageObjectUrl } from '../lib/media';
import { icon } from '../lib/icons';
import { qs } from '../lib/dom';
import { navigate } from '../main';
import { createMapLayers, loadMapLayerState, setMapLayerPref, applyMapLayerState, type MapLayerState, type MapLayers } from '../lib/map-layers';
import { TRACK_SEGMENT_COLOR } from '../lib/track-preview';
import { addDirectionArrows, addReportPins } from '../lib/track-map';
import type { Observation, ObservationTrack, ObservationImage } from '../types';

let container: HTMLElement;
let map: L.Map | undefined;
let markersLayer: L.LayerGroup | undefined;
let tracksLayer: L.LayerGroup | undefined;
let dropMarker: L.Marker | undefined;
let myLocationMarker: L.CircleMarker | undefined;
let geoWatchId: number | null = null;
let layers: MapLayers;
let allObservations: Observation[] = [];
let closeSheet: (() => void) | null = null;

/** Which base/overlay tiles are showing — persisted per device (like the color
 * theme) so the map reopens the way the user last left it. */
let layerState: MapLayerState = { satellite: true, roads: false, labels: true };
/** Whether the "מסלולי צפרות" (recorded GPS tracks) overlay is showing —
 * kept separate from MapLayerState since it's not shared with location-picker.ts. */
let showTracks = false;

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

/** Round photo-thumbnail marker for a location with at least one photographed
 * observation — falls back to the plain bird badge (above) everywhere else,
 * per the same divIcon shape/anchors so it drops in without shifting the pin.
 * Sized a bit larger than the plain badge (44px vs 30px) so the photo itself
 * is recognizable and easy to tap. */
function thumbIcon(url: string): L.DivIcon {
  return L.divIcon({
    className: 'bird-div-icon',
    html: `<div class="bird-marker-thumb"><img src="${url}" alt=""></div>`,
    iconSize: [44, 44],
    iconAnchor: [22, 22],
    tooltipAnchor: [0, -23],
    popupAnchor: [0, -24],
  });
}

/** First image found scanning history newest-first, together with the
 * observation it belongs to — so a location's marker shows its most
 * recently photographed observation, and the popup can name its species. */
function firstImageFor(history: Observation[]): { img: ObservationImage; obs: Observation } | null {
  for (const o of history) {
    const imgs = allImages(o);
    if (imgs.length) return { img: imgs[0]!, obs: o };
  }
  return null;
}

/** Enlarged photo + location name (+ species, if known) shown when a
 * photo-thumbnail marker is tapped, with a way to still reach the full
 * location history (what tapping a plain badge marker opens directly). */
function buildPhotoPopup(url: string, locationName: string, species: string, onOpenHistory: () => void): HTMLElement {
  const el = document.createElement('div');
  el.className = 'map-photo-popup';
  el.innerHTML = `
    <img src="${url}" alt="">
    <div class="map-photo-popup-loc">${escapeHtml(locationName)}</div>
    ${species ? `<div class="map-photo-popup-species">${escapeHtml(species)}</div>` : ''}
    <button type="button" class="btn btn-sm map-photo-popup-more">כל התצפיות במיקום זה</button>
  `;
  el.querySelector('.map-photo-popup-more')!.addEventListener('click', onOpenHistory);
  return el;
}

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
      <label><input type="checkbox" id="ml-tracks"> שכבת מסלולי צפרות</label>
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
  layerState = await loadMapLayerState();
}

function syncLayerCheckboxes(): void {
  qs<HTMLInputElement>(container, '#ml-satellite').checked = layerState.satellite;
  qs<HTMLInputElement>(container, '#ml-roads').checked = layerState.roads;
  qs<HTMLInputElement>(container, '#ml-labels').checked = layerState.labels;
  qs<HTMLInputElement>(container, '#ml-tracks').checked = showTracks;
}

/** Applies the current layerState to the live map — satellite/street are a
 * mutually-exclusive base, roads and labels are independent overlays that
 * can layer on top of either base. */
function applyLayerState(): void {
  if (!map) return;
  applyMapLayerState(map, layers, layerState);
}

/** The tracks layer's polylines are (re)drawn every activate() regardless of
 * visibility; this only toggles whether that layer group sits on the map —
 * mirrors how roads/labels tile layers are shown/hidden without recreating them. */
function applyTracksVisibility(): void {
  if (!map || !tracksLayer) return;
  if (showTracks) tracksLayer.addTo(map); else map.removeLayer(tracksLayer);
}

async function onLayerCheckboxChange(e: Event): Promise<void> {
  const target = e.target as HTMLInputElement;
  if (target.id === 'ml-tracks') {
    showTracks = target.checked;
    await setSetting('mapLayerTracks', showTracks);
    applyTracksVisibility();
    return;
  }
  const key = target.id === 'ml-satellite' ? 'satellite' : target.id === 'ml-roads' ? 'roads' : target.id === 'ml-labels' ? 'labels' : null;
  if (!key) return;
  layerState = { ...layerState, [key]: target.checked };
  await setMapLayerPref(key, target.checked);
  applyLayerState();
}

function drawTrack(t: ObservationTrack): void {
  for (const seg of t.segments) {
    if (seg.points.length < 2) continue;
    L.polyline(seg.points.map((p) => [p.lat, p.lng]), {
      color: TRACK_SEGMENT_COLOR[seg.kind], weight: 4, opacity: 0.85,
    }).addTo(tracksLayer!);
    if (seg.kind === 'walk') addDirectionArrows(tracksLayer!, seg);
  }
  if (t.reportPins?.length) addReportPins(tracksLayer!, t.reportPins);
}

/** Fixed default extent covering all of Israel's territory — the map always
 * opens here rather than auto-fitting to wherever the user's own pins
 * happen to be, so its initial view stays predictable regardless of what's
 * been logged so far. */
const ISRAEL_BOUNDS: [[number, number], [number, number]] = [[29.4, 34.2], [33.4, 35.95]];

function ensureMap(): void {
  if (map) return;
  map = L.map('map-container', { zoomControl: true });
  map.fitBounds(ISRAEL_BOUNDS);
  layers = createMapLayers();
  markersLayer = L.layerGroup().addTo(map);
  tracksLayer = L.layerGroup();

  // long-press (contextmenu on touch) drops a pin at a new location
  map.on('contextmenu', (e: L.LeafletMouseEvent) => dropPin(e.latlng));
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
  startGeoWatch();
  setTimeout(() => map?.invalidateSize(), 60);

  if (!layersInitialized) {
    layersInitialized = true;
    await loadLayerState();
    showTracks = await getSetting('mapLayerTracks', false);
    syncLayerCheckboxes();
    applyLayerState();
    applyTracksVisibility();
  }

  markersLayer!.clearLayers();
  allObservations = await listObservations();
  const withCoords = allObservations.filter((o) => o.lat != null && o.lng != null);
  qsEmpty(withCoords.length === 0);

  for (const { first, count } of groupByLocation(withCoords)) {
    const marker = L.marker([first.lat!, first.lng!], { icon: birdIcon });
    const label = (first.locationName || 'מיקום ללא שם') + (count > 1 ? ` (${count})` : '');
    const key = groupKey(first);
    const history = historyFor(key);
    const openHistory = (): void => openLocationSheet(label, history, { lat: first.lat!, lng: first.lng!, locationName: first.locationName });
    // A marker with a bound popup already opens it on click, on its own,
    // as a Leaflet default — calling openPopup() explicitly here too would
    // race that default handler and immediately close what it just opened.
    // So a photo marker (bound below, once its thumbnail is ready) is left
    // alone; only a plain badge marker (never bound) needs this to do
    // anything, and only for it does the location sheet make sense anyway.
    let hasPhoto = false;
    marker.on('click', () => { if (!hasPhoto) openHistory(); });
    marker.addTo(markersLayer!);
    const found = firstImageFor(history);
    if (found) {
      void getImageObjectUrl(found.img, found.obs.id).then((url) => {
        if (!url) return;
        marker.setIcon(thumbIcon(url));
        hasPhoto = true;
        marker.bindPopup(buildPhotoPopup(url, first.locationName || 'מיקום ללא שם', speciesLabel(found.obs), () => { marker.closePopup(); openHistory(); }));
      });
    }
  }

  tracksLayer!.clearLayers();
  for (const t of await listTracks()) drawTrack(t);
}

/** Stops the continuous "my location" GPS watch the moment the user leaves
 * this tab — without this, watchPosition(enableHighAccuracy: true) would
 * keep polling the GPS radio for the rest of the session even while
 * browsing other screens, needlessly draining battery and generating heat. */
export function deactivate(): void {
  if (geoWatchId != null) { navigator.geolocation.clearWatch(geoWatchId); geoWatchId = null; }
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

