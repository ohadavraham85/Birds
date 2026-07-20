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
  project: string;
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

/** Original-quality image blob, linked to an observation. */
export interface MediaRecord {
  id: string;
  obsId: string;
  name: string;
  mime: string;
  blob: Blob;
  remoteId?: string | null;
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
