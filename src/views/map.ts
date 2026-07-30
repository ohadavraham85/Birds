/* views/map.ts — מסך מפת הנכסים: כל נכס (עמוד/שנאי/לוח/מונה/קו/מפסק/גנרטור)
 * מוצג כסמן צבוע לפי סטטוס עם אייקון סוג הנכס. לחיצה על סמן פותחת חלון תחתון
 * (bottom sheet) עם פרטי הנכס וקיצורי דרך לעריכה/תחזוקה/מחיקה; לחיצה ארוכה על
 * המפה פותחת טופס נכס חדש במיקום שנבחר. שכבת הלוויין כוללת שכבת תוויות מעל
 * צילום האוויר, ותפריט סינון לפי סוג/סטטוס. */

import L from '../lib/leaflet-setup';
import { listAssets } from '../db/repository';
import { toast } from '../lib/ui';
import { escapeHtml } from '../lib/markdown';
import { icon } from '../lib/icons';
import { qs } from '../lib/dom';
import { navigate } from '../main';
import { createMapLayers, loadMapLayerState, setMapLayerPref, applyMapLayerState, type MapLayerState, type MapLayers } from '../lib/map-layers';
import { ASSET_TYPE_META, ASSET_STATUS_META, VOLTAGE_META } from '../lib/asset-meta';
import { ASSET_TYPES, ASSET_STATUSES } from '../types';
import type { Asset, AssetType, AssetStatus } from '../types';

let container: HTMLElement;
let map: L.Map | undefined;
let markersLayer: L.LayerGroup | undefined;
let myLocationMarker: L.CircleMarker | undefined;
let geoWatchId: number | null = null;
let layers: MapLayers;
let allAssets: Asset[] = [];
let closeSheet: (() => void) | null = null;

let layerState: MapLayerState = { satellite: true, roads: false, labels: true };
const activeTypes = new Set<AssetType>(ASSET_TYPES);
const activeStatuses = new Set<AssetStatus>(ASSET_STATUSES);

function assetDivIcon(asset: Asset): L.DivIcon {
  const color = ASSET_STATUS_META[asset.status].color;
  return L.divIcon({
    className: 'asset-div-icon',
    html: `<div class="asset-marker-badge" style="background:${color}">${icon(ASSET_TYPE_META[asset.type].icon)}</div>`,
    iconSize: [30, 30],
    iconAnchor: [15, 15],
    tooltipAnchor: [0, -16],
    popupAnchor: [0, -17],
  });
}

export function init(el: HTMLElement): void {
  container = el;
  container.innerHTML = `
    <div id="map-container"></div>
    <div class="map-hint">לחיצה ארוכה על המפה מוסיפה נכס חדש במיקום · לחיצה על סמן קיים מציגה את פרטיו</div>
    <button id="locate-btn" class="map-locate-btn" type="button" title="התמרכזות על המיקום הנוכחי" aria-label="התמרכזות על המיקום הנוכחי">${icon('target')}</button>
    <button id="filter-toggle-btn" class="map-filter-btn" type="button" title="סינון נכסים" aria-label="סינון נכסים">${icon('filter')}</button>
    <button id="layer-toggle-btn" class="map-layer-btn" type="button" title="שכבות מפה" aria-label="שכבות מפה">${icon('layers')}</button>
    <div class="map-layers-menu" id="map-filter-menu" hidden>
      <strong>סוג נכס</strong>
      ${ASSET_TYPES.map((t) => `<label><input type="checkbox" class="f-type" value="${t}" checked> ${icon(ASSET_TYPE_META[t].icon)} ${ASSET_TYPE_META[t].label}</label>`).join('')}
      <strong>סטטוס</strong>
      ${ASSET_STATUSES.map((s) => `<label><input type="checkbox" class="f-status" value="${s}" checked> ${ASSET_STATUS_META[s].label}</label>`).join('')}
    </div>
    <div class="map-layers-menu" id="map-layers-menu" hidden>
      <label><input type="checkbox" id="ml-satellite"> שכבת לוויין</label>
      <label><input type="checkbox" id="ml-roads"> שכבת כבישים</label>
      <label><input type="checkbox" id="ml-labels"> תוויות גיאוגרפיות</label>
    </div>
    <div class="map-empty" id="map-empty" hidden>אין עדיין נכסים עם מיקום.<br>הוסיפו נכס עם מיקום GPS והוא יופיע כאן.</div>
  `;
  qs(container, '#locate-btn').addEventListener('click', onLocateClick);

  const filterMenu = qs(container, '#map-filter-menu');
  qs(container, '#filter-toggle-btn').addEventListener('click', () => {
    filterMenu.hidden = !filterMenu.hidden;
    if (!filterMenu.hidden) layersMenu.hidden = true;
  });
  filterMenu.addEventListener('change', onFilterChange);

  const layersMenu = qs(container, '#map-layers-menu');
  qs(container, '#layer-toggle-btn').addEventListener('click', () => {
    layersMenu.hidden = !layersMenu.hidden;
    if (!layersMenu.hidden) filterMenu.hidden = true;
  });
  layersMenu.addEventListener('change', (e) => void onLayerCheckboxChange(e));

  document.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    if (!layersMenu.hidden && !t.closest('.map-layer-btn, #map-layers-menu')) layersMenu.hidden = true;
    if (!filterMenu.hidden && !t.closest('.map-filter-btn, #map-filter-menu')) filterMenu.hidden = true;
  });
}

