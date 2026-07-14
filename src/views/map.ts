/* views/map.ts — מסך מפת השטח: סיכות תצפיות לפי קואורדינטות GPS. */

import L from '../lib/leaflet-setup';
import { listObservations } from '../db/repository';
import { fmtDateTime } from '../lib/ui';
import { escapeHtml } from '../lib/markdown';
import { speciesLabel } from '../lib/observation';
import { navigate } from '../main';

let container: HTMLElement;
let map: L.Map | undefined;
let markersLayer: L.LayerGroup | undefined;
let dropMarker: L.Marker | undefined;

export function init(el: HTMLElement): void {
  container = el;
  container.innerHTML = `
    <div id="map-container"></div>
    <div class="map-hint">לחיצה ארוכה על המפה מוסיפה תצפית במיקום שנבחר</div>
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
      <div class="species">${escapeHtml(speciesLabel(o))}</div>
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
