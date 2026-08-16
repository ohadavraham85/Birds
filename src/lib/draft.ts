/* lib/draft.ts — auto-saved snapshot of a new observation being composed
 * (form fields + GPS track captured so far), kept in localStorage so it
 * survives the app being reloaded or killed by the OS mid-session — e.g. an
 * incoming call or switching away to write a message, which can cause a
 * mobile browser to discard the backgrounded tab entirely. This does not
 * and cannot recover GPS points missed *during* such an interruption (the
 * Geolocation API only delivers updates while the page is in the
 * foreground) — it only prevents losing the observation itself. */

import type { TrackPoint } from '../types';

const KEY = 'birds-observation-draft';

export interface ObservationDraft {
  savedAt: string; // ISO
  /** Present when this draft belongs to an edit session (an existing
   * observation being extended/continued), absent for a brand-new one. */
  editId?: string;
  fields: {
    dateTime: string;
    tags: string[];
    observers: string[];
    location: string;
    lat: number | null;
    lng: number | null;
    coordsLocked: boolean;
    notes: string;
    mediaLink: string;
    entries: { species: string; quantity: number; note?: string }[];
    seriesId?: string;
  };
  track: { points: TrackPoint[]; startedAt: number } | null;
}

export function saveDraft(draft: ObservationDraft): void {
  try { localStorage.setItem(KEY, JSON.stringify(draft)); } catch { /* storage unavailable/full — draft safety-net is best-effort */ }
}

export function loadDraft(): ObservationDraft | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as ObservationDraft) : null;
  } catch { return null; }
}

export function clearDraft(): void {
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}
