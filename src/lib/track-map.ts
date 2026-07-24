/* lib/track-map.ts — renders a small, real embedded Leaflet map (same
 * satellite + labels tiles as the main map view) for a single observation's
 * recorded route, so it reads as an actual place instead of an abstract
 * line sketch. Requires network access to load tiles, same as the main map
 * view already does — offline, the route line still draws but the
 * background tiles won't load. */

import L from './leaflet-setup';
import { createMapLayers } from './map-layers';
import { TRACK_SEGMENT_COLOR } from './track-preview';
import { haversineMeters, bearingDegrees } from './gps-track';
import type { ObservationTrack, TrackSegment } from '../types';

/** Minimum ground distance between consecutive direction arrows along a
 * walked segment — close enough to read the route's shape, far enough not
 * to turn a dense GPS trace into a solid arrowhead smear. */
const ARROW_SPACING_M = 35;

/** Shared with the main map view's "מסלולי צפרות" overview layer, so both
 * places show which way each walked leg went, not just where it was. */
export function addDirectionArrows(target: L.Map | L.LayerGroup, seg: TrackSegment): void {
  const pts = seg.points;
  if (pts.length < 2) return;
  let sinceLast = ARROW_SPACING_M; // draw one near the start of the segment too
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!;
    const b = pts[i]!;
    sinceLast += haversineMeters(a, b);
    if (sinceLast < ARROW_SPACING_M) continue;
    sinceLast = 0;
    const bearing = bearingDegrees(a, b);
    const mid: [number, number] = [(a.lat + b.lat) / 2, (a.lng + b.lng) / 2];
    const icon = L.divIcon({
      className: 'track-arrow-icon',
      html: `<svg viewBox="0 0 24 24" style="transform:rotate(${bearing}deg)"><path d="M12 2 L18 15 L12 11 L6 15 Z" fill="${TRACK_SEGMENT_COLOR[seg.kind]}" stroke="#fff" stroke-width="1"/></svg>`,
      iconSize: [16, 16],
      iconAnchor: [8, 8],
    });
    L.marker(mid, { icon, interactive: false, keyboard: false }).addTo(target);
  }
}

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
    // Direction arrows only make sense while actually moving — a 'stop'
    // segment is the observer standing still, with no direction to show.
    if (seg.kind === 'walk') addDirectionArrows(map, seg);
  }

  const allPoints = track.points.map((p): [number, number] => [p.lat, p.lng]);
  if (allPoints.length) map.fitBounds(L.latLngBounds(allPoints), { padding: [20, 20] });

  setTimeout(() => map.invalidateSize(), 60);
}
