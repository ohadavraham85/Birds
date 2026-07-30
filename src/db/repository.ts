/* db/repository.ts — offline-first data access. Every mutation writes to the
 * local Dexie store immediately (so the UI is instant and works offline);
 * reads always come from the local store. */

import { db } from './database';
import type { Asset, MaintenanceLog, MediaRecord } from '../types';

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

/* ---------- assets ---------- */

export async function saveAsset(asset: Asset): Promise<Asset> {
  asset.updatedAt = now();
  await db.assets.put(asset);
  emitChange();
  return asset;
}

export function getAsset(id: string): Promise<Asset | undefined> {
  return db.assets.get(id);
}

/** All non-deleted assets. */
export async function listAssets(): Promise<Asset[]> {
  const all = await db.assets.toArray();
  return all.filter((a) => !a.deleted);
}

/** Everything including tombstones — used by backup. */
export function listAssetsRaw(): Promise<Asset[]> {
  return db.assets.toArray();
}

export async function putAssetRaw(asset: Asset): Promise<void> {
  await db.assets.put(asset);
  emitChange();
}

/** Soft-deletes the asset and hard-deletes its media + maintenance log rows
 * (nothing local-only needs a tombstone for those — there is no sync). */
export async function deleteAsset(id: string): Promise<void> {
  const asset = await db.assets.get(id);
  if (!asset) return;
  const media = await mediaForAsset(id);
  for (const m of media) await db.media.delete(m.id);
  const logs = await listMaintenanceForAsset(id);
  for (const l of logs) await db.maintenance.delete(l.id);
  asset.deleted = true;
  asset.updatedAt = now();
  await db.assets.put(asset);
  emitChange();
}

export async function countAssets(): Promise<number> {
  return (await listAssets()).length;
}

/* ---------- maintenance log ---------- */

/** Newest first. */
export async function listMaintenanceForAsset(assetId: string): Promise<MaintenanceLog[]> {
  const all = await db.maintenance.where('assetId').equals(assetId).toArray();
  return all.filter((l) => !l.deleted).sort((a, b) => (a.date < b.date ? 1 : -1));
}

/** All non-deleted maintenance logs across every asset, newest first — used
 * by the home screen's recent-activity feed. */
export async function listMaintenance(): Promise<MaintenanceLog[]> {
  const all = await db.maintenance.toArray();
  return all.filter((l) => !l.deleted).sort((a, b) => (a.date < b.date ? 1 : -1));
}

export function listMaintenanceRaw(): Promise<MaintenanceLog[]> {
  return db.maintenance.toArray();
}

export async function putMaintenanceRaw(log: MaintenanceLog): Promise<void> {
  await db.maintenance.put(log);
  emitChange();
}

/** Saves the log and keeps the parent asset's `lastMaintenanceDate` in sync
 * with the newest non-deleted log for that asset. */
export async function saveMaintenance(log: MaintenanceLog): Promise<MaintenanceLog> {
  log.updatedAt = now();
  await db.maintenance.put(log);
  await syncLastMaintenanceDate(log.assetId);
  emitChange();
  return log;
}

export async function deleteMaintenance(id: string): Promise<void> {
  const log = await db.maintenance.get(id);
  if (!log) return;
  await db.maintenance.delete(id);
  await syncLastMaintenanceDate(log.assetId);
  emitChange();
}

async function syncLastMaintenanceDate(assetId: string): Promise<void> {
  const asset = await db.assets.get(assetId);
  if (!asset) return;
  const logs = await listMaintenanceForAsset(assetId);
  const newest = logs[0]?.date ?? null;
  if (asset.lastMaintenanceDate !== newest) {
    asset.lastMaintenanceDate = newest;
    asset.updatedAt = now();
    await db.assets.put(asset);
  }
}

/* ---------- media ---------- */

export async function saveMedia(media: MediaRecord): Promise<MediaRecord> {
  await db.media.put(media);
  return media;
}
export function getMedia(id: string): Promise<MediaRecord | undefined> {
  return db.media.get(id);
}
export function mediaForAsset(assetId: string): Promise<MediaRecord[]> {
  return db.media.where('assetId').equals(assetId).toArray();
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

/* ---------- data reset ---------- */

export async function clearAllData(): Promise<void> {
  await db.assets.clear();
  await db.maintenance.clear();
  await db.media.clear();
  emitChange();
}
