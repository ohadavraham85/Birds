/* lib/gps-track.ts — records a GPS track for the current fieldwork session
 * while a NEW observation's form is open, and classifies the recorded legs
 * into color-coded walk/stop segments ("מסלולי צפרות").
 *
 * Foreground-only by nature of the browser Geolocation API: watchPosition
 * stops delivering updates once the tab/PWA is backgrounded or the screen
 * locks, so the recording effectively pauses whenever you switch away from
 * the app. There is no way around this in a web PWA without a native
 * wrapper — this is disclosed to the user rather than silently promising
 * true background tracking. */

import type { TrackPoint, TrackSegment } from '../types';

/** Below this speed (m/s, ~1.1 km/h) a leg counts as a stop rather than walking. */
const STOP_SPEED_MS = 0.3;
/** Minimum time between recorded fixes (ms) — throttles over-dense sampling
 * while walking without ever discarding a fix outright, so a genuine stop
 * (near-zero distance over a real time gap) still comes through as slow
 * speed instead of vanishing the way a distance-based filter would. */
const MIN_INTERVAL_MS = 2000;

let watchId: number | null = null;
let points: TrackPoint[] = [];
let startedAt = 0;

function haversineMeters(a: TrackPoint, b: TrackPoint): number {
  const R = 6371000;
  const toRad = (d: number): number => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export function isTracking(): boolean {
  return watchId != null;
}

export function elapsedMs(): number {
  return startedAt ? Date.now() - startedAt : 0;
}

/** Starts recording; safely no-ops if geolocation is unsupported, already tracking, or permission is denied. */
export function startTracking(): void {
  if (watchId != null || !navigator.geolocation) return;
  points = [];
  startedAt = Date.now();
  watchId = navigator.geolocation.watchPosition(
    (pos) => {
      const p: TrackPoint = { lat: pos.coords.latitude, lng: pos.coords.longitude, t: Date.now() };
      const last = points[points.length - 1];
      if (last && p.t - last.t < MIN_INTERVAL_MS) return;
      points.push(p);
    },
    () => { /* permission denied / unavailable — the recording just stays empty */ },
    { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 },
  );
}

/** Stops recording and returns the classified track (empty segments if fewer than 2 points were captured). */
export function stopTracking(): { points: TrackPoint[]; segments: TrackSegment[]; startedAt: number; endedAt: number } {
  if (watchId != null) { navigator.geolocation.clearWatch(watchId); watchId = null; }
  const endedAt = Date.now();
  const captured = points;
  points = [];
  const started = startedAt;
  startedAt = 0;
  return { points: captured, segments: classify(captured), startedAt: started, endedAt };
}

/** Classifies each leg (pair of consecutive points) by its speed. Consecutive
 * legs of the same kind merge into one segment; each new segment starts with
 * the previous leg's endpoint so the drawn polylines stay visually connected. */
function classify(pts: TrackPoint[]): TrackSegment[] {
  const segments: TrackSegment[] = [];
  let current: TrackSegment | null = null;
  for (let i = 1; i < pts.length; i++) {
    const prev = pts[i - 1]!;
    const p = pts[i]!;
    const dtSec = (p.t - prev.t) / 1000;
    const dist = haversineMeters(prev, p);
    const speed = dtSec > 0 ? dist / dtSec : 0;
    const kind: 'walk' | 'stop' = speed >= STOP_SPEED_MS ? 'walk' : 'stop';
    if (current && current.kind === kind) current.points.push(p);
    else { current = { kind, points: [prev, p] }; segments.push(current); }
  }
  if (!segments.length && pts.length) segments.push({ kind: 'stop', points: [...pts] });
  return segments;
}
