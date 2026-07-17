/* views/map.ts — מסך מפת השטח: נקודה אחת לכל מיקום ייחודי (לפי הקואורדינטות
 * של התצפית הראשונה שנרשמה שם), עם תווית שם המיקום קבועה על המפה. לחיצה על
 * נקודה קיימת — כמו לחיצה ארוכה על המפה — פותחת טופס תצפית חדשה באותן
 * הקואורדינטות בדיוק. */

import L from '../lib/leaflet-setup';
import { listObservations } from '../db/repository';
import { escapeHtml } from '../lib/markdown';
import { navigate } from '../main';
import type { Observation } from '../types';

let container: HTMLElement;
let map: L.Map | undefined;
let markersLayer: L.LayerGroup | undefined;
let dropMarker: L.Marker | undefined;

export function init(el: HTMLElement): void {
  container = el;
  container.innerHTML = `
    <div id="map-container"></div>
    <div class="map-hint">לחיצה ארוכה על המפה מוסיפה תצפית במיקום חדש · לחיצה על נקודה קיימת מוסיפה תצפית באותו מיקום</div>
    <div class="map-empty" id="map-empty" hidden>אין עדיין תצפיות עם קואורדינטות.<br>הוסיפו תצפית עם מיקום GPS והיא תופיע כאן.</div>
  `;
}

function ensureMap(): void {
  if (map) return;
  map = L.map('map-container', { zoomControl: true }).setView([31.5, 35.0], 8);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; OpenStreetMap',
  }).addTo(map);
  markersLayer = L.layerGroup().addTo(map);

  // long-press (contextmenu on touch) drops a pin; clicking it opens the form
  map.on('contextmenu', (e: L.LeafletMouseEvent) => dropPin(e.latlng));
}

function dropPin(latlng: L.LatLng): void {
  const params = { lat: +latlng.lat.toFixed(6), lng: +latlng.lng.toFixed(6) };
  dropMarker?.remove();
  dropMarker = L.marker(latlng).addTo(map!);
  dropMarker.bindTooltip('לחצו על הסיכה להוספת תצפית כאן', { permanent: true, direction: 'top', offset: [0, -36] }).openTooltip();
  dropMarker.on('click', () => navigate('form', params));
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
    const marker = L.marker([first.lat!, first.lng!]);
    const label = first.locationName || 'מיקום ללא שם';
    marker.bindTooltip(escapeHtml(label) + (count > 1 ? ` (${count})` : ''), {
      permanent: true, direction: 'top', offset: [0, -30], className: 'map-loc-label',
    });
    marker.on('click', () => navigate('form', { lat: first.lat!, lng: first.lng!, locationName: first.locationName }));
    marker.addTo(markersLayer!);
    bounds.push([first.lat!, first.lng!]);
  }
  if (bounds.length) map!.fitBounds(bounds, { padding: [40, 40], maxZoom: 14 });
}

function qsEmpty(show: boolean): void {
  const e = container.querySelector<HTMLElement>('#map-empty');
  if (e) e.hidden = !show;
}
