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
  /** Permanent sequential display number (1, 2, 3...), assigned once when
   * the observation is first saved and never reassigned — stays fixed
   * regardless of filtering/grouping/search/sort in any view. Optional only
   * because rows saved before this field existed get it backfilled by a
   * one-time DB migration rather than at construction time. */
  seqNo?: number;
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
  /** Optional link to an external photo/video album for this observation
   * (e.g. a shared Google Photos or Lightroom cloud album), since full media
   * libraries are too large to store locally — just a pointer out to them. */
  mediaLink?: string;
  /** Names of ObserverRow entries — other people present for this
   * observation, in addition to whoever's keeping the journal. */
  observers?: string[];
  /** Soft-delete tombstone — kept so the deletion propagates on sync. */
  deleted: boolean;
  /** Last local modification, ISO. Used for last-write-wins merging. */
  updatedAt: string;
}

/** A species' birding-status badge, shown on its card in the "מינים" tab —
 * click the badge to set it directly, or leave it unset to auto-derive from
 * the species' logged observation count (0 → unseen, 1 → lifer, 2+ → seen).
 * Independent of the general-purpose TagRow system (which tags
 * observations, not species). */
export const SPECIES_TAGS = ['seen', 'unseen', 'target', 'lifer'] as const;
export type SpeciesTag = typeof SPECIES_TAGS[number];
export const SPECIES_TAG_LABELS: Record<SpeciesTag, string> = {
  seen: 'נצפה', unseen: 'לא נצפה', target: 'מין מטרה', lifer: 'לייפר',
};

/** Master species-list entry (name only; details come from the bundle). */
export interface SpeciesRow {
  name: string;
  updatedAt: string;
  deleted?: boolean;
  /** User-written free-text description/notes for this species. */
  description?: string;
  /** Manual overrides for the bundled reference data (data/species-data.ts)
   * — set when editing a species' details in Settings. Falls back to the
   * bundled value (or nothing, for a species missing from the bundle
   * entirely) when absent. */
  enOverride?: string;
  sciOverride?: string;
  familyOverride?: string;
  /** Manual override for the species' status badge (see SpeciesTag) — set
   * by clicking the badge in the "מינים" tab, or via Settings. Absent means
   * auto-derive from the observation count instead. */
  manualTag?: SpeciesTag;
  /** The `ObservationImage.localId`/`MediaRecord.id` of the photo hand-picked
   * to represent this species on its closed card/tile — set by clicking a
   * photo's star in the species detail gallery. Absent means auto-pick the
   * first resolvable photo instead (species.ts's renderTileThumbnails). */
  coverPhotoId?: string;
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

/** Master observer-list entry (name only), editable in Settings — same
 * plain-name pattern as ProjectRow/LocationRow. Lets an observation record
 * who else was present, multi-selected from this shared list (with an
 * inline quick-add for a name not yet on it) rather than free text. */
export interface ObserverRow {
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

/** One species reported while GPS recording was active — dropped at the
 * exact live position when it happened: once when a species is first
 * entered on a row ('new'), and again each time the "+" quantity stepper
 * is pressed on an already-listed species ('add'). */
export interface TrackReportPin {
  lat: number;
  lng: number;
  species: string;
  kind: 'new' | 'add';
  t: number; // ms epoch
}

/** A GPS track recorded automatically while a NEW observation's form was
 * open, from the moment it was opened until it was saved. Keyed 1:1 by the
 * observation's id. */
export interface ObservationTrack {
  id: string; // == Observation.id
  points: TrackPoint[];
  segments: TrackSegment[];
  startedAt: string; // ISO
  endedAt: string; // ISO
  durationMs: number;
  /** Total ground distance covered, summed leg-by-leg with the haversine formula. */
  distanceMeters: number;
  /** Species reported live during this recording — see TrackReportPin. */
  reportPins?: TrackReportPin[];
  /** A small schematic PNG (data URL) of the route, rendered once when the
   * track is saved, so the observation itself can show its route without
   * initializing a full Leaflet map per card. */
  previewImage?: string;
  /** Soft-delete tombstone so the deletion propagates on sync — the heavy
   * fields (points/segments/previewImage/reportPins) are cleared once set. */
  deleted?: boolean;
  updatedAt: string;
}

/** Original-quality image blob. `obsId` is '' for a photo uploaded straight
 * into the Gallery tab that hasn't been attached to any observation yet
 * ("orphan") — every photo added through the observation form itself always
 * has a real `obsId` from the moment it's saved. */
export interface MediaRecord {
  id: string;
  obsId: string;
  name: string;
  mime: string;
  blob: Blob;
  remoteId?: string | null;
  /** When this blob was first saved, ISO — used to sort the Gallery newest
   * first. Optional only because rows saved before this field existed don't
   * have it (they sort to the end, treated as oldest). */
  addedAt?: string;
  /** When the photo was actually taken, ISO — read from EXIF where
   * available, falling back to the source file's last-modified date.
   * Distinct from `addedAt` (when the blob entered this app), and shown in
   * the Gallery precisely so the original capture date — the thing that
   * actually decides which observation a photo belongs to — isn't lost. */
  takenAt?: string;
  /** Whether `takenAt` came from real EXIF metadata or the much rougher
   * file-modified-date fallback — shown alongside it so the user knows how
   * much to trust it. */
  takenAtSource?: 'exif' | 'file';
  /** SHA-256 hex digest of the blob's bytes — used to detect a re-upload of
   * a photo already in the Gallery before saving a duplicate row. Optional
   * only because rows saved before this field existed don't have it. */
  contentHash?: string;
  /** A species name tagged directly onto this photo from the Gallery —
   * independent of `obsId`/any observation link, so a photo can be labeled
   * by species even when it isn't (or isn't yet) attached to a logged
   * observation. Must be a name from the species master list. */
  species?: string;
  /** Last local modification, ISO — used for last-write-wins merging of
   * "orphan" (unassociated) photos synced via the `media` Firestore
   * collection. Associated photos don't need this; their sync merge is
   * driven by the owning Observation's own `updatedAt` instead. */
  updatedAt?: string;
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
