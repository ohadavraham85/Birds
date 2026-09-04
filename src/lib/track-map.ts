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
import { escapeHtml } from './markdown';
import type { ObservationTrack, TrackSegment, TrackReportPin, TrackPoint } from '../types';

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

const REPORT_PIN_COLOR: Record<TrackReportPin['kind'], string> = { new: '#8e44ad', add: '#e67e22' };

/** One marker per species reported live during recording (see form.ts),
 * placed at the exact position it happened — a distinct color/label for a
 * species' first report vs. a later "+1" on the same species. */
export function addReportPins(target: L.Map | L.LayerGroup, pins: TrackReportPin[]): void {
  for (const pin of pins) {
    const color = REPORT_PIN_COLOR[pin.kind];
    const label = pin.kind === 'add' ? `+1 ${pin.species}` : pin.species;
    const icon = L.divIcon({
      className: 'track-report-pin-icon',
      html: `<span style="background:${color}"></span>`,
      iconSize: [12, 12],
      iconAnchor: [6, 6],
    });
    L.marker([pin.lat, pin.lng], { icon, keyboard: false })
      .bindTooltip(escapeHtml(label), { direction: 'top', offset: [0, -6], permanent: true, className: 'track-report-pin-label' })
      .addTo(target);
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

  if (track.reportPins?.length) addReportPins(map, track.reportPins);

  const allPoints = track.points.map((p): [number, number] => [p.lat, p.lng]);
  if (allPoints.length) map.fitBounds(L.latLngBounds(allPoints), { padding: [20, 20] });

  setTimeout(() => map.invalidateSize(), 60);
}

export interface LiveTrackMap {
  /** Redraws the route so far and moves the direction marker to the latest
   * fix — call on every new point (or just every tick; a no-op re-render of
   * the same points is cheap). No-ops until at least one point exists. */
  update(points: TrackPoint[]): void;
  /** Tears down the Leaflet instance — call when recording stops, so a
   * second recording in the same form session gets a clean map instead of
   * stacking tile layers on top of a stale one. */
  destroy(): void;
}

/** A small live-updating map for "where am I and which way am I facing"
 * while a GPS track is actively being recorded — distinct from
 * renderTrackMap() above, which draws a finished track's full route once.
 * Re-centers on the current position on every update, so it reads as
 * "following you" rather than a route you have to manually pan to find. */
export function createLiveTrackMap(container: HTMLElement): LiveTrackMap {
  const map = L.map(container, { zoomControl: false, attributionControl: false });
  const layers = createMapLayers();
  layers.satellite.addTo(map);
  layers.labels.addTo(map);

  let polyline: L.Polyline | null = null;
  let marker: L.Marker | null = null;
  let centered = false;

  function update(points: TrackPoint[]): void {
    if (!points.length) return;
    const latlngs = points.map((p): [number, number] => [p.lat, p.lng]);
    if (polyline) polyline.setLatLngs(latlngs);
    else polyline = L.polyline(latlngs, { color: TRACK_SEGMENT_COLOR.walk, weight: 4, opacity: 0.9 }).addTo(map);

    const last = points[points.length - 1]!;
    const prev = points.length > 1 ? points[points.length - 2]! : null;
    // No second fix yet to derive a heading from — point the arrow north
    // rather than picking an arbitrary direction.
    const bearing = prev ? bearingDegrees(prev, last) : 0;
    const arrowIcon = L.divIcon({
      className: 'track-live-arrow-icon',
      html: `<svg viewBox="0 0 24 24" style="transform:rotate(${bearing}deg)"><path d="M12 1 L19 16 L12 12 L5 16 Z" fill="#1565c0" stroke="#fff" stroke-width="1.5"/></svg>`,
      iconSize: [28, 28],
      iconAnchor: [14, 14],
    });
    if (marker) { marker.setLatLng([last.lat, last.lng]); marker.setIcon(arrowIcon); }
    else marker = L.marker([last.lat, last.lng], { icon: arrowIcon, keyboard: false, interactive: false }).addTo(map);

    map.setView([last.lat, last.lng], centered ? map.getZoom() : 17, { animate: centered });
    centered = true;
  }

  function destroy(): void {
    map.remove();
  }

  setTimeout(() => map.invalidateSize(), 60);
  return { update, destroy };
}
