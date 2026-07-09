/* views/map.ts — מסך מפת השטח: סיכות תצפיות לפי קואורדינטות GPS. */

import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import markerIcon from 'leaflet/dist/images/marker-icon.png';
import markerIcon2x from 'leaflet/dist/images/marker-icon-2x.png';
import markerShadow from 'leaflet/dist/images/marker-shadow.png';
import { listObservations } from '../db/repository';
import { fmtDateTime } from '../lib/ui';
import { escapeHtml } from '../lib/markdown';

// Fix Leaflet's default marker asset URLs for bundlers.
const DefaultIcon = L.icon({
  iconUrl: markerIcon,
  iconRetinaUrl: markerIcon2x,
  shadowUrl: markerShadow,
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
});
L.Marker.prototype.options.icon = DefaultIcon;

let container: HTMLElement;
let map: L.Map | undefined;
let markersLayer: L.LayerGroup | undefined;

export function init(el: HTMLElement): void {
  container = el;
  container.innerHTML = `
    <div id="map-container"></div>
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
}

export async function activate(): Promise<void> {
  ensureMap();
  setTimeout(() => map?.invalidateSize(), 60);

  markersLayer!.clearLayers();
  const all = await listObservations();
  const withCoords = all.filter((o) => o.lat != null && o.lng != null);
  qsEmpty(withCoords.length === 0);

  const bounds: [number, number][] = [];
  for (const o of withCoords) {
    const marker = L.marker([o.lat!, o.lng!]);
    marker.bindPopup(`
      <div class="species">${escapeHtml(o.species)}${o.quantity > 1 ? ` × ${o.quantity}` : ''}</div>
      <div>${fmtDateTime(o.dateTime)}</div>
      ${o.locationName ? `<div>📍 ${escapeHtml(o.locationName)}</div>` : ''}
      ${o.project ? `<div>🏷️ ${escapeHtml(o.project)}</div>` : ''}
      ${o.notes ? `<div style="margin-top:4px;max-width:220px;white-space:pre-wrap">${escapeHtml(o.notes.slice(0, 180))}${o.notes.length > 180 ? '…' : ''}</div>` : ''}
    `);
    marker.addTo(markersLayer!);
    bounds.push([o.lat!, o.lng!]);
  }
  if (bounds.length) map!.fitBounds(bounds, { padding: [40, 40], maxZoom: 14 });
}

function qsEmpty(show: boolean): void {
  const e = container.querySelector<HTMLElement>('#map-empty');
  if (e) e.hidden = !show;
}
