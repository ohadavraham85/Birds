/* lib/track-preview.ts — renders a compact schematic thumbnail of a recorded
 * GPS track (walk/stop color-coded, not a real basemap) as a PNG data URL,
 * so an observation can show its own route without initializing a full
 * Leaflet map per card. Shares its segment colors with the map view's
 * "מסלולי צפרות" layer so the two stay visually consistent. */

import type { TrackSegment } from '../types';

export const TRACK_SEGMENT_COLOR: Record<'walk' | 'stop', string> = { walk: '#2f7dff', stop: '#ff8a00' };

const WIDTH = 320;
const HEIGHT = 160;
const PAD = 16;

export function renderTrackPreview(segments: TrackSegment[]): string | null {
  const points = segments.flatMap((s) => s.points);
  if (points.length < 2) return null;

  const lats = points.map((p) => p.lat);
  const lngs = points.map((p) => p.lng);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);
  const latSpan = maxLat - minLat || 0.0001;
  const lngSpan = maxLng - minLng || 0.0001;

  const canvas = document.createElement('canvas');
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  ctx.fillStyle = '#eef2ee';
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  const toXY = (lat: number, lng: number): [number, number] => [
    PAD + ((lng - minLng) / lngSpan) * (WIDTH - PAD * 2),
    PAD + ((maxLat - lat) / latSpan) * (HEIGHT - PAD * 2),
  ];

  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.lineWidth = 3;
  for (const seg of segments) {
    if (seg.points.length < 2) continue;
    ctx.strokeStyle = TRACK_SEGMENT_COLOR[seg.kind];
    ctx.beginPath();
    seg.points.forEach((p, i) => {
      const [x, y] = toXY(p.lat, p.lng);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.stroke();
  }

  const [sx, sy] = toXY(points[0]!.lat, points[0]!.lng);
  const [ex, ey] = toXY(points[points.length - 1]!.lat, points[points.length - 1]!.lng);
  ctx.fillStyle = '#2d6a4f';
  ctx.beginPath(); ctx.arc(sx, sy, 4, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#c0392b';
  ctx.beginPath(); ctx.arc(ex, ey, 4, 0, Math.PI * 2); ctx.fill();

  return canvas.toDataURL('image/png');
}