function onFilterChange(e: Event): void {
  const t = e.target as HTMLInputElement;
  if (t.classList.contains('f-type')) {
    if (t.checked) activeTypes.add(t.value as AssetType); else activeTypes.delete(t.value as AssetType);
  } else if (t.classList.contains('f-status')) {
    if (t.checked) activeStatuses.add(t.value as AssetStatus); else activeStatuses.delete(t.value as AssetStatus);
  }
  renderMarkers();
}

async function loadLayerState(): Promise<void> {
  layerState = await loadMapLayerState();
}

function syncLayerCheckboxes(): void {
  qs<HTMLInputElement>(container, '#ml-satellite').checked = layerState.satellite;
  qs<HTMLInputElement>(container, '#ml-roads').checked = layerState.roads;
  qs<HTMLInputElement>(container, '#ml-labels').checked = layerState.labels;
}

function applyLayerState(): void {
  if (!map) return;
  applyMapLayerState(map, layers, layerState);
}

async function onLayerCheckboxChange(e: Event): Promise<void> {
  const target = e.target as HTMLInputElement;
  const key = target.id === 'ml-satellite' ? 'satellite' : target.id === 'ml-roads' ? 'roads' : target.id === 'ml-labels' ? 'labels' : null;
  if (!key) return;
  layerState = { ...layerState, [key]: target.checked };
  await setMapLayerPref(key, target.checked);
  applyLayerState();
}

/** Fixed default extent covering all of Israel's territory. */
const ISRAEL_BOUNDS: [[number, number], [number, number]] = [[29.4, 34.2], [33.4, 35.95]];

function ensureMap(): void {
  if (map) return;
  map = L.map('map-container', { zoomControl: true });
  map.fitBounds(ISRAEL_BOUNDS);
  layers = createMapLayers();
  markersLayer = L.layerGroup().addTo(map);
  map.on('contextmenu', (e: L.LeafletMouseEvent) => dropPin(e.latlng));
}

