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
  LocationRow,
  MediaRecord,
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
export type MutationEntity = 'observation' | 'species' | 'location';
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

export async function saveObservation(obs: Observation): Promise<Observation> {
  obs.updatedAt = now();
  await db.observations.put(obs);
  emitChange();
  emitMutation('observation', obs.id, obs.deleted ? 'delete' : 'upsert', obs);
  return obs;
}

export function getObservation(id: string): Promise<Observation | undefined> {
  return db.observations.get(id);
}

/** All non-deleted observations, newest first. */
export async function listObservations(): Promise<Observation[]> {
  const all = await db.observations.toArray();
  return all
    .filter((o) => !o.deleted)
    .sort((a, b) => (a.dateTime < b.dateTime ? 1 : -1));
}

/** Everything including tombstones — used by sync/backup. */
export function listObservationsRaw(): Promise<Observation[]> {
  return db.observations.toArray();
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
  obs.deleted = true;
  obs.updatedAt = now();
  await db.observations.put(obs);
  emitMutation('observation', id, 'delete', obs);
  emitChange();
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
  const ts = now();
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

/* ---------- duplicate detection & merge (species / locations) ----------
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
  if (!canonicalRow || canonicalRow.deleted) {
    const row: SpeciesRow = { name: canonical, updatedAt: ts, deleted: false };
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

/* ---------- media ---------- */

export async function saveMedia(media: MediaRecord): Promise<MediaRecord> {
  await db.media.put(media);
  return media;
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
