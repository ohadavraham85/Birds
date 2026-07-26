/* lib/track-preview.ts — renders a compact schematic thumbnail of a recorded
 * GPS track (walk/stop color-coded, not a real basemap) as a PNG data URL,
 * so an observation can show its own route without initializing a full
 * Leaflet map per card. Shares its segment colors with the map view's
 * "מסלולי צפרות" layer so the two stay visually consistent. */

import type { TrackSegment, TrackReportPin } from '../types';

export const TRACK_SEGMENT_COLOR: Record<'walk' | 'stop', string> = { walk: '#2f7dff', stop: '#ff8a00' };

const WIDTH = 320;
const HEIGHT = 160;
const PAD = 16;

export function renderTrackPreview(segments: TrackSegment[], reportPins: TrackReportPin[] = []): string | null {
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

  ctx.font = '10px sans-serif';
  ctx.textBaseline = 'middle';
  for (const pin of reportPins) {
    const [x, y] = toXY(
      Math.min(Math.max(pin.lat, minLat), maxLat),
      Math.min(Math.max(pin.lng, minLng), maxLng),
    );
    ctx.fillStyle = pin.kind === 'new' ? '#8e44ad' : '#e67e22';
    ctx.beginPath(); ctx.arc(x, y, 3.5, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 1; ctx.stroke();
    const label = pin.kind === 'add' ? `+1 ${pin.species}` : pin.species;
    ctx.fillStyle = '#1a1a1a';
    ctx.fillText(label, Math.min(x + 6, WIDTH - 4 - label.length * 5), y);
  }

  return canvas.toDataURL('image/png');
}

/* ---------- satellite-backed version, used only for PDF export ----------
 * The flat schematic above stays the live, offline-safe preview shown in the
 * app (obs-card.ts, generated once at save time with zero network cost).
 * PDF export can afford a network round-trip (it already shows a loading
 * state — see pdf.ts/withBusyButton), so it composites real Esri World
 * Imagery tiles under the same route/pin drawing, using standard Web
 * Mercator tile math (same tile source as lib/map-layers.ts's satellite
 * layer, so the imagery matches the in-app map). Falls back to the flat
 * schematic look (still returned, just without a tile background) if the
 * tiles can't be fetched — offline, blocked, or a slow connection — so PDF
 * export never fails outright over this. */

const TILE_SIZE = 256;
const SAT_TILE_URL = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
const SAT_WIDTH = 640;
const SAT_HEIGHT = 360;
const SAT_PAD = 24;
const TILE_FETCH_TIMEOUT_MS = 5000;

function mercatorWorldPx(lat: number, lng: number, zoom: number): [number, number] {
  const scale = TILE_SIZE * 2 ** zoom;
  const sinLat = Math.sin((lat * Math.PI) / 180);
  const x = ((lng + 180) / 360) * scale;
  const y = (0.5 - Math.log((1 + sinLat) / (1 - sinLat)) / (4 * Math.PI)) * scale;
  return [x, y];
}

/** Highest zoom (up to 19, matching map-layers.ts's satellite layer) at
 * which the whole padded bounding box still fits inside the canvas. */
function pickZoom(minLat: number, maxLat: number, minLng: number, maxLng: number): number {
  for (let z = 19; z >= 2; z--) {
    const [x1, y1] = mercatorWorldPx(maxLat, minLng, z);
    const [x2, y2] = mercatorWorldPx(minLat, maxLng, z);
    if (Math.abs(x2 - x1) <= SAT_WIDTH - SAT_PAD * 2 && Math.abs(y2 - y1) <= SAT_HEIGHT - SAT_PAD * 2) return z;
  }
  return 2;
}

function loadTileImage(z: number, x: number, y: number): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    const timer = setTimeout(() => resolve(null), TILE_FETCH_TIMEOUT_MS);
    img.onload = (): void => { clearTimeout(timer); resolve(img); };
    img.onerror = (): void => { clearTimeout(timer); resolve(null); };
    const n = 2 ** z;
    const wrappedX = ((x % n) + n) % n;
    img.src = SAT_TILE_URL.replace('{z}', String(z)).replace('{y}', String(y)).replace('{x}', String(wrappedX));
  });
}