function assetSheetHtml(asset: Asset): string {
  const t = ASSET_TYPE_META[asset.type];
  const s = ASSET_STATUS_META[asset.status];
  return `
    <div class="map-sheet-head">
      <h3>${icon(t.icon)} ${escapeHtml(asset.name || t.label)}</h3>
      <button type="button" class="btn btn-icon map-sheet-close" title="סגירה" aria-label="סגירה">✕</button>
    </div>
    <div class="asset-sheet-meta">
      <span class="status-badge" style="background:${s.color}">${s.label}</span>
      <span class="hint">${t.label} · ${VOLTAGE_META[asset.voltage].label}${asset.code ? ` · #${escapeHtml(asset.code)}` : ''}</span>
    </div>
    ${asset.address ? `<p class="hint">${icon('pin')} ${escapeHtml(asset.address)}</p>` : ''}
    ${asset.lastMaintenanceDate ? `<p class="hint">${icon('wrench')} תחזוקה אחרונה: ${escapeHtml(asset.lastMaintenanceDate)}</p>` : ''}
    <div class="modal-actions">
      <button type="button" class="btn btn-primary map-sheet-detail">${icon('document')} פרטים ותחזוקה</button>
      <button type="button" class="btn map-sheet-edit">${icon('edit')} עריכה</button>
    </div>`;
}

function openAssetSheet(asset: Asset): void {
  closeSheet?.();
  const backdrop = document.createElement('div');
  backdrop.className = 'sheet-backdrop';
  const sheet = document.createElement('div');
  sheet.className = 'map-sheet';
  sheet.innerHTML = assetSheetHtml(asset);
  backdrop.appendChild(sheet);
  document.getElementById('modal-root')!.appendChild(backdrop);

  const close = (): void => { backdrop.remove(); if (closeSheet === close) closeSheet = null; };
  closeSheet = close;
  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(); });
  sheet.querySelector('.map-sheet-close')!.addEventListener('click', close);
  sheet.querySelector('.map-sheet-detail')!.addEventListener('click', () => { close(); navigate('detail', { viewId: asset.id }); });
  sheet.querySelector('.map-sheet-edit')!.addEventListener('click', () => { close(); navigate('form', { editId: asset.id }); });
}

function newAssetSheetHtml(lat: number, lng: number): string {
  return `
    <div class="map-sheet-head">
      <h3>${icon('plus')} מיקום חדש</h3>
      <button type="button" class="btn btn-icon map-sheet-close" title="סגירה" aria-label="סגירה">✕</button>
    </div>
    <p class="hint">${lat.toFixed(5)}, ${lng.toFixed(5)}</p>
    <button type="button" class="btn btn-primary btn-block map-sheet-add">${icon('plus')} הוספת נכס כאן</button>`;
}

function dropPin(latlng: L.LatLng): void {
  const lat = +latlng.lat.toFixed(6);
  const lng = +latlng.lng.toFixed(6);
  closeSheet?.();
  const backdrop = document.createElement('div');
  backdrop.className = 'sheet-backdrop';
  const sheet = document.createElement('div');
  sheet.className = 'map-sheet';
  sheet.innerHTML = newAssetSheetHtml(lat, lng);
  backdrop.appendChild(sheet);
  document.getElementById('modal-root')!.appendChild(backdrop);
  const close = (): void => { backdrop.remove(); if (closeSheet === close) closeSheet = null; };
  closeSheet = close;
  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(); });
  sheet.querySelector('.map-sheet-close')!.addEventListener('click', close);
  sheet.querySelector('.map-sheet-add')!.addEventListener('click', () => { close(); navigate('form', { lat, lng }); });
}

function renderMarkers(): void {
  if (!markersLayer) return;
  markersLayer.clearLayers();
  const visible = allAssets.filter((a) => a.lat != null && a.lng != null && activeTypes.has(a.type) && activeStatuses.has(a.status));
  qsEmpty(visible.length === 0 && allAssets.length === 0);
  for (const asset of visible) {
    const marker = L.marker([asset.lat!, asset.lng!], { icon: assetDivIcon(asset) });
    marker.bindTooltip(asset.name || ASSET_TYPE_META[asset.type].label, { direction: 'top' });
    marker.on('click', () => openAssetSheet(asset));
    marker.addTo(markersLayer!);
  }
}

let layersInitialized = false;

export async function activate(): Promise<void> {
  ensureMap();
  startGeoWatch();
  setTimeout(() => map?.invalidateSize(), 60);

  if (!layersInitialized) {
    layersInitialized = true;
    await loadLayerState();
    syncLayerCheckboxes();
    applyLayerState();
  }

  allAssets = await listAssets();
  renderMarkers();
}

export function deactivate(): void {
  if (geoWatchId != null) { navigator.geolocation.clearWatch(geoWatchId); geoWatchId = null; }
}

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
