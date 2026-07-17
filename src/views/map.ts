/* views/map.ts — מסך מפת השטח: נקודה אחת לכל מיקום ייחודי (לפי הקואורדינטות
 * של התצפית הראשונה שנרשמה שם). לחיצה על נקודה פותחת חלונית מידע קומפקטית
 * (שם המקום + כפתור "הוספת תצפית כאן"); לחיצה ארוכה על המפה פותחת אותה
 * חלונית במיקום חדש שנבחר. שכבת GPS מציגה את מיקום המשתמש בזמן אמת, עם
 * כפתור להתמרכזות עליו. */

import L from '../lib/leaflet-setup';
import { listObservations } from '../db/repository';
import { toast } from '../lib/ui';
import { qs } from '../lib/dom';
import { navigate } from '../main';
import type { Observation } from '../types';

let container: HTMLElement;
let map: L.Map | undefined;
let markersLayer: L.LayerGroup | undefined;
let dropMarker: L.Marker | undefined;
let myLocationMarker: L.CircleMarker | undefined;
let geoWatchId: number | null = null;

/** Round green badge with a bird glyph, replacing Leaflet's default pin. */
const birdIcon = L.divIcon({
  className: 'bird-div-icon',
  html: '<div class="bird-marker-badge">🐦</div>',
  iconSize: [30, 30],
  iconAnchor: [15, 15],
  popupAnchor: [0, -17],
});

export function init(el: HTMLElement): void {
  container = el;
  container.innerHTML = `
    <div id="map-container"></div>
    <div class="map-hint">לחיצה ארוכה על המפה מוסיפה תצפית במיקום חדש · לחיצה על נקודה קיימת מציגה אפשרות להוספת תצפית באותו מיקום</div>
    <button id="locate-btn" class="map-locate-btn" type="button" title="התמרכזות על המיקום הנוכחי" aria-label="התמרכזות על המיקום הנוכחי">🎯</button>
    <div class="map-empty" id="map-empty" hidden>אין עדיין תצפיות עם קואורדינטות.<br>הוסיפו תצפית עם מיקום GPS והיא תופיע כאן.</div>
  `;
  qs(container, '#locate-btn').addEventListener('click', onLocateClick);
}

function ensureMap(): void {
  if (map) return;
  map = L.map('map-container', { zoomControl: true }).setView([31.5, 35.0], 8);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; OpenStreetMap',
  }).addTo(map);
  markersLayer = L.layerGroup().addTo(map);

  // long-press (contextmenu on touch) drops a pin at a new location
  map.on('contextmenu', (e: L.LeafletMouseEvent) => dropPin(e.latlng));

  startGeoWatch();
}

/** A small pill: place name + a "+" button to start a new observation there. */
function buildAddPopup(label: string, params: { lat: number; lng: number; locationName?: string }): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'map-pop';
  const span = document.createElement('span');
  span.className = 'map-pop-name';
  span.textContent = label;
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'map-pop-add';
  btn.title = 'הוספת תצפית כאן';
  btn.textContent = '➕';
  btn.addEventListener('click', (e) => { e.stopPropagation(); navigate('form', params); });
  wrap.append(span, btn);
  return wrap;
}

function dropPin(latlng: L.LatLng): void {
  const params = { lat: +latlng.lat.toFixed(6), lng: +latlng.lng.toFixed(6) };
  dropMarker?.remove();
  dropMarker = L.marker(latlng, { icon: birdIcon }).addTo(map!);
  dropMarker
    .bindPopup(buildAddPopup('מיקום חדש', params), { closeButton: false, className: 'map-pop-wrap', maxWidth: 220 })
    .openPopup();
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

export async function activate(): Promise<void> {
  ensureMap();
  setTimeout(() => map?.invalidateSize(), 60);

  markersLayer!.clearLayers();
  const all = await listObservations();
  const withCoords = all.filter((o) => o.lat != null && o.lng != null);
  qsEmpty(withCoords.length === 0);

  const bounds: [number, number][] = [];
  for (const { first, count } of groupByLocation(withCoords)) {
    const marker = L.marker([first.lat!, first.lng!], { icon: birdIcon });
    const label = (first.locationName || 'מיקום ללא שם') + (count > 1 ? ` (${count})` : '');
    marker.bindPopup(
      buildAddPopup(label, { lat: first.lat!, lng: first.lng!, locationName: first.locationName }),
      { closeButton: false, className: 'map-pop-wrap', maxWidth: 240 },
    );
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
