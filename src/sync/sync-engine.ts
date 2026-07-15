/* sync/sync-engine.ts — offline-first synchronization.
 *
 * Push: drains the outbox to the server.
 * Pull: applies server changes since the last cursor, using last-write-wins
 *       (a remote row only overwrites a local one when its updatedAt is newer),
 *       so unsynced local edits are never clobbered. Soft-delete tombstones
 *       propagate in both directions.
 *
 * Triggers: app start, the `online` event, tab becoming visible, a debounced
 * call after each local mutation, a periodic timer, and a `sync-now` message
 * from the service worker's Background Sync handler.
 */

import {
  listOutbox,
  removeOutbox,
  countPending,
  getObservation,
  putObservationRaw,
  putSpeciesRaw,
  getSetting,
  setSetting,
} from '../db/repository';
import { db } from '../db/database';
import { postSync, uploadMedia, type PushOp } from './api-client';
import type { Observation, SpeciesRow, SyncStatus } from '../types';

const PERIODIC_MS = 60_000;

type StatusListener = (s: SyncStatus) => void;
const statusListeners = new Set<StatusListener>();
let status: SyncStatus = { state: 'disabled', pending: 0, lastSync: null };
let running = false;
let rerun = false;
let periodic: ReturnType<typeof setInterval> | undefined;

export function onSyncStatus(fn: StatusListener): () => void {
  statusListeners.add(fn);
  fn(status);
  return () => statusListeners.delete(fn);
}

async function setStatus(patch: Partial<SyncStatus>): Promise<void> {
  status = { ...status, ...patch, pending: await countPending() };
  for (const fn of statusListeners) fn(status);
}

export function getStatus(): SyncStatus {
  return status;
}

async function deviceId(): Promise<string> {
  let id = await getSetting<string>('deviceId', '');
  if (!id) {
    id = crypto.randomUUID();
    await setSetting('deviceId', id);
  }
  return id;
}

export async function serverUrl(): Promise<string> {
  return getSetting<string>('syncServerUrl', '');
}

export async function syncToken(): Promise<string> {
  return getSetting<string>('syncToken', '');
}

export async function isSyncEnabled(): Promise<boolean> {
  return !!(await serverUrl());
}

/** Upload photo blobs not yet on the server, and stamp their remoteId onto the
 * owning observation's image refs so the reference propagates on the next push. */
async function uploadLocalMedia(base: string, token: string): Promise<void> {
  const pending = (await db.media.toArray()).filter((m) => !m.remoteId);
  for (const m of pending) {
    try {
      await uploadMedia(base, token, m.id, m.blob);
    } catch {
      // photo storage (R2) not enabled, or a transient upload error — skip the
      // photo but let structured-data sync proceed. It retries next cycle.
      continue;
    }
    m.remoteId = m.id;
    await db.media.put(m);
    const obs = await getObservation(m.obsId);
    if (!obs) continue;
    let changed = false;
    const stamp = (imgs: { localId: string; remoteId?: string | null }[] | undefined): void => {
      for (const img of imgs ?? []) {
        if (img.localId === m.id && !img.remoteId) { img.remoteId = m.id; changed = true; }
      }
    };
    for (const e of obs.entries ?? []) stamp(e.images);
    stamp(obs.images);
    if (changed) await putObservationRaw(obs);
  }
}

/** Newer-wins merge: apply a remote observation only if it is at least as new. */
async function applyRemoteObservation(remote: Observation): Promise<void> {
  const local = await getObservation(remote.id);
  if (!local || (local.updatedAt || '') <= (remote.updatedAt || '')) {
    await putObservationRaw({ ...remote, synced: true });
  }
}

async function applyRemoteSpecies(remote: SpeciesRow): Promise<void> {
  const local = await db.species.get(remote.name);
  if (!local || (local.updatedAt || '') <= (remote.updatedAt || '')) {
    await putSpeciesRaw(remote);
  }
}

