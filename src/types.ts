/* types.ts — Domain models shared across the app. */

/** An image attached to an observation. `localId` links to a blob in the media
 * store; `remoteId` is assigned by the server after the blob is uploaded. */
export interface ObservationImage {
  localId: string;
  name: string;
  remoteId?: string | null;
}

/** One bird species observed, with its count, an optional per-species note,
 * and its own attached photos. An observation may have several. */
export interface SpeciesEntry {
  species: string;
  quantity: number;
  note?: string;
  images?: ObservationImage[];
}

/** A single observation row (גיליון "תצפיות"). */
export interface Observation {
  id: string;
  dateTime: string; // ISO
  locationName: string;
  lat: number | null;
  lng: number | null;
  /** @deprecated superseded by `tags` — kept so old data (pre-migration
   * backups, un-migrated remote docs) still reads; no UI writes here anymore. */
  project: string;
  /** Names of TagRow entries this observation carries. Multi-valued —
   * replaces the old single `project` field. */
  tags: string[];
  /** Marked by the user as a favorite, for quick filtering in the journal. */
  starred?: boolean;
  /** One or more species seen in this observation, each with a count. */
  entries: SpeciesEntry[];
  /** @deprecated observation-level images — migrated into entries[0].images. */
  images: ObservationImage[];
  notes: string;
  /** Soft-delete tombstone — kept so the deletion propagates on sync. */
  deleted: boolean;
  /** Last local modification, ISO. Used for last-write-wins merging. */
  updatedAt: string;
}

/** Master species-list entry (name only; details come from the bundle). */
export interface SpeciesRow {
  name: string;
  updatedAt: string;
  deleted?: boolean;
  /** User-written free-text description/notes for this species. */
  description?: string;
}

/** Master locations-list entry: a saved place name with canonical
 * coordinates, editable in Settings. Local-only (not yet synced to server). */
export interface LocationRow {
  name: string;
  lat: number | null;
  lng: number | null;
  updatedAt: string;
  deleted?: boolean;
}

/** Master project-list entry (name only), editable in Settings — the same
 * pattern as SpeciesRow, giving projects their own manageable list instead
 * of existing only as free text scattered across observations.
 * @deprecated superseded by TagRow — kept only so old backups/sync data
 * carrying a `projects` collection still parse; no UI writes here anymore. */
export interface ProjectRow {
  name: string;
  updatedAt: string;
  deleted?: boolean;
}

/** A named, multi-assignable label (e.g. "קינון 2026", "נדירים") — replaces
 * the old single-valued `project` field. Color + icon make it a visible
 * badge everywhere an observation is shown. */
export interface TagRow {
  name: string;
  color: string; // hex
  icon: TagIconName;
  updatedAt: string;
  deleted?: boolean;
}

export const TAG_ICON_NAMES = [
  'tagRaptor', 'tagOwl', 'tagHeron', 'tagDuck', 'tagSongbird',
  'tagGull', 'tagWoodpecker', 'tagDove', 'tagShorebird', 'tagGeneric',
] as const;
export type TagIconName = typeof TAG_ICON_NAMES[number];

/** One fix along a recorded GPS track. */
export interface TrackPoint {
  lat: number;
  lng: number;
  t: number; // ms epoch
}

/** A contiguous leg of a track classified by pace — used to color-code the
 * route on the map ("מסלולי צפרות"): walking legs vs. stopped-in-place legs
 * (e.g. standing still to watch a bird). Adjacent segments share their
 * boundary point so the drawn polylines connect with no visual gap. */
export interface TrackSegment {
  kind: 'walk' | 'stop';
  points: TrackPoint[];
}

/** A GPS track recorded automatically while a NEW observation's form was
 * open, from the moment it was opened until it was saved. Keyed 1:1 by the
 * observation's id. Local-only for now — not yet part of Firebase sync. */
export interface ObservationTrack {
  id: string; // == Observation.id
  points: TrackPoint[];
  segments: TrackSegment[];
  startedAt: string; // ISO
  endedAt: string; // ISO
  durationMs: number;
  /** Total ground distance covered, summed leg-by-leg with the haversine formula. */
  distanceMeters: number;
  /** A small schematic PNG (data URL) of the route, rendered once when the
   * track is saved, so the observation itself can show its route without
   * initializing a full Leaflet map per card. */
  previewImage?: string;
  updatedAt: string;
}

/** Original-quality image blob, linked to an observation. */
export interface MediaRecord {
  id: string;
  obsId: string;
  name: string;
  mime: string;
  blob: Blob;
  remoteId?: string | null;
}

/** A file kept in Settings ← קבצים: either a PDF report archived automatically
 * every time a "ייצוא PDF" runs ('report'), or one the user uploaded
 * themselves ('external'). Synced across devices via Firebase (blob in
 * Storage, metadata in Firestore) the same way observation photos are. */
export interface StoredFile {
  id: string;
  name: string;
  kind: 'report' | 'external';
  mime: string;
  /** Missing only on a deleted tombstone (space freed locally once soft-deleted). */
  blob?: Blob;
  createdAt: string; // ISO
  /** Last local modification, ISO — used for last-write-wins merging. */
  updatedAt: string;
  /** Soft-delete tombstone so the deletion propagates on sync. */
  deleted?: boolean;
}

/** Reference details for a species (from the field guide / PDF). */
export interface SpeciesDetail {
  he: string;
  en: string;
  sci: string;
  family: string;
}

export interface SettingRow<T = unknown> {
  key: string;
  value: T;
}

/** A pending mutation, historically drained to a sync server (outbox
 * pattern) — the table is kept in the Dexie schema so existing installs
 * don't need a migration, but nothing writes to it anymore now that sync is
 * Firebase-only (see firebase/firestore-sync.ts). */
export interface OutboxEntry {
  id: number; // auto-increment
  entity: 'observation' | 'species';
  entityId: string;
  op: 'upsert' | 'delete';
  payload: Observation | SpeciesRow;
  createdAt: string;
}
