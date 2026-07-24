/* lib/track-map.ts — renders a small, real embedded Leaflet map (same
 * satellite + labels tiles as the main map view) for a single observation's
 * recorded route, so it reads as an actual place instead of an abstract
 * line sketch. Requires network access to load tiles, same as the main map
 * view already does — offline, the route line still draws but the
 * background tiles won't load. */

import L from './leaflet-setup';
import { createMapLayers } from './map-layers';
import { TRACK_SEGMENT_COLOR } from './track-preview';
import type { ObservationTrack } from '../types';

export function renderTrackMap(container: HTMLElement, track: ObservationTrack): void {
  const map = L.map(container, {
    zoomControl: false,
    attributionControl: false,
    scrollWheelZoom: false,
    doubleClickZoom: false,
  });
  const layers = createMapLayers();
  layers.satellite.addTo(map);
  layers.labels.addTo(map);

  for (const seg of track.segments) {
    if (seg.points.length < 2) continue;
    L.polyline(seg.points.map((p) => [p.lat, p.lng]), {
      color: TRACK_SEGMENT_COLOR[seg.kind], weight: 4, opacity: 0.9,
    }).addTo(map);
  }

  const allPoints = track.points.map((p): [number, number] => [p.lat, p.lng]);
  if (allPoints.length) map.fitBounds(L.latLngBounds(allPoints), { padding: [20, 20] });

  setTimeout(() => map.invalidateSize(), 60);
}
