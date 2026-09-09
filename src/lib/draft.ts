/* lib/draft.ts — auto-saved snapshot of an observation being composed
 * (form fields + GPS track captured so far), kept in localStorage so it
 * survives the app being reloaded or killed by the OS mid-session — e.g. an
 * incoming call or switching away to write a message, which can cause a
 * mobile browser to discard the backgrounded tab entirely. This does not
 * and cannot recover GPS points missed *during* such an interruption (the
 * Geolocation API only delivers updates while the page is in the
 * foreground) — it only prevents losing the observation itself.
 *
 * Several new observations can be left open at once (e.g. two birds spotted
 * close together, logged one after another without saving the first) — each
 * draft is stored under its own key, keyed by `id` (the in-progress
 * observation's own id, or the existing observation's id when it's an edit
 * being extended), with a small index listing which ids exist. */

import type { TrackPoint } from '../types';

const INDEX_KEY = 'birds-draft-index';
const LEGACY_KEY = 'birds-observation-draft';
const draftKey = (id: string): string => `birds-draft:${id}`;

export interface ObservationDraft {
  id: string;
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

function readIndex(): string[] {
  try {
    const raw = localStorage.getItem(INDEX_KEY);
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch { return []; }
}

function writeIndex(ids: string[]): void {
  try { localStorage.setItem(INDEX_KEY, JSON.stringify(ids)); } catch { /* storage unavailable/full */ }
}

/** One-time upgrade from the old single-draft scheme (one fixed key, no id)
 * — folds whatever was there into the new per-id scheme so an in-progress
 * observation from before this change isn't silently dropped. */
function migrateLegacyDraft(): void {
  let raw: string | null;
  try { raw = localStorage.getItem(LEGACY_KEY); } catch { return; }
  if (!raw) return;
  try {
    const old = JSON.parse(raw) as Omit<ObservationDraft, 'id'> & { id?: string };
    const id = old.editId || old.id || crypto.randomUUID();
    saveDraft({ ...old, id });
  } catch { /* corrupt legacy draft — nothing usable to migrate */ }
  try { localStorage.removeItem(LEGACY_KEY); } catch { /* ignore */ }
}

export function saveDraft(draft: ObservationDraft): void {
  try {
    localStorage.setItem(draftKey(draft.id), JSON.stringify(draft));
    const ids = readIndex();
    if (!ids.includes(draft.id)) writeIndex([...ids, draft.id]);
  } catch { /* storage unavailable/full — draft safety-net is best-effort */ }
}

export function loadDraft(id: string): ObservationDraft | null {
  try {
    const raw = localStorage.getItem(draftKey(id));
    return raw ? (JSON.parse(raw) as ObservationDraft) : null;
  } catch { return null; }
}

/** Every open draft, newest first — the home screen's recovery banner lists
 * all of them, since more than one new observation can be left unsaved. */
export function listDrafts(): ObservationDraft[] {
  migrateLegacyDraft();
  const ids = readIndex();
  const drafts = ids.map(loadDraft).filter((d): d is ObservationDraft => d !== null);
  if (drafts.length !== ids.length) writeIndex(drafts.map((d) => d.id)); // prune stale index entries
  return drafts.sort((a, b) => b.savedAt.localeCompare(a.savedAt));
}

export function clearDraft(id: string): void {
  try {
    localStorage.removeItem(draftKey(id));
    writeIndex(readIndex().filter((x) => x !== id));
  } catch { /* ignore */ }
}
