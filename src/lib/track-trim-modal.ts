/* lib/track-trim-modal.ts — lets a track that kept recording long after the
 * walk actually ended (forgetting to close the observation leaves
 * watchPosition running until the tab is finally left) be cut back down to
 * the part that actually happened, instead of losing the whole recording. */

import L from './leaflet-setup';
import { createMapLayers } from './map-layers';
import { TRACK_SEGMENT_COLOR } from './track-preview';
import { renderTrackPreview } from './track-preview';
import { fmtDistance, trimTrack } from './gps-track';
import { showModal, toast } from './ui';
import { saveTrack } from '../db/repository';
import type { ObservationTrack } from '../types';

function fmtDuration(ms: number): string {
  const mins = Math.round(ms / 60000);
  if (mins < 60) return `${mins} דק'`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m ? `${h} שע' ${m} דק'` : `${h} שע'`;
}

export function openTrimTrackModal(track: ObservationTrack, onSaved: (trimmed: ObservationTrack) => void): void {
  const wrap = document.createElement('div');
  wrap.className = 'trim-track-modal';
  wrap.innerHTML = `
    <h3>קיצור מסלול</h3>
    <p class="trim-track-hint">גררו כדי לחתוך את הזנב המיותר של ההקלטה — למשל אם נשכח לסגור את התצפית וה-GPS המשיך להקליט במקום שלא לצורך.</p>
    <div class="trim-track-map"></div>
    <div class="trim-track-stats"></div>
    <input type="range" class="trim-track-slider" min="2" max="${track.points.length}" value="${track.points.length}">
    <div class="modal-actions">
      <button type="button" class="btn btn-primary trim-track-save">שמירת הקיצור</button>
      <button type="button" class="btn btn-sm trim-track-cancel">ביטול</button>
    </div>
  `;
  const close = showModal(wrap);

  const mapEl = wrap.querySelector<HTMLElement>('.trim-track-map')!;
  const map = L.map(mapEl, { zoomControl: false, attributionControl: false, scrollWheelZoom: false, doubleClickZoom: false });
  const layers = createMapLayers();
  layers.satellite.addTo(map);
  layers.labels.addTo(map);

  const allLatLngs = track.points.map((p): [number, number] => [p.lat, p.lng]);
  // The full original route, always visible underneath, so it's clear how
  // much is being cut away as the slider moves.
  L.polyline(allLatLngs, { color: '#999', weight: 3, opacity: 0.55, dashArray: '4 6' }).addTo(map);
  if (allLatLngs.length) map.fitBounds(L.latLngBounds(allLatLngs), { padding: [16, 16] });

  let keptLine: L.Polyline | null = null;
  let cutoffMarker: L.Marker | null = null;
  const statsEl = wrap.querySelector<HTMLElement>('.trim-track-stats')!;
  const slider = wrap.querySelector<HTMLInputElement>('.trim-track-slider')!;

  function redraw(): void {
    const keepCount = parseInt(slider.value, 10);
    const trimmed = trimTrack(track, keepCount);
    const latlngs = trimmed.points.map((p): [number, number] => [p.lat, p.lng]);
    if (keptLine) keptLine.setLatLngs(latlngs);
    else keptLine = L.polyline(latlngs, { color: TRACK_SEGMENT_COLOR.walk, weight: 5, opacity: 0.95 }).addTo(map);

    const last = trimmed.points[trimmed.points.length - 1]!;
    if (cutoffMarker) cutoffMarker.setLatLng([last.lat, last.lng]);
    else {
      const icon = L.divIcon({ className: 'trim-track-cutoff-icon', html: '<span></span>', iconSize: [14, 14], iconAnchor: [7, 7] });
      cutoffMarker = L.marker([last.lat, last.lng], { icon, keyboard: false }).addTo(map);
    }

    const cut = track.points.length - trimmed.points.length;
    statsEl.textContent = cut > 0
      ? `נשארים ${trimmed.points.length} מתוך ${track.points.length} נקודות · ${fmtDuration(trimmed.durationMs)} · ${fmtDistance(trimmed.distanceMeters)} — ${cut} נקודות יוסרו`
      : `כל ${track.points.length} הנקודות נשמרות (לא נחתך דבר) · ${fmtDuration(trimmed.durationMs)} · ${fmtDistance(trimmed.distanceMeters)}`;
  }

  slider.addEventListener('input', redraw);
  redraw();
  setTimeout(() => map.invalidateSize(), 60);

  wrap.querySelector('.trim-track-cancel')!.addEventListener('click', close);
  wrap.querySelector('.trim-track-save')!.addEventListener('click', () => {
    void (async () => {
      const keepCount = parseInt(slider.value, 10);
      const trimmed = trimTrack(track, keepCount);
      trimmed.previewImage = renderTrackPreview(trimmed.segments, trimmed.reportPins ?? []) ?? undefined;
      await saveTrack(trimmed);
      close();
      toast('המסלול קוצר ✓');
      onSaved(trimmed);
    })();
  });
}
