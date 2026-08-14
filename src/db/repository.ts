/* db/repository.ts — offline-first data access.
 *
 * Every mutation writes to the local Dexie store immediately (so the UI is
 * instant and works offline) and emits an onMutation event so the Firebase
 * sync engine can push exactly that record to the cloud. Reads always come
 * from the local store.
 */

import { db } from './database';
import { entriesOf, speciesNames } from '../lib/observation';
import type {
  Observation,
  SpeciesRow,
  SpeciesTag,
  LocationRow,
  ProjectRow,
  TagRow,
  TagIconName,
  ObserverRow,
  MediaRecord,
  ObservationTrack,
  StoredFile,
} from '../types';

/* ---------- change notifications ---------- */

type Listener = () => void;
const listeners = new Set<Listener>();

export function onDataChanged(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
function emitChange(): void {
  for (const fn of listeners) fn();
}

/** Per-record mutation feed — separate from onDataChanged (which just says
 * "something changed, re-render"). Sync backends that need to know exactly
 * which record changed (e.g. the Firebase sync engine) subscribe here
 * instead of re-scanning the whole database on every change. */
export type MutationEntity = 'observation' | 'species' | 'location' | 'project' | 'file' | 'tag' | 'observer' | 'track' | 'media';
export type MutationOp = 'upsert' | 'delete';
type MutationListener = (entity: MutationEntity, id: string, op: MutationOp, payload: unknown) => void;
const mutationListeners = new Set<MutationListener>();

export function onMutation(fn: MutationListener): () => void {
  mutationListeners.add(fn);
  return () => mutationListeners.delete(fn);
}
function emitMutation(entity: MutationEntity, id: string, op: MutationOp, payload: unknown): void {
  for (const fn of mutationListeners) fn(entity, id, op, payload);
}

function now(): string {
  return new Date().toISOString();
}

/* ---------- observations ---------- */

/** The next permanent display number to hand out — one past whatever's
 * highest locally. Two devices assigning a number offline at the same time
 * could in principle pick the same one; this is accepted as a rare cosmetic
 * edge case rather than adding cross-device coordination for it. */
async function nextObservationSeqNo(): Promise<number> {
  const last = await db.observations.orderBy('seqNo').last();
  return (last?.seqNo ?? 0) + 1;
}

export async function saveObservation(obs: Observation): Promise<Observation> {
  if (obs.seqNo == null) obs.seqNo = await nextObservationSeqNo();
  obs.updatedAt = now();
  await db.observations.put(obs);
  emitChange();
  emitMutation('observation', obs.id, obs.deleted ? 'delete' : 'upsert', obs);
  return obs;
}

/** Some observations synced in from Firestore predate the tags feature (their
 * document was written before `tags` existed and never edited since, so it
 * has no such field at all) — every reader normalizes it to `[]` rather than
 * `undefined`, so code that assumes `Observation.tags` is always an array
 * (per its type) doesn't crash on this real-world legacy data. */
export function normalizeObservation(o: Observation): Observation {
  return o.tags ? o : { ...o, tags: [] };
}

export async function getObservation(id: string): Promise<Observation | undefined> {
  const o = await db.observations.get(id);
  return o && normalizeObservation(o);
}

/** Flips the favorite flag on one observation and pushes it through the same
 * mutation/sync path as any other edit, so starring syncs across devices too. */
export async function toggleStarred(id: string): Promise<boolean> {
  const obs = await db.observations.get(id);
  if (!obs) return false;
  obs.starred = !obs.starred;
  obs.updatedAt = now();
  await db.observations.put(obs);
  emitChange();
  emitMutation('observation', id, 'upsert', obs);
  return obs.starred;
}

/** All non-deleted observations, newest first. */
export async function listObservations(): Promise<Observation[]> {
  const all = await db.observations.toArray();
  return all
    .filter((o) => !o.deleted)
    .map(normalizeObservation)
    .sort((a, b) => (a.dateTime < b.dateTime ? 1 : -1));
}

/** Everything including tombstones — used by sync/backup. */
export async function listObservationsRaw(): Promise<Observation[]> {
  return (await db.observations.toArray()).map(normalizeObservation);
}

/** Write a row exactly as given (used by the Firebase sync engine to apply a remote merge). */
export async function putObservationRaw(obs: Observation): Promise<void> {
  await db.observations.put(obs);
  emitChange();
  emitMutation('observation', obs.id, obs.deleted ? 'delete' : 'upsert', obs);
}

export async function deleteObservation(id: string): Promise<void> {
  const obs = await db.observations.get(id);
  if (!obs) return;
  const media = await mediaForObservation(id);
  for (const m of media) await db.media.delete(m.id);
  await db.tracks.delete(id);
  obs.deleted = true;
  obs.updatedAt = now();
  await db.observations.put(obs);
  emitMutation('observation', id, 'delete', obs);
  emitChange();
}

/* ---------- GPS tracks (recorded while a new observation's form was open) ---------- */

export async function saveTrack(track: ObservationTrack): Promise<void> {
  track.updatedAt = now();
  await db.tracks.put(track);
  emitChange();
  emitMutation('track', track.id, 'upsert', track);
}

export function getTrack(id: string): Promise<ObservationTrack | undefined> {
  return db.tracks.get(id);
}

/** Excludes deleted tombstones. */
export async function listTracks(): Promise<ObservationTrack[]> {
  const all = await db.tracks.toArray();
  return all.filter((t) => !t.deleted);
}

/** Everything including tombstones — used by the Firebase sync engine. */
export function listTracksRaw(): Promise<ObservationTrack[]> {
  return db.tracks.toArray();
}

/** Write a row exactly as given (used by the Firebase sync engine to apply a remote merge). */
export async function putTrackRaw(track: ObservationTrack): Promise<void> {
  await db.tracks.put(track);
  emitChange();
  emitMutation('track', track.id, track.deleted ? 'delete' : 'upsert', track);
}

/** Soft-delete: keeps a lightweight tombstone (so the deletion propagates on
 * sync) but drops the heavy fields immediately, since a deleted track is
 * already excluded from every listing and no longer needs the space. */
export async function deleteTrack(id: string): Promise<void> {
  const track = await db.tracks.get(id);
  if (!track) return;
  track.deleted = true;
  track.points = [];
  track.segments = [];
  track.reportPins = undefined;
  track.previewImage = undefined;
  track.updatedAt = now();
  await db.tracks.put(track);
  emitChange();
  emitMutation('track', id, 'delete', track);
}

/* ---------- stored files (Settings ← קבצים: PDF reports + external uploads) ---------- */

export async function saveFile(file: StoredFile): Promise<void> {
  file.updatedAt = now();
  await db.files.put(file);
  emitChange();
  emitMutation('file', file.id, 'upsert', file);
}

export function getFile(id: string): Promise<StoredFile | undefined> {
  return db.files.get(id);
}

/** Newest first, excluding deleted tombstones. */
export async function listFiles(kind: StoredFile['kind']): Promise<StoredFile[]> {
  const all = await db.files.where('kind').equals(kind).toArray();
  return all.filter((f) => !f.deleted).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

/** Everything including tombstones — used by the Firebase sync engine. */
export function listFilesRaw(): Promise<StoredFile[]> {
  return db.files.toArray();
}

/** Write a row exactly as given (used by the Firebase sync engine to apply a remote merge). */
export async function putFileRaw(file: StoredFile): Promise<void> {
  await db.files.put(file);
  emitChange();
  emitMutation('file', file.id, file.deleted ? 'delete' : 'upsert', file);
}

/** Soft-delete: keeps a lightweight tombstone (so the deletion propagates on
 * sync) but drops the blob immediately, since it's already excluded from
 * every listing and no longer needs to take up local storage space. */
export async function deleteFile(id: string): Promise<void> {
  const file = await db.files.get(id);
  if (!file) return;
  file.deleted = true;
  file.blob = undefined;
  file.updatedAt = now();
  await db.files.put(file);
  emitChange();
  emitMutation('file', id, 'delete', file);
}

/* ---------- species ---------- */

export async function listSpecies(): Promise<string[]> {
  const all = await db.species.toArray();
  return all
    .filter((s) => !s.deleted)
    .map((s) => s.name)
    .sort((a, b) => a.localeCompare(b, 'he'));
}

export async function addSpecies(name: string): Promise<boolean> {
  name = String(name || '').trim();
  if (!name) return false;
  const row: SpeciesRow = { name, updatedAt: now(), deleted: false };
  await db.species.put(row);
  emitChange();
  emitMutation('species', name, 'upsert', row);
  return true;
}

export async function speciesExists(name: string): Promise<boolean> {
  const row = await db.species.get(name);
  return !!row && !row.deleted;
}

/** Raw fetch including tombstones — for last-write-wins comparisons. */
export function getSpeciesRaw(name: string): Promise<SpeciesRow | undefined> {
  return db.species.get(name);
}

/** All non-deleted species rows (with their description), name-sorted. */
export async function listSpeciesRows(): Promise<SpeciesRow[]> {
  const all = await db.species.toArray();
  return all
    .filter((s) => !s.deleted)
    .sort((a, b) => a.name.localeCompare(b.name, 'he'));
}

export async function setSpeciesDescription(name: string, description: string): Promise<void> {
  const row = await db.species.get(name);
  if (!row) return;
  row.description = description;
  row.updatedAt = now();
  await db.species.put(row);
  emitChange();
  emitMutation('species', name, 'upsert', row);
}

/** Edits a species' reference-data overrides (English/scientific/family
 * name — otherwise read from the bundled data/species-data.ts) and its
 * manual status-badge override. An empty string clears an override/tag back
 * to its default (bundled data, or auto-derived from observation count). */
export async function updateSpeciesDetails(
  name: string,
  fields: { en?: string; sci?: string; family?: string; manualTag?: SpeciesTag | ''; coverPhotoId?: string | '' },
): Promise<void> {
  const row = await db.species.get(name);
  if (!row) return;
  if (fields.en !== undefined) row.enOverride = fields.en || undefined;
  if (fields.sci !== undefined) row.sciOverride = fields.sci || undefined;
  if (fields.family !== undefined) row.familyOverride = fields.family || undefined;
  if (fields.manualTag !== undefined) row.manualTag = fields.manualTag || undefined;
  if (fields.coverPhotoId !== undefined) row.coverPhotoId = fields.coverPhotoId || undefined;
  row.updatedAt = now();
  await db.species.put(row);
  emitChange();
  emitMutation('species', name, 'upsert', row);
}

export async function putSpeciesRaw(row: SpeciesRow): Promise<void> {
  await db.species.put(row);
  emitChange();
  emitMutation('species', row.name, row.deleted ? 'delete' : 'upsert', row);
}

export async function deleteSpecies(name: string): Promise<void> {
  const row = await db.species.get(name);
  if (!row) return;
  row.deleted = true;
  row.updatedAt = now();
  await db.species.put(row);
  emitChange();
  emitMutation('species', name, 'delete', row);
}

/** Seed the master list on first run, and replace it when the bundled list
 * version increases so existing installs pick up an updated list. */
export async function seedSpeciesIfEmpty(names: string[], version = 1): Promise<boolean> {
  const count = await db.species.count();
  const stored = Number(await getSetting('speciesSeedVersion', 0));
  if (count > 0 && stored >= version) return false;
  await db.species.clear();
  // Deliberately an old/epoch timestamp, not now() — this bundled seed isn't
  // a real edit, and stamping it "now" would let it out-rank (last-write-wins)
  // a genuine deletion/rename made earlier on another device: if THIS device
  // reseeds (e.g. after a bundled-list version bump) after that edit already
  // happened, a fresh timestamp would make the incoming sync merge think the
  // local (reseeded) row is newer and silently refuse to apply the remote
  // change, forever. Real edits (addSpecies/deleteSpecies/mergeSpeciesNames)
  // always stamp a genuine now(), so they still correctly win against this.
  const ts = new Date(0).toISOString();
  await db.species.bulkPut(names.map((name) => ({ name, updatedAt: ts, deleted: false })));
  await setSetting('speciesSeedVersion', version);
  emitChange();
  return true;
}

/* ---------- locations (local-only master list; not yet synced to server) ---------- */

/** All non-deleted saved locations, name-sorted. */
export async function listLocationRows(): Promise<LocationRow[]> {
  const all = await db.locations.toArray();
  return all.filter((l) => !l.deleted).sort((a, b) => a.name.localeCompare(b.name, 'he'));
}

export async function getLocation(name: string): Promise<LocationRow | undefined> {
  const row = await db.locations.get(name);
  return row && !row.deleted ? row : undefined;
}

/** Raw fetch including tombstones — for last-write-wins comparisons. */
export function getLocationRaw(name: string): Promise<LocationRow | undefined> {
  return db.locations.get(name);
}

// Note: these deliberately don't call emitChange() — nothing else currently
// reads the locations table reactively, and Settings already re-renders its
// own list locally after each call. Triggering the app-wide change listener
// here would rebuild the whole Settings screen ~150ms later and steal focus
// while the user is still editing coordinates. They still emitMutation() so
// an optional cloud sync backend (e.g. Firebase) can pick up the change.

export async function addLocation(name: string, lat: number | null, lng: number | null): Promise<boolean> {
  name = String(name || '').trim();
  if (!name) return false;
  const row: LocationRow = { name, lat, lng, updatedAt: now(), deleted: false };
  await db.locations.put(row);
  emitMutation('location', name, 'upsert', row);
  return true;
}

export async function updateLocationCoords(name: string, lat: number | null, lng: number | null): Promise<void> {
  const row = await db.locations.get(name);
  if (!row) return;
  row.lat = lat;
  row.lng = lng;
  row.updatedAt = now();
  await db.locations.put(row);
  emitMutation('location', name, 'upsert', row);
}

export async function deleteLocation(name: string): Promise<void> {
  const row = await db.locations.get(name);
  if (!row) return;
  row.deleted = true;
  row.updatedAt = now();
  await db.locations.put(row);
  emitMutation('location', name, 'delete', row);
}

export async function putLocationRaw(row: LocationRow): Promise<void> {
  await db.locations.put(row);
  emitChange();
  emitMutation('location', row.name, row.deleted ? 'delete' : 'upsert', row);
}

/** One-time convenience: populate the locations list from the (name, first-seen
 * coordinates) pairs already present in existing observations. Skips names
 * already saved. Returns how many were added. */
export async function seedLocationsFromObservations(): Promise<number> {
  const obs = await listObservations();
  const existing = new Set((await listLocationRows()).map((l) => l.name));
  const toAdd = new Map<string, { lat: number | null; lng: number | null }>();
  for (const o of obs) {
    const name = o.locationName.trim();
    if (!name || existing.has(name) || toAdd.has(name)) continue;
    toAdd.set(name, { lat: o.lat, lng: o.lng });
  }
  const ts = now();
  await db.locations.bulkPut([...toAdd].map(([name, { lat, lng }]) => ({ name, lat, lng, updatedAt: ts, deleted: false })));
  return toAdd.size;
}

/* ---------- projects (local master list, synced like species/locations) ---------- */

/** All non-deleted saved projects, name-sorted. */
export async function listProjectRows(): Promise<ProjectRow[]> {
  const all = await db.projects.toArray();
  return all.filter((p) => !p.deleted).sort((a, b) => a.name.localeCompare(b.name, 'he'));
}

export async function getProject(name: string): Promise<ProjectRow | undefined> {
  const row = await db.projects.get(name);
  return row && !row.deleted ? row : undefined;
}

/** Raw fetch including tombstones — for last-write-wins comparisons. */
export function getProjectRaw(name: string): Promise<ProjectRow | undefined> {
  return db.projects.get(name);
}

export async function addProject(name: string): Promise<boolean> {
  name = String(name || '').trim();
  if (!name) return false;
  const row: ProjectRow = { name, updatedAt: now(), deleted: false };
  await db.projects.put(row);
  emitMutation('project', name, 'upsert', row);
  return true;
}

export async function deleteProject(name: string): Promise<void> {
  const row = await db.projects.get(name);
  if (!row) return;
  row.deleted = true;
  row.updatedAt = now();
  await db.projects.put(row);
  emitMutation('project', name, 'delete', row);
}

export async function putProjectRaw(row: ProjectRow): Promise<void> {
  await db.projects.put(row);
  emitChange();
  emitMutation('project', row.name, row.deleted ? 'delete' : 'upsert', row);
}

/** One-time convenience: populate the projects list from the project names
 * already present in existing observations. Skips names already saved.
 * Returns how many were added. */
export async function seedProjectsFromObservations(): Promise<number> {
  const obs = await listObservations();
  const existing = new Set((await listProjectRows()).map((p) => p.name));
  const toAdd = new Set<string>();
  for (const o of obs) {
    const name = (o.project || '').trim();
    if (!name || existing.has(name) || toAdd.has(name)) continue;
    toAdd.add(name);
  }
  const ts = now();
  await db.projects.bulkPut([...toAdd].map((name) => ({ name, updatedAt: ts, deleted: false })));
  return toAdd.size;
}

/* ---------- observers (local master list, synced like species/locations) ---------- */

/** All non-deleted saved observers, name-sorted. */
export async function listObserverRows(): Promise<ObserverRow[]> {
  const all = await db.observers.toArray();
  return all.filter((o) => !o.deleted).sort((a, b) => a.name.localeCompare(b.name, 'he'));
}

/** Raw fetch including tombstones — for last-write-wins comparisons. */
export function getObserverRaw(name: string): Promise<ObserverRow | undefined> {
  return db.observers.get(name);
}

export async function addObserver(name: string): Promise<boolean> {
  name = String(name || '').trim();
  if (!name) return false;
  const row: ObserverRow = { name, updatedAt: now(), deleted: false };
  await db.observers.put(row);
  emitMutation('observer', name, 'upsert', row);
  return true;
}

export async function deleteObserver(name: string): Promise<void> {
  const row = await db.observers.get(name);
  if (!row) return;
  row.deleted = true;
  row.updatedAt = now();
  await db.observers.put(row);
  emitMutation('observer', name, 'delete', row);
}

export async function putObserverRaw(row: ObserverRow): Promise<void> {
  await db.observers.put(row);
  emitChange();
  emitMutation('observer', row.name, row.deleted ? 'delete' : 'upsert', row);
}

/* ---------- tags (multi-valued, colored+iconed — replaces the old single
 * `project` field; observations carry an array of tag names in `tags`) ---------- */

/** All non-deleted saved tags, name-sorted. */
export async function listTagRows(): Promise<TagRow[]> {
  const all = await db.tags.toArray();
  return all.filter((t) => !t.deleted).sort((a, b) => a.name.localeCompare(b.name, 'he'));
}

export async function getTag(name: string): Promise<TagRow | undefined> {
  const row = await db.tags.get(name);
  return row && !row.deleted ? row : undefined;
}

/** Raw fetch including tombstones — for last-write-wins comparisons. */
export function getTagRaw(name: string): Promise<TagRow | undefined> {
  return db.tags.get(name);
}

export async function addTag(name: string, color: string, icon: TagIconName): Promise<boolean> {
  name = String(name || '').trim();
  if (!name) return false;
  const row: TagRow = { name, color, icon, updatedAt: now(), deleted: false };
  await db.tags.put(row);
  emitChange();
  emitMutation('tag', name, 'upsert', row);
  return true;
}

/** Updates a tag's color/icon, and — if the name changed — rewrites every
 * observation carrying the old name to the new one so nothing gets silently
 * detached from its history. */
export async function updateTag(oldName: string, newName: string, color: string, icon: TagIconName): Promise<boolean> {
  newName = String(newName || '').trim();
  if (!newName) return false;
  if (newName !== oldName) {
    const obs = await listObservationsRaw();
    for (const o of obs) {
      if (!o.tags?.includes(oldName)) continue;
      o.tags = [...new Set(o.tags.map((t) => (t === oldName ? newName : t)))];
      o.updatedAt = now();
      await db.observations.put(o);
      emitMutation('observation', o.id, 'upsert', o);
    }
    const old = await db.tags.get(oldName);
    if (old) {
      old.deleted = true;
      old.updatedAt = now();
      await db.tags.put(old);
      emitMutation('tag', oldName, 'delete', old);
    }
  }
  const row: TagRow = { name: newName, color, icon, updatedAt: now(), deleted: false };
  await db.tags.put(row);
  emitChange();
  emitMutation('tag', newName, 'upsert', row);
  return true;
}

/** Soft-deletes the master tag row only — matches the app's established
 * policy (same as locations/projects/species) that removing a master-list
 * entry never retroactively edits observations that already reference it. */
export async function deleteTag(name: string): Promise<void> {
  const row = await db.tags.get(name);
  if (!row) return;
  row.deleted = true;
  row.updatedAt = now();
  await db.tags.put(row);
  emitChange();
  emitMutation('tag', name, 'delete', row);
}

export async function putTagRaw(row: TagRow): Promise<void> {
  await db.tags.put(row);
  emitChange();
  emitMutation('tag', row.name, row.deleted ? 'delete' : 'upsert', row);
}

/* ---------- duplicate detection & merge (species / locations / projects) ----------
 * Names that differ only by whitespace, punctuation, or Hebrew niqqud are
 * treated as the "same" for detection purposes, even though Dexie's
 * exact-string keys make them distinct rows. Merging rewrites every
 * observation that used a variant name to the chosen canonical one — the
 * observation's other fields (quantity, notes, photos, coordinates) are
 * never touched — then removes the now-redundant variant rows from the
 * master list. */

function normalizeDupKey(s: string): string {
  return s
    .normalize('NFKC')
    .replace(/[֑-ׇ]/g, '') // Hebrew niqqud / cantillation marks
    .replace(/['"׳״`]/g, '')
    .replace(/[()[\]{}]/g, ' ') // parentheses/brackets don't change identity, just drop them
    .replace(/[-–—]/g, ' ')
    .replace(/[.,;]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

export interface DuplicateGroup {
  key: string;
  /** Raw variant names as actually stored, most-used first. */
  names: string[];
}

function groupDuplicates(names: Iterable<string>, counts: Map<string, number>): DuplicateGroup[] {
  const groups = new Map<string, string[]>();
  for (const name of names) {
    const key = normalizeDupKey(name);
    if (!key) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(name);
  }
  const result: DuplicateGroup[] = [];
  for (const [key, group] of groups) {
    if (group.length < 2) continue;
    group.sort((a, b) => (counts.get(b) || 0) - (counts.get(a) || 0));
    result.push({ key, names: group });
  }
  return result.sort((a, b) => b.names.length - a.names.length);
}

export async function findDuplicateSpeciesGroups(): Promise<DuplicateGroup[]> {
  const rows = await listSpeciesRows();
  const obs = await listObservations();
  const counts = new Map<string, number>();
  for (const o of obs) for (const name of speciesNames(o)) counts.set(name, (counts.get(name) || 0) + 1);
  const allNames = new Set<string>([...rows.map((r) => r.name), ...counts.keys()]);
  return groupDuplicates(allNames, counts);
}

export async function findDuplicateLocationGroups(): Promise<DuplicateGroup[]> {
  const rows = await listLocationRows();
  const obs = await listObservations();
  const counts = new Map<string, number>();
  for (const o of obs) if (o.locationName) counts.set(o.locationName, (counts.get(o.locationName) || 0) + 1);
  const allNames = new Set<string>([...rows.map((r) => r.name), ...counts.keys()]);
  return groupDuplicates(allNames, counts);
}

export async function findDuplicateProjectGroups(): Promise<DuplicateGroup[]> {
  const rows = await listProjectRows();
  const obs = await listObservations();
  const counts = new Map<string, number>();
  for (const o of obs) if (o.project) counts.set(o.project, (counts.get(o.project) || 0) + 1);
  const allNames = new Set<string>([...rows.map((r) => r.name), ...counts.keys()]);
  return groupDuplicates(allNames, counts);
}

/** Rewrite every observation using one of `variants` as its species name to
 * `canonical`, then drop the variant rows from the species master list.
 * Returns how many observations were updated. */
export async function mergeSpeciesNames(variants: string[], canonical: string): Promise<number> {
  canonical = canonical.trim();
  const toMerge = new Set(variants.filter((v) => v !== canonical));
  if (!toMerge.size) return 0;
  let changed = 0;
  const all = await db.observations.toArray();
  for (const o of all) {
    if (o.deleted) continue;
    const entries = entriesOf(o);
    let touched = false;
    for (const e of entries) {
      if (toMerge.has(e.species)) { e.species = canonical; touched = true; }
    }
    if (touched) {
      o.entries = entries;
      o.updatedAt = now();
      await db.observations.put(o);
      emitMutation('observation', o.id, 'upsert', o);
      changed++;
    }
  }
  // Merges are batch operations run from the Settings duplicate-finder, which
  // already re-renders its own lists locally afterwards — deliberately
  // avoid addSpecies()/deleteSpecies() here since those call emitChange(),
  // which would rebuild the whole Settings screen ~150ms later and wipe out
  // the (possibly still in-progress) duplicate scan the user is working through.
  const ts = now();
  const canonicalRow = await db.species.get(canonical);
  // If the surviving (canonical) row has no description yet, adopt one from
  // whichever merged variant has it — a merge shouldn't silently discard a
  // detail the user wrote just because it happened to live under the name
  // that's being retired.
  let description = canonicalRow?.description;
  if (!description) {
    for (const v of toMerge) {
      const row = await db.species.get(v);
      if (row?.description) { description = row.description; break; }
    }
  }
  if (!canonicalRow || canonicalRow.deleted || description !== canonicalRow.description) {
    const row: SpeciesRow = { name: canonical, updatedAt: ts, deleted: false, ...(description ? { description } : {}) };
    await db.species.put(row);
    emitMutation('species', canonical, 'upsert', row);
  }
  for (const v of toMerge) {
    const row = await db.species.get(v);
    if (row && !row.deleted) {
      row.deleted = true;
      row.updatedAt = ts;
      await db.species.put(row);
      emitMutation('species', v, 'delete', row);
    }
  }
  return changed;
}

/** Rewrite every observation using one of `variants` as its location name to
 * `canonical`, keeping the first available coordinates among the merged
 * rows, then drop the variant rows from the locations master list.
 * Returns how many observations were updated. */
export async function mergeLocationNames(variants: string[], canonical: string): Promise<number> {
  canonical = canonical.trim();
  const toMerge = new Set(variants.filter((v) => v !== canonical));
  if (!toMerge.size) return 0;
  let changed = 0;
  const all = await db.observations.toArray();
  for (const o of all) {
    if (o.deleted) continue;
    if (toMerge.has(o.locationName)) {
      o.locationName = canonical;
      o.updatedAt = now();
      await db.observations.put(o);
      emitMutation('observation', o.id, 'upsert', o);
      changed++;
    }
  }
  const canonicalRow = await db.locations.get(canonical);
  let lat = canonicalRow?.lat ?? null;
  let lng = canonicalRow?.lng ?? null;
  if (lat == null || lng == null) {
    for (const v of toMerge) {
      const row = await db.locations.get(v);
      if (row?.lat != null && row?.lng != null) { lat = row.lat; lng = row.lng; break; }
    }
  }
  // See the note in mergeSpeciesNames() — deliberately no emitChange() here either;
  // deleteLocation() already doesn't emit, keeping this a quiet batch operation.
  const mergedRow: LocationRow = { name: canonical, lat, lng, updatedAt: now(), deleted: false };
  await db.locations.put(mergedRow);
  emitMutation('location', canonical, 'upsert', mergedRow);
  for (const v of toMerge) {
    const row = await db.locations.get(v);
    if (row && !row.deleted) await deleteLocation(v);
  }
  return changed;
}

/** Rewrite every observation using one of `variants` as its project name to
 * `canonical` (also used for a plain rename, passing a single-item variants
 * array), then drop the variant rows from the projects master list.
 * Returns how many observations were updated. */
export async function mergeProjectNames(variants: string[], canonical: string): Promise<number> {
  canonical = canonical.trim();
  const toMerge = new Set(variants.filter((v) => v !== canonical));
  if (!toMerge.size) return 0;
  let changed = 0;
  const all = await db.observations.toArray();
  for (const o of all) {
    if (o.deleted) continue;
    if (toMerge.has(o.project)) {
      o.project = canonical;
      o.updatedAt = now();
      await db.observations.put(o);
      emitMutation('observation', o.id, 'upsert', o);
      changed++;
    }
  }
  const ts = now();
  const canonicalRow = await db.projects.get(canonical);
  if (!canonicalRow || canonicalRow.deleted) {
    const row: ProjectRow = { name: canonical, updatedAt: ts, deleted: false };
    await db.projects.put(row);
    emitMutation('project', canonical, 'upsert', row);
  }
  for (const v of toMerge) {
    const row = await db.projects.get(v);
    if (row && !row.deleted) {
      row.deleted = true;
      row.updatedAt = ts;
      await db.projects.put(row);
      emitMutation('project', v, 'delete', row);
    }
  }
  return changed;
}

/* ---------- media ---------- */

export async function saveMedia(media: MediaRecord): Promise<MediaRecord> {
  let rec = media.addedAt ? media : { ...media, addedAt: now() };
  // Only stamped when the caller didn't already provide one — a remote sync
  // merge passes the origin device's own updatedAt through unchanged so
  // last-write-wins comparisons stay meaningful; a genuine local edit (new
  // upload, species tag, etc.) has none yet and gets a fresh timestamp here.
  rec = rec.updatedAt ? rec : { ...rec, updatedAt: now() };
  await db.media.put(rec);
  // A photo already tied to an observation is synced as part of that
  // observation's own save (pushObservationMedia) — only a "orphan" Gallery
  // upload (not yet attached to anything) needs its own mutation, since
  // nothing else would otherwise ever tell Firebase it exists.
  if (!rec.obsId) emitMutation('media', rec.id, 'upsert', rec);
  return rec;
}
export function getMedia(id: string): Promise<MediaRecord | undefined> {
  return db.media.get(id);
}
export function mediaForObservation(obsId: string): Promise<MediaRecord[]> {
  return db.media.where('obsId').equals(obsId).toArray();
}
export async function deleteMedia(id: string): Promise<void> {
  await db.media.delete(id);
}

/** Every photo blob ever saved — every observation's photo (past and
 * present, camera-captured or bulk photo-imported) already lives in this
 * same table, so the Gallery tab is just this list rendered as a grid; no
 * separate migration step is needed to "bring legacy photos into" it. Rows
 * with `obsId === ''` are photos uploaded straight into the Gallery that
 * haven't been attached to an observation yet. */
export function listAllMedia(): Promise<MediaRecord[]> {
  return db.media.toArray();
}

/** Deletes a photo blob and, if it was attached to an observation, also
 * removes the dangling reference from that observation's species entry —
 * so the Gallery's delete action can be used on any photo, associated or
 * not, without leaving a broken image behind in the journal. */
export async function deleteMediaAndUnlink(id: string): Promise<void> {
  const media = await db.media.get(id);
  await db.media.delete(id);
  if (media && !media.obsId) emitMutation('media', id, 'delete', { ...media, deleted: true, updatedAt: now() });
  if (!media?.obsId) return;
  const obs = await getObservation(media.obsId);
  if (!obs) return;
  let changed = false;
  const entries = entriesOf(obs).map((e) => {
    if (!e.images?.some((i) => i.localId === id)) return e;
    changed = true;
    return { ...e, images: e.images.filter((i) => i.localId !== id) };
  });
  if (changed) await saveObservation({ ...obs, entries, updatedAt: '' });
}

/** Attaches an already-saved ("orphan") gallery photo to one of an
 * observation's species entries (`entryIndex`, defaulting to the first — the
 * same slot the bulk photo-import flow uses) and claims it (sets its
 * `obsId`) so it stops showing as unassociated. A no-op if the photo is
 * already attached to this observation. */
export async function associateMediaWithObservation(mediaId: string, obsId: string, entryIndex = 0): Promise<void> {
  const media = await db.media.get(mediaId);
  const obs = await getObservation(obsId);
  const entries = obs ? entriesOf(obs) : [];
  const entry = entries[entryIndex];
  if (!media || !entry) return;
  if (!media.obsId) {
    await db.media.put({ ...media, obsId });
    // Once associated, this photo is tracked via the observation's own
    // entries (synced generically as part of that document) instead of the
    // separate orphan-photo `media` Firestore collection — tell Firestore to
    // drop it from there too. Skipping this leaves a *stale* copy of this
    // exact bug on any other device that had already downloaded the photo
    // as an orphan: its local media row never learns `obsId` was set (only
    // this device's own row does, above), so its Gallery keeps showing the
    // photo as unassociated forever even though it's genuinely tied to an
    // observation now. Mirrors the same cleanup deleteMediaAndUnlink already
    // does on outright deletion — `media` here (obsId still '') is exactly
    // what pushMedia needs to accept the delete (it refuses anything with
    // obsId set, since that's meant to be pushed via pushObservationMedia).
    emitMutation('media', mediaId, 'delete', { ...media, deleted: true, updatedAt: now() });
  }
  const images = entry.images ?? [];
  if (images.some((i) => i.localId === mediaId)) return;
  // Carry over remoteId when the orphan photo was already uploaded to
  // Firebase Storage — otherwise pushObservationMedia sees a bare `localId`
  // with no known remote URL and needlessly re-uploads the same blob to the
  // exact same Storage path it's already sitting at.
  const newEntries = entries.map((e, i) => (i === entryIndex ? { ...e, images: [...images, { localId: mediaId, name: media.name, remoteId: media.remoteId }] } : e));
  await saveObservation({ ...obs!, entries: newEntries, updatedAt: '' });
}

/** Removes one image reference from whichever entry of `obsId` has it
 * (normally just one) — used to clean up a permanently broken reference (no
 * local blob, no working Storage URL) from the species/observation views.
 * Unlike deleteMediaAndUnlink, this doesn't need a local media row to exist
 * at all to know which observation to touch, since the caller already knows
 * — the species tab's aggregated photo list tracks each image's `obsId`
 * directly. Also deletes the underlying media row if one still happens to
 * exist, same cleanup deleteMediaAndUnlink does. */
export async function removeBrokenObservationImage(obsId: string, localId: string): Promise<void> {
  const obs = await getObservation(obsId);
  if (obs) {
    let changed = false;
    const entries = entriesOf(obs).map((e) => {
      if (!e.images?.some((i) => i.localId === localId)) return e;
      changed = true;
      return { ...e, images: e.images.filter((i) => i.localId !== localId) };
    });
    if (changed) await saveObservation({ ...obs, entries, updatedAt: '' });
  }
  const media = await db.media.get(localId);
  if (media) {
    await db.media.delete(localId);
    if (!media.obsId) emitMutation('media', localId, 'delete', { ...media, deleted: true, updatedAt: now() });
  }
}

/** Claims an orphan ("not yet associated") gallery photo for an observation
 * — used by the observation form's "בחירה מהגלריה" picker (lib/photo-picker.ts),
 * which attaches a batch of already-uploaded photos directly rather than
 * going through associateMediaWithObservation's single-entry flow. Same
 * Firestore cleanup as that function: dropping this photo from the separate
 * orphan-photo collection once it's tracked via the observation itself, so
 * another device that already downloaded it as an orphan doesn't keep
 * showing it as unassociated forever. */
export async function claimOrphanMedia(media: MediaRecord, obsId: string): Promise<void> {
  const wasOrphan = !media.obsId;
  await saveMedia({ ...media, obsId });
  if (wasOrphan) emitMutation('media', media.id, 'delete', { ...media, deleted: true, updatedAt: now() });
}

/** Finds an already-saved media row with the exact same content hash, if
 * any — used by the Gallery's upload button to skip saving a duplicate
 * blob when the same photo is uploaded again. */
export async function findMediaByHash(hash: string): Promise<MediaRecord | undefined> {
  return db.media.where('contentHash').equals(hash).first();
}

/** Repairs a historical gap: before a fix shipped, associating an
 * already-uploaded Gallery photo with an observation (associateMediaWithObservation)
 * didn't copy the photo's `remoteId` onto the new `ObservationImage` it created
 * — only the media row itself kept it. On the device that made the
 * association this went unnoticed (its local blob still resolves the image
 * fine), but on any device that doesn't have that blob locally, the image
 * has neither a blob nor a known Storage URL and can never be shown. Backfills
 * `remoteId` from the (already-local) media row wherever the entry is
 * missing it — pure local data cleanup, no network access. Returns how many
 * images were fixed. */
export async function repairMissingImageLinks(): Promise<number> {
  let fixed = 0;
  for (const obs of await listObservationsRaw()) {
    if (obs.deleted) continue;
    let changed = false;
    const entries = await Promise.all(entriesOf(obs).map(async (entry) => {
      if (!entry.images?.length) return entry;
      const images = await Promise.all(entry.images.map(async (img) => {
        if (!img.localId || img.remoteId) return img;
        const media = await db.media.get(img.localId);
        if (!media?.remoteId) return img;
        changed = true;
        fixed++;
        return { ...img, remoteId: media.remoteId };
      }));
      return { ...entry, images };
    }));
    if (changed) await saveObservation({ ...obs, entries, updatedAt: '' });
  }
  return fixed;
}

/* ---------- settings ---------- */

export async function getSetting<T = unknown>(key: string, fallback: T): Promise<T> {
  const row = await db.settings.get(key);
  return row ? (row.value as T) : fallback;
}
export async function setSetting<T = unknown>(key: string, value: T): Promise<void> {
  await db.settings.put({ key, value });
}

/* ---------- maintenance ---------- */

export async function clearAllData(): Promise<void> {
  await db.observations.clear();
  await db.media.clear();
  await db.outbox.clear();
  emitChange();
}
