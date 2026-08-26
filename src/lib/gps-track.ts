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
let wakeLock: { release(): Promise<void> } | null = null;

/** Fired whenever the underlying `watchPosition` call reports an error
 * (permission denied, position unavailable, or a fix timing out) — the
 * recording UI shows this as it happens, since otherwise a session that
 * never actually captures a real fix looks identical to one that's working
 * (the toggle is on, the timer is ticking) until save time, when it quietly
 * produces no track at all (buildTrack requires at least 2 points). Does
 * NOT stop the recording — `watchPosition` keeps retrying on its own, and a
 * weak-signal start often does resolve once a fix comes through. */
const errorListeners = new Set<(err: GeolocationPositionError) => void>();
export function onTrackError(fn: (err: GeolocationPositionError) => void): () => void {
  errorListeners.add(fn);
  return () => errorListeners.delete(fn);
}
/** Set while a recording's GPS watch was torn down because the tab went to
 * the background — tells the visibilitychange handler to re-arm it (rather
 * than start a brand-new session) once the tab is foregrounded again. */
let pausedForVisibility = false;

export function haversineMeters(a: TrackPoint, b: TrackPoint): number {
  const R = 6371000;
  const toRad = (d: number): number => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Compass bearing (0-360°, 0 = north) from point `a` to point `b` —
 * used to orient the direction-of-travel arrows drawn along a track. */
export function bearingDegrees(a: TrackPoint, b: TrackPoint): number {
  const toRad = (d: number): number => (d * Math.PI) / 180;
  const toDeg = (r: number): number => (r * 180) / Math.PI;
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const dLng = toRad(b.lng - a.lng);
  const y = Math.sin(dLng) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

/** Total ground distance covered along a sequence of fixes. */
export function totalDistanceMeters(pts: TrackPoint[]): number {
  let sum = 0;
  for (let i = 1; i < pts.length; i++) sum += haversineMeters(pts[i - 1]!, pts[i]!);
  return sum;
}

/** "340 מ'" under a km, "2.4 ק"מ" from a km up. */
export function fmtDistance(meters: number): string {
  if (meters < 1000) return `${Math.round(meters)} מ'`;
  return `${(meters / 1000).toFixed(1)} ק"מ`;
}

export function isTracking(): boolean {
  return watchId != null;
}

export function elapsedMs(): number {
  return startedAt ? Date.now() - startedAt : 0;
}

/** Live running distance while a recording is in progress. */
export function distanceMetersSoFar(): number {
  return totalDistanceMeters(points);
}

/** The most recent fix captured so far, or null if nothing's been recorded
 * yet — used to place a report pin at "here, right now" while recording. */
export function lastPoint(): TrackPoint | null {
  return points.length ? points[points.length - 1]! : null;
}

/** A read-only peek at what's been captured so far, without stopping the
 * recording — used to auto-save a resumable draft (see lib/draft.ts).
 * Returns null if no session is in progress. */
export function snapshot(): { points: TrackPoint[]; startedAt: number } | null {
  return startedAt ? { points: [...points], startedAt } : null;
}

/** Preloads points/timing from a saved draft before calling startTracking(),
 * so the resumed recording appends onto what was already captured instead
 * of starting over. No-ops if a recording is already active. */
export function seedFromDraft(savedPoints: TrackPoint[], savedStartedAt: number): void {
  if (watchId != null) return;
  points = [...savedPoints];
  startedAt = savedStartedAt;
}

async function acquireWakeLock(): Promise<void> {
  try {
    const nav = navigator as Navigator & { wakeLock?: { request(type: 'screen'): Promise<{ release(): Promise<void> }> } };
    if (nav.wakeLock) wakeLock = await nav.wakeLock.request('screen');
  } catch { /* unsupported / denied — the screen just won't be kept awake */ }
}

function releaseWakeLock(): void {
  void wakeLock?.release().catch(() => {});
  wakeLock = null;
}

// The Wake Lock spec auto-releases the lock once the tab is hidden — grab it
// again if we're still actively recording when the tab becomes visible.
// Backgrounding also tears down the GPS watch itself (rather than relying on
// the browser to silently stop delivering fixes) so no battery/CPU is spent
// polling location while the app isn't in front of the user; startTracking()
// re-arms it on return without resetting the points/timer already captured.
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      if (watchId != null) void acquireWakeLock();
      if (pausedForVisibility) { pausedForVisibility = false; startTracking(); }
    } else if (watchId != null) {
      navigator.geolocation.clearWatch(watchId);
      watchId = null;
      pausedForVisibility = true;
    }
  });
}

/** Starts recording; safely no-ops if geolocation is unsupported or already
 * tracking. Resumes onto an existing session (e.g. seeded from a draft)
 * instead of resetting, if one is already in progress. */
export function startTracking(): void {
  if (watchId != null || !navigator.geolocation) return;
  if (!startedAt) { points = []; startedAt = Date.now(); }
  void acquireWakeLock();
  watchId = navigator.geolocation.watchPosition(
    (pos) => {
      const p: TrackPoint = { lat: pos.coords.latitude, lng: pos.coords.longitude, t: Date.now() };
      const last = points[points.length - 1];
      if (last && p.t - last.t < MIN_INTERVAL_MS) return;
      points.push(p);
    },
    (err) => { for (const fn of errorListeners) fn(err); },
    { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 },
  );
}

/** Stops recording and returns the classified track (empty segments if fewer than 2 points were captured). */
export function stopTracking(): { points: TrackPoint[]; segments: TrackSegment[]; startedAt: number; endedAt: number; distanceMeters: number } {
  if (watchId != null) { navigator.geolocation.clearWatch(watchId); watchId = null; }
  pausedForVisibility = false;
  releaseWakeLock();
  const endedAt = Date.now();
  const captured = points;
  points = [];
  const started = startedAt;
  startedAt = 0;
  return { points: captured, segments: classify(captured), startedAt: started, endedAt, distanceMeters: totalDistanceMeters(captured) };
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
