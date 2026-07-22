/* lib/map-layers.ts — base/overlay tile layer definitions shared by the full
 * map view and the location-picker modal, so both render identical
 * satellite/roads/labels layers from one persisted, device-local preference
 * (like the color theme). */

import L from './leaflet-setup';
import { getSetting, setSetting } from '../db/repository';

export interface MapLayerState { satellite: boolean; roads: boolean; labels: boolean }

export interface MapLayers { street: L.TileLayer; satellite: L.TileLayer; roads: L.TileLayer; labels: L.TileLayer }

export function createMapLayers(): MapLayers {
  const street = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; OpenStreetMap',
  });
  const satellite = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
    maxZoom: 19,
    zIndex: 1,
    attribution: 'Tiles &copy; Esri',
  });
  const roads = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}', {
    maxZoom: 19,
    zIndex: 2,
  });
  const labels = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}', {
    maxZoom: 19,
    zIndex: 3,
  });
  return { street, satellite, roads, labels };
}

export async function loadMapLayerState(): Promise<MapLayerState> {
  return {
    satellite: await getSetting('mapLayerSatellite', true),
    roads: await getSetting('mapLayerRoads', false),
    labels: await getSetting('mapLayerLabels', true),
  };
}

export async function setMapLayerPref(key: keyof MapLayerState, value: boolean): Promise<void> {
  const settingKey = key === 'satellite' ? 'mapLayerSatellite' : key === 'roads' ? 'mapLayerRoads' : 'mapLayerLabels';
  await setSetting(settingKey, value);
}

/** Base (satellite/street, mutually exclusive) + overlay (roads, labels) layers
 * applied to a live map per the given state. */
export function applyMapLayerState(map: L.Map, layers: MapLayers, state: MapLayerState): void {
  if (state.satellite) { map.removeLayer(layers.street); layers.satellite.addTo(map); }
  else { map.removeLayer(layers.satellite); layers.street.addTo(map); }
  if (state.roads) layers.roads.addTo(map); else map.removeLayer(layers.roads);
  if (state.labels) layers.labels.addTo(map); else map.removeLayer(layers.labels);
}
