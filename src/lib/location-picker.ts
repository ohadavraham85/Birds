/* lib/location-picker.ts — a modal Leaflet map for picking coordinates, using
 * the exact same base/overlay layer stack (satellite/roads/labels) as the
 * full map view, via lib/map-layers.ts. Two modes:
 *  - editable (default): pan/zoom, drag the marker or click the map, confirm.
 *  - readonly: viewing a saved location's fixed coordinates — no dragging,
 *    no click-to-move, just the pin and a close button. Coordinates are
 *    intentionally never displayed as numbers; the pin itself is the UI. */

import L from './leaflet-setup';
import { icon } from './icons';
import { createMapLayers, loadMapLayerState, setMapLayerPref, applyMapLayerState, type MapLayerState } from './map-layers';
import { escapeHtml } from './markdown';

export interface LatLng { lat: number; lng: number }
/** `label`, when given, is appended to the modal's heading (e.g. an
 * observation's location name) — so the map is clearly identified as "this
 * spot" rather than a generic picker, useful when opening it repeatedly from
 * a list of many locations. */
export interface PickLocationOptions { readonly?: boolean; label?: string }

const ISRAEL_CENTER: [number, number] = [31.5, 35.0];

export function pickLocation(initial: LatLng | null, opts: PickLocationOptions = {}): Promise<LatLng | null> {
  return new Promise((resolve) => {
    const readonly = !!opts.readonly;
    const heading = (readonly ? 'מיקום שמור' : 'בחירת מיקום על המפה') + (opts.label ? ` — ${escapeHtml(opts.label)}` : '');
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    backdrop.innerHTML = `
      <div class="modal map-picker">
        <h3>${heading}</h3>
        <p class="picker-hint">${readonly ? 'זהו המיקום השמור. כדי לשנות יש לבחור מיקום חדש.' : 'גררו את הסיכה או לחצו על המפה. אפשר להזיז ולהתקרב.'}</p>
        <div class="picker-map-wrap">
          <div class="picker-map" id="picker-map"></div>
          <button type="button" class="map-layer-btn" id="picker-layer-btn" title="שכבות מפה" aria-label="שכבות מפה">${icon('layers')}</button>
          <div class="map-layers-menu" id="picker-layers-menu" hidden>
            <label><input type="checkbox" id="pl-satellite"> שכבת לוויין</label>
            <label><input type="checkbox" id="pl-roads"> שכבת כבישים</label>
            <label><input type="checkbox" id="pl-labels"> תוויות גיאוגרפיות</label>
          </div>
        </div>
        <div class="modal-actions">
          ${readonly ? '' : `
            <button class="btn btn-primary" id="picker-ok">✓ בחירת מיקום</button>
            <button class="btn" id="picker-locate">${icon('target')} המיקום שלי</button>`}
          <button class="btn" id="picker-cancel">${readonly ? 'סגירה' : 'ביטול'}</button>
        </div>
      </div>`;
    document.getElementById('modal-root')!.appendChild(backdrop);

    const close = (result: LatLng | null): void => {
      map.remove();
      backdrop.remove();
      resolve(result);
    };

    const start: [number, number] = initial ? [initial.lat, initial.lng] : ISRAEL_CENTER;

    const map = L.map(backdrop.querySelector<HTMLElement>('#picker-map')!, { zoomControl: true })
      .setView(start, initial ? 15 : 8);

    const layers = createMapLayers();
    let layerState: MapLayerState = { satellite: true, roads: false, labels: true };
    const syncLayerCheckboxes = (): void => {
      backdrop.querySelector<HTMLInputElement>('#pl-satellite')!.checked = layerState.satellite;
      backdrop.querySelector<HTMLInputElement>('#pl-roads')!.checked = layerState.roads;
      backdrop.querySelector<HTMLInputElement>('#pl-labels')!.checked = layerState.labels;
    };
    void loadMapLayerState().then((s) => {
      layerState = s;
      syncLayerCheckboxes();
      applyMapLayerState(map, layers, layerState);
    });

    const layersMenu = backdrop.querySelector<HTMLElement>('#picker-layers-menu')!;
    backdrop.querySelector('#picker-layer-btn')!.addEventListener('click', () => { layersMenu.hidden = !layersMenu.hidden; });
    layersMenu.addEventListener('change', (e) => {
      const t = e.target as HTMLInputElement;
      const key = t.id === 'pl-satellite' ? 'satellite' : t.id === 'pl-roads' ? 'roads' : 'labels';
      layerState = { ...layerState, [key]: t.checked };
      void setMapLayerPref(key, t.checked);
      applyMapLayerState(map, layers, layerState);
    });

    const marker = L.marker(start, { draggable: !readonly }).addTo(map);
    setTimeout(() => map.invalidateSize(), 80);

    if (!readonly) {
      map.on('click', (e: L.LeafletMouseEvent) => marker.setLatLng(e.latlng));

      backdrop.querySelector('#picker-locate')!.addEventListener('click', () => {
        if (!navigator.geolocation) return;
        navigator.geolocation.getCurrentPosition(
          (pos) => {
            const ll = L.latLng(pos.coords.latitude, pos.coords.longitude);
            map.setView(ll, 16);
            marker.setLatLng(ll);
          },
          () => {},
          { enableHighAccuracy: true, timeout: 12000 },
        );
      });

      backdrop.querySelector('#picker-ok')!.addEventListener('click', () => {
        const ll = marker.getLatLng();
        close({ lat: +ll.lat.toFixed(6), lng: +ll.lng.toFixed(6) });
      });
    }

    backdrop.querySelector('#picker-cancel')!.addEventListener('click', () => close(null));
    backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(null); });
  });
}
