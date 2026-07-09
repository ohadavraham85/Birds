/* views/map.js — מסך מפת השטח (סעיף 7.2): סיכות תצפיות על מפה דינמית
 * לפי קואורדינטות GPS, עם חלונית פרטים בלחיצה. */

import { listObservations } from '../db.js';
import { fmtDateTime } from '../ui.js';
import { escapeHtml } from '../markdown.js';

let container = null;
let map = null;
let markersLayer = null;

export function init(el) {
  container = el;
  container.innerHTML = `
    <div id="map-container"></div>
    <div class="map-empty" id="map-empty" hidden>אין עדיין תצפיות עם קואורדינטות.<br>הוסיפו תצפית עם מיקום GPS והיא תופיע כאן.</div>
  `;
}

function ensureMap() {
  if (map) return;
  map = L.map('map-container', { zoomControl: true }).setView([31.5, 35.0], 8); // מרכז ישראל
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; OpenStreetMap',
  }).addTo(map);
  markersLayer = L.layerGroup().addTo(map);
}

export async function activate() {
  ensureMap();
  // the container was hidden — Leaflet needs a size recalculation
  setTimeout(() => map.invalidateSize(), 60);

  markersLayer.clearLayers();
  const all = await listObservations();
  const withCoords = all.filter((o) => o.lat != null && o.lng != null && !isNaN(o.lat) && !isNaN(o.lng));
  document.getElementById('map-empty').hidden = withCoords.length > 0;

  const bounds = [];
  for (const o of withCoords) {
    const marker = L.marker([o.lat, o.lng]);
    marker.bindPopup(`
      <div class="species">${escapeHtml(o.species)}${o.quantity > 1 ? ` × ${o.quantity}` : ''}</div>
      <div>${fmtDateTime(o.dateTime)}</div>
      ${o.locationName ? `<div>📍 ${escapeHtml(o.locationName)}</div>` : ''}
      ${o.project ? `<div>🏷️ ${escapeHtml(o.project)}</div>` : ''}
      ${o.notes ? `<div style="margin-top:4px;max-width:220px;white-space:pre-wrap">${escapeHtml(o.notes.slice(0, 180))}${o.notes.length > 180 ? '…' : ''}</div>` : ''}
    `);
    marker.addTo(markersLayer);
    bounds.push([o.lat, o.lng]);
  }
  if (bounds.length) {
    map.fitBounds(bounds, { padding: [40, 40], maxZoom: 14 });
  }
}