export async function renderTrackMapImage(segments: TrackSegment[], reportPins: TrackReportPin[] = []): Promise<string | null> {
  const points = segments.flatMap((s) => s.points);
  if (points.length < 2) return null;

  const lats = points.map((p) => p.lat);
  const lngs = points.map((p) => p.lng);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);

  const canvas = document.createElement('canvas');
  canvas.width = SAT_WIDTH;
  canvas.height = SAT_HEIGHT;
  const ctx = canvas.getContext('2d');
  if (!ctx) return renderTrackPreview(segments, reportPins);

  ctx.fillStyle = '#cfd8d3';
  ctx.fillRect(0, 0, SAT_WIDTH, SAT_HEIGHT);

  const zoom = pickZoom(minLat, maxLat, minLng, maxLng);
  const [centerX, centerY] = mercatorWorldPx((minLat + maxLat) / 2, (minLng + maxLng) / 2, zoom);
  const originX = centerX - SAT_WIDTH / 2;
  const originY = centerY - SAT_HEIGHT / 2;

  const toXY = (lat: number, lng: number): [number, number] => {
    const [wx, wy] = mercatorWorldPx(lat, lng, zoom);
    return [wx - originX, wy - originY];
  };

  const tileXMin = Math.floor(originX / TILE_SIZE);
  const tileXMax = Math.floor((originX + SAT_WIDTH - 1) / TILE_SIZE);
  const tileYMin = Math.floor(originY / TILE_SIZE);
  const tileYMax = Math.floor((originY + SAT_HEIGHT - 1) / TILE_SIZE);

  const tileJobs: Array<Promise<void>> = [];
  for (let ty = tileYMin; ty <= tileYMax; ty++) {
    for (let tx = tileXMin; tx <= tileXMax; tx++) {
      tileJobs.push(loadTileImage(zoom, tx, ty).then((img) => {
        if (!img) return;
        ctx.drawImage(img, tx * TILE_SIZE - originX, ty * TILE_SIZE - originY, TILE_SIZE, TILE_SIZE);
      }));
    }
  }
  await Promise.allSettled(tileJobs);

  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.lineWidth = 4;
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
  ctx.beginPath(); ctx.arc(sx, sy, 5, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.stroke();
  ctx.fillStyle = '#c0392b';
  ctx.beginPath(); ctx.arc(ex, ey, 5, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = '#fff'; ctx.stroke();

  ctx.font = '12px sans-serif';
  ctx.textBaseline = 'middle';
  for (const pin of reportPins) {
    const [x, y] = toXY(
      Math.min(Math.max(pin.lat, minLat), maxLat),
      Math.min(Math.max(pin.lng, minLng), maxLng),
    );
    ctx.fillStyle = pin.kind === 'new' ? '#8e44ad' : '#e67e22';
    ctx.beginPath(); ctx.arc(x, y, 4.5, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.2; ctx.stroke();
    const label = pin.kind === 'add' ? `+1 ${pin.species}` : pin.species;
    ctx.fillStyle = '#1a1a1a';
    ctx.strokeStyle = 'rgba(255,255,255,.85)'; ctx.lineWidth = 3;
    const labelX = Math.min(x + 7, SAT_WIDTH - 6 - label.length * 6);
    ctx.strokeText(label, labelX, y);
    ctx.fillText(label, labelX, y);
  }

  try {
    return canvas.toDataURL('image/png');
  } catch {
    // Tainted canvas (a tile responded without CORS headers) — fall back to
    // the always-safe flat schematic rather than failing the PDF export.
    return renderTrackPreview(segments, reportPins);
  }
}
