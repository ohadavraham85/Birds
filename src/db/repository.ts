/* db/repository.ts — offline-first data access.
 *
 * Every mutation writes to the local Dexie store immediately (so the UI is
 * instant and works offline) and, when it represents user data, enqueues an
 * entry in the outbox for the sync engine to push to the server later.
 * Reads always come from the local store.
 */

import { db } from './database';
import type {
  Observation,
  SpeciesRow,
  MediaRecord,
  OutboxEntry,
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

function now(): string {
  return new Date().toISOString();
}

/* ---------- outbox ---------- */

async function enqueue(
  entity: OutboxEntry['entity'],
  entityId: string,
  op: OutboxEntry['op'],
  payload: OutboxEntry['payload'],
): Promise<void> {
  await db.outbox.add({ entity, entityId, op, payload, createdAt: now() } as OutboxEntry);
}

export function listOutbox(): Promise<OutboxEntry[]> {
  return db.outbox.orderBy('id').toArray();
}
export function countPending(): Promise<number> {
  return db.outbox.count();
}
export async function removeOutbox(ids: number[]): Promise<void> {
  await db.outbox.bulkDelete(ids);
}

/* ---------- observations ---------- */

export interface SaveOptions { sync?: boolean }

export async function saveObservation(
  obs: Observation,
  opts: SaveOptions = {},
): Promise<Observation> {
  const shouldSync = opts.sync ?? !obs.demo;
  obs.updatedAt = now();
  obs.synced = false;
  await db.observations.put(obs);
  if (shouldSync) await enqueue('observation', obs.id, obs.deleted ? 'delete' : 'upsert', obs);
  emitChange();
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

/** Write a row exactly as given, without touching the outbox (used by sync). */
export async function putObservationRaw(obs: Observation): Promise<void> {
  await db.observations.put(obs);
  emitChange();
}

export async function deleteObservation(id: string): Promise<void> {
  const obs = await db.observations.get(id);
  if (!obs) return;
  const media = await mediaForObservation(id);
  for (const m of media) await db.media.delete(m.id);
  if (obs.demo) {
    await db.observations.delete(id); // demo rows never sync — hard delete
  } else {
    obs.deleted = true;
    obs.updatedAt = now();
    obs.synced = false;
    await db.observations.put(obs);
    await enqueue('observation', id, 'delete', obs);
  }
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

export async function addSpecies(name: string, opts: SaveOptions = {}): Promise<boolean> {
  name = String(name || '').trim();
  if (!name) return false;
  const row: SpeciesRow = { name, updatedAt: now(), deleted: false };
  await db.species.put(row);
  if (opts.sync ?? true) await enqueue('species', name, 'upsert', row);
  emitChange();
  return true;
}

export async function speciesExists(name: string): Promise<boolean> {
  const row = await db.species.get(name);
  return !!row && !row.deleted;
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
  await enqueue('species', name, 'upsert', row);
  emitChange();
}

export async function putSpeciesRaw(row: SpeciesRow): Promise<void> {
  await db.species.put(row);
  emitChange();
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
