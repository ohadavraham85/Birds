/* lib/location-picker.ts — a modal Leaflet map for picking coordinates.
 * The user can pan/zoom, click the map or drag the marker, and confirm.
 * Optionally locates the device first. Returns the chosen {lat,lng} or null. */

import L from './leaflet-setup';
import { icon } from './icons';

export interface LatLng { lat: number; lng: number }

const ISRAEL_CENTER: [number, number] = [31.5, 35.0];

export function pickLocation(initial: LatLng | null): Promise<LatLng | null> {
  return new Promise((resolve) => {
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    backdrop.innerHTML = `
      <div class="modal map-picker">
        <h3>בחירת מיקום על המפה</h3>
        <p class="picker-hint">גררו את הסיכה או לחצו על המפה. אפשר להזיז ולהתקרב.</p>
        <div class="picker-map" id="picker-map"></div>
        <div class="picker-coords" id="picker-coords" dir="ltr"></div>
        <div class="modal-actions">
          <button class="btn btn-primary" id="picker-ok">✓ בחירת מיקום</button>
          <button class="btn" id="picker-locate">${icon('target')} המיקום שלי</button>
          <button class="btn" id="picker-cancel">ביטול</button>
        </div>
      </div>`;
    document.getElementById('modal-root')!.appendChild(backdrop);

    const close = (result: LatLng | null): void => {
      map.remove();
      backdrop.remove();
      resolve(result);
    };

    const coordsEl = backdrop.querySelector<HTMLElement>('#picker-coords')!;
    const start: [number, number] = initial ? [initial.lat, initial.lng] : ISRAEL_CENTER;

    const map = L.map(backdrop.querySelector<HTMLElement>('#picker-map')!, { zoomControl: true })
      .setView(start, initial ? 15 : 8);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap',
    }).addTo(map);

    const marker = L.marker(start, { draggable: true }).addTo(map);
    setTimeout(() => map.invalidateSize(), 80);

    const updateCoords = (ll: L.LatLng): void => {
      coordsEl.textContent = `${ll.lat.toFixed(6)}, ${ll.lng.toFixed(6)}`;
    };
    updateCoords(marker.getLatLng());

    marker.on('drag', () => updateCoords(marker.getLatLng()));
    map.on('click', (e: L.LeafletMouseEvent) => {
      marker.setLatLng(e.latlng);
      updateCoords(e.latlng);
    });

    backdrop.querySelector('#picker-locate')!.addEventListener('click', () => {
      if (!navigator.geolocation) return;
      coordsEl.textContent = 'מאתר מיקום...';
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const ll = L.latLng(pos.coords.latitude, pos.coords.longitude);
          map.setView(ll, 16);
          marker.setLatLng(ll);
          updateCoords(ll);
        },
        () => { updateCoords(marker.getLatLng()); },
        { enableHighAccuracy: true, timeout: 12000 },
      );
    });

    backdrop.querySelector('#picker-ok')!.addEventListener('click', () => {
      const ll = marker.getLatLng();
      close({ lat: +ll.lat.toFixed(6), lng: +ll.lng.toFixed(6) });
    });
    backdrop.querySelector('#picker-cancel')!.addEventListener('click', () => close(null));
    backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(null); });
  });
}
