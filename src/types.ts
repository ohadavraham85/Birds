/* types.ts — Domain models shared across the app. */

/** An image attached to an observation. `localId` links to a blob in the media
 * store; `remoteId` is assigned by the server after the blob is uploaded. */
export interface ObservationImage {
  localId: string;
  name: string;
  remoteId?: string | null;
}

/** One bird species observed, with its count and an optional per-species note.
 * An observation may have several. */
export interface SpeciesEntry {
  species: string;
  quantity: number;
  note?: string;
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
  images: ObservationImage[];
  notes: string;
  /** Soft-delete tombstone — kept so the deletion propagates on sync. */
  deleted: boolean;
  /** Last local modification, ISO. Used for last-write-wins merging. */
  updatedAt: string;
  /** True once the server has acknowledged this version. */
  synced?: boolean;
  demo?: boolean;
}

/** Master species-list entry (name only; details come from the bundle). */
export interface SpeciesRow {
  name: string;
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

export type SettingsKey =
  | 'syncServerUrl'
  | 'syncCursor'
  | 'lastSync'
  | 'speciesSeedVersion'
  | 'deviceId';

export interface SettingRow<T = unknown> {
  key: string;
  value: T;
}

/** A pending mutation waiting to be pushed to the server (outbox pattern). */
export interface OutboxEntry {
  id: number; // auto-increment
  entity: 'observation' | 'species';
  entityId: string;
  op: 'upsert' | 'delete';
  payload: Observation | SpeciesRow;
  createdAt: string;
}

export type SyncState = 'idle' | 'syncing' | 'offline' | 'error' | 'disabled';

export interface SyncStatus {
  state: SyncState;
  pending: number;
  lastSync: string | null;
  message?: string;
}