/** Run a full sync cycle. Safe to call concurrently — extra calls coalesce. */
export async function syncNow(): Promise<void> {
  const base = await serverUrl();
  if (!base) {
    await setStatus({ state: 'disabled' });
    return;
  }
  if (!navigator.onLine) {
    await setStatus({ state: 'offline' });
    return;
  }
  if (running) {
    rerun = true;
    return;
  }
  running = true;
  try {
    await setStatus({ state: 'syncing', message: undefined });
    const token = await syncToken();

    // 1) upload any new photos to R2 first, so image refs carry a remoteId
    await uploadLocalMedia(base, token);

    // 2) build push ops from the CURRENT entity state (picks up remoteIds and
    //    collapses multiple edits), not the stored outbox snapshots
    const outbox = await listOutbox();
    const ops: PushOp[] = [];
    for (const e of outbox) {
      if (e.entity === 'observation') {
        const cur = await getObservation(e.entityId);
        if (cur) ops.push({ entity: 'observation', op: cur.deleted ? 'delete' : 'upsert', payload: cur });
      } else {
        const cur = await db.species.get(e.entityId);
        if (cur) ops.push({ entity: 'species', op: cur.deleted ? 'delete' : 'upsert', payload: cur });
      }
    }
    const since = await getSetting<string | null>('syncCursor', null);

    const res = await postSync(base, token, { deviceId: await deviceId(), since, ops });

    // apply pulled changes (newer-wins)
    for (const o of res.changes.observations) await applyRemoteObservation(o);
    for (const s of res.changes.species) await applyRemoteSpecies(s);

    // the ops we successfully pushed can be dropped from the outbox
    if (outbox.length) await removeOutbox(outbox.map((e) => e.id));
    // mark pushed observations as synced
    for (const e of outbox) {
      if (e.entity === 'observation') {
        const local = await getObservation(e.entityId);
        if (local && !local.synced) await putObservationRaw({ ...local, synced: true });
      }
    }

    await setSetting('syncCursor', res.cursor);
    const ts = new Date().toISOString();
    await setSetting('lastSync', ts);
    await setStatus({ state: 'idle', lastSync: ts, message: undefined });
  } catch (err) {
    await setStatus({ state: 'error', message: (err as Error).message });
  } finally {
    running = false;
    if (rerun) {
      rerun = false;
      void syncNow();
    }
  }
}

/** Debounced trigger used after local mutations. */
let debounce: ReturnType<typeof setTimeout> | undefined;
export function requestSync(delay = 800): void {
  clearTimeout(debounce);
  debounce = setTimeout(() => void syncNow(), delay);
}

/** Ask the browser to replay the sync in the background when connectivity
 * returns, even if the tab is closed (Background Sync API). */
async function registerBackgroundSync(): Promise<void> {
  try {
    const reg = await navigator.serviceWorker?.ready;
    // @ts-expect-error - SyncManager is not in the default lib types
    await reg?.sync?.register('birds-sync');
  } catch {
    /* Background Sync unsupported — periodic + online fallback still cover it. */
  }
}

/** Wire up all sync triggers. Call once at startup. */
export async function initSync(): Promise<void> {
  await setStatus({ state: (await isSyncEnabled()) ? 'idle' : 'disabled' });

  window.addEventListener('online', () => {
    void syncNow();
  });
  window.addEventListener('offline', () => {
    void setStatus({ state: 'offline' });
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') requestSync(300);
  });
  navigator.serviceWorker?.addEventListener('message', (e: MessageEvent) => {
    if ((e.data as { type?: string })?.type === 'sync-now') void syncNow();
  });

  periodic ??= setInterval(() => {
    if (navigator.onLine) void syncNow();
  }, PERIODIC_MS);

  if (await isSyncEnabled()) {
    await registerBackgroundSync();
    if (navigator.onLine) void syncNow();
  }
}

/** Called from settings when the server URL / token changes. */
export async function reconfigureSync(url: string, token: string): Promise<void> {
  await setSetting('syncServerUrl', url.trim());
  await setSetting('syncToken', token.trim());
  await setStatus({ state: url.trim() ? 'idle' : 'disabled' });
  if (url.trim()) {
    await registerBackgroundSync();
    await syncNow();
  }
}
