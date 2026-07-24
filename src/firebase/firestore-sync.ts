/* firebase/firestore-sync.ts — optional two-way sync backend using
 * Firestore + Storage, selected in Settings by entering a shared
 * "household code" (instead of, or alongside, the Cloudflare server
 * URL/token). Unlike the polling/outbox-based Cloudflare sync, this pushes
 * every local mutation live and listens for remote changes in real time;
 * conflicts are resolved last-write-wins by `updatedAt`, same policy as the
 * rest of the app. */

import {
  collection, doc, setDoc, onSnapshot, getDocs, query, limit, type Unsubscribe, type QuerySnapshot, type DocumentData,
} from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL, getBytes } from 'firebase/storage';
import { firebaseDb, firebaseStorage } from './app';
import {
  onMutation, getSetting, setSetting,
  listObservationsRaw, putObservationRaw, getObservation,
  listSpeciesRows, putSpeciesRaw, getSpeciesRaw,
  listLocationRows, putLocationRaw, getLocationRaw,
  listProjectRows, putProjectRaw, getProjectRaw,
  listFilesRaw, putFileRaw, getFile,
  getMedia,
  type MutationEntity, type MutationOp,
} from '../db/repository';
import type { Observation, SpeciesRow, LocationRow, ProjectRow, StoredFile } from '../types';

const COLLECTION_BY_ENTITY: Record<MutationEntity, string> = {
  observation: 'observations',
  species: 'species',
  location: 'locations',
  project: 'projects',
  file: 'files',
};

/** The `files` Firestore collection only ever holds this shape — the blob
 * itself lives in Storage (uploaded/fetched by id), same split as observation
 * photos. */
interface StoredFileMeta {
  id: string;
  name: string;
  kind: StoredFile['kind'];
  mime: string;
  createdAt: string;
  updatedAt: string;
  deleted: boolean;
}

let activeCode: string | null = null;
let unsubs: Unsubscribe[] = [];
let stopMutationListener: (() => void) | null = null;

/* ---------- real-time sync status, for the topbar indicator and Settings ----------
 * Driven by Firestore's own `metadata.hasPendingWrites` (set on each of the
 * three collection listeners below via includeMetadataChanges), not by our
 * own push calls — with the persistent offline cache enabled, setDoc()
 * resolves as soon as the write lands in the local cache, so timing our own
 * calls would report "synced" even while genuinely offline. `pending` means
 * there is at least one local write not yet acknowledged by the server:
 * combined with connectivity, that's what tells the topbar whether to spin
 * (actively flushing), show a quiet "pending" badge (queued, offline), or
 * just sit at a static "synced" icon. */

export type FirebaseSyncState = 'disabled' | 'offline' | 'syncing' | 'idle' | 'error';
export interface FirebaseSyncStatus { state: FirebaseSyncState; pending: boolean; lastSync: string | null; message?: string }

let status: FirebaseSyncStatus = { state: 'disabled', pending: false, lastSync: null };
const statusListeners = new Set<(s: FirebaseSyncStatus) => void>();

function setStatus(patch: Partial<FirebaseSyncStatus>): void {
  status = { ...status, ...patch };
  for (const fn of statusListeners) fn(status);
}

export function onFirebaseSyncStatus(fn: (s: FirebaseSyncStatus) => void): () => void {
  statusListeners.add(fn);
  fn(status);
  return () => statusListeners.delete(fn);
}

export function getFirebaseSyncStatus(): FirebaseSyncStatus {
  return status;
}

let pendingObs = false;
let pendingSpecies = false;
let pendingLocations = false;
let pendingProjects = false;
let pendingFiles = false;

/** Recomputes the derived state from the last-known pending-writes flags and
 * live connectivity — called whenever either changes. */
function recomputeStatus(): void {
  if (!activeCode) { setStatus({ state: 'disabled', pending: false }); return; }
  const pending = pendingObs || pendingSpecies || pendingLocations || pendingProjects || pendingFiles;
  if (!navigator.onLine) { setStatus({ state: 'offline', pending }); return; }
  setStatus({ state: pending ? 'syncing' : 'idle', pending, lastSync: pending ? status.lastSync : new Date().toISOString() });
}

window.addEventListener('online', recomputeStatus);
window.addEventListener('offline', recomputeStatus);

/** Reentrant guard: while >0, our own writes (initial seed push, remote
 * merges, media-URL patch-ups) must not bounce back out through the
 * local-mutation listener as if the user had just made that change. */
let suppressDepth = 0;
async function withSuppressedPush<T>(fn: () => Promise<T>): Promise<T> {
  suppressDepth++;
  try {
    return await fn();
  } finally {
    suppressDepth--;
  }
}

function sanitize<T>(value: T): T {
  // Firestore rejects `undefined` fields; this also strips functions/etc.
  return JSON.parse(JSON.stringify(value)) as T;
}

export async function getFirebaseSyncCode(): Promise<string> {
  return getSetting<string>('firebaseSyncCode', '');
}

export function isFirebaseSyncActive(): boolean {
  return !!activeCode;
}

export async function configureFirebaseSync(rawCode: string): Promise<void> {
  const code = rawCode.trim();
  await setSetting('firebaseSyncCode', code);
  stopFirebaseSync();
  if (code) await startFirebaseSync(code);
}

/** Call once at app startup to resume a previously-configured sync. */
export async function initFirebaseSyncFromSettings(): Promise<void> {
  const code = await getFirebaseSyncCode();
  if (code) await startFirebaseSync(code);
}

/** One-time manual recovery: unconditionally overwrites this device's local
 * species/locations/projects with whatever is currently in the cloud,
 * bypassing the usual last-write-wins timestamp check. Normal sync should
 * never need this, but a device whose local copy of one of these master
 * lists got a stale-but-fresher-looking timestamp (e.g. from a species-seed
 * reset) can otherwise keep silently rejecting real edits/deletions made on
 * another device forever — this lets the user force this device back in
 * line with the shared cloud state on demand. */
export async function forceResyncListsFromCloud(): Promise<{ species: number; locations: number; projects: number }> {
  if (!activeCode) throw new Error('סנכרון Firebase אינו מופעל');
  const db = firebaseDb();
  const counts = { species: 0, locations: 0, projects: 0 };
  await withSuppressedPush(async () => {
    const speciesSnap = await getDocs(collection(db, 'households', activeCode!, 'species'));
    for (const d of speciesSnap.docs) { await putSpeciesRaw(d.data() as SpeciesRow); counts.species++; }
    const locationsSnap = await getDocs(collection(db, 'households', activeCode!, 'locations'));
    for (const d of locationsSnap.docs) { await putLocationRaw(d.data() as LocationRow); counts.locations++; }
    const projectsSnap = await getDocs(collection(db, 'households', activeCode!, 'projects'));
    for (const d of projectsSnap.docs) { await putProjectRaw(d.data() as ProjectRow); counts.projects++; }
  });
  return counts;
}

export function stopFirebaseSync(): void {
  unsubs.forEach((u) => u());
  unsubs = [];
  stopMutationListener?.();
  stopMutationListener = null;
  activeCode = null;
  pendingObs = pendingSpecies = pendingLocations = pendingProjects = pendingFiles = false;
  setStatus({ state: 'disabled', pending: false, message: undefined });
}

async function startFirebaseSync(code: string): Promise<void> {
  activeCode = code;
  const db = firebaseDb();

  // One-time initial full push per code — anything created locally before
  // Firebase was configured (or while offline) needs to reach the cloud too.
  // Remote listeners below bring in whatever the *other* device already has.
  // Only runs once (not on every app boot) to stay well within Firestore's
  // free-tier write quota; ongoing changes are pushed live via onMutation.
  // This is the one phase we mark 'syncing' explicitly — the metadata-driven
  // listeners below aren't attached yet to observe it themselves.
  const seedFlagKey = `firebaseSeeded_${code}`;
  const isFirstSeed = !(await getSetting<boolean>(seedFlagKey, false));
  if (isFirstSeed) {
    setStatus({ state: navigator.onLine ? 'syncing' : 'offline', pending: true, message: undefined });
    try {
      await withSuppressedPush(async () => {
        for (const o of await listObservationsRaw()) await pushDoc('observations', o.id, o);
        // Species (unlike observations/locations/projects) come from a
        // bundled app seed list that can get silently reset on this device
        // (seedSpeciesIfEmpty, e.g. after a reinstall or a bundled-list
        // version bump) — freshly re-seeded rows carry a "just now"
        // updatedAt that would always win a last-write-wins merge, silently
        // clobbering or reviving species another device deliberately edited
        // or removed. If this household already has a species list in the
        // cloud, it's the authoritative one — let the pull-side listener
        // bring it down instead of pushing this device's local copy over it.
        const remoteSpeciesSnap = await getDocs(query(collection(db, 'households', code, 'species'), limit(1)));
        if (remoteSpeciesSnap.empty) {
          for (const s of await listSpeciesRows()) await pushDoc('species', s.name, s);
        }
        for (const l of await listLocationRows()) await pushDoc('locations', l.name, l);
        for (const p of await listProjectRows()) await pushDoc('projects', p.name, p);
        // Photo upload (Storage) is best-effort and optional — a project that
        // hasn't enabled Storage yet (e.g. still on the free Spark plan) must
        // not lose text-data sync (Firestore) just because photos can't upload.
        for (const o of await listObservationsRaw()) {
          try { await pushObservationMedia(o); } catch (err) { console.warn('Firebase: photo sync skipped', err); }
        }
        for (const f of await listFilesRaw()) {
          try { await pushFile(f); } catch (err) { console.warn('Firebase: file sync skipped', err); }
        }
      });
      await setSetting(seedFlagKey, true);
    } catch (err) {
      setStatus({ state: 'error', message: (err as Error).message });
    }
  }

  const onSnapError = (err: Error): void => {
    setStatus({ state: navigator.onLine ? 'error' : 'offline', message: err.message });
  };
  unsubs.push(onSnapshot(collection(db, 'households', code, 'observations'), { includeMetadataChanges: true }, (snap: QuerySnapshot<DocumentData>) => {
    pendingObs = snap.metadata.hasPendingWrites;
    snap.docChanges().forEach((change) => {
      if (change.type === 'removed') return;
      void mergeRemoteObservation(change.doc.data() as Observation);
    });
    recomputeStatus();
  }, onSnapError));
  unsubs.push(onSnapshot(collection(db, 'households', code, 'species'), { includeMetadataChanges: true }, (snap: QuerySnapshot<DocumentData>) => {
    pendingSpecies = snap.metadata.hasPendingWrites;
    snap.docChanges().forEach((change) => {
      if (change.type === 'removed') return;
      void mergeRemoteSpecies(change.doc.data() as SpeciesRow);
    });
    recomputeStatus();
  }, onSnapError));
  unsubs.push(onSnapshot(collection(db, 'households', code, 'locations'), { includeMetadataChanges: true }, (snap: QuerySnapshot<DocumentData>) => {
    pendingLocations = snap.metadata.hasPendingWrites;
    snap.docChanges().forEach((change) => {
      if (change.type === 'removed') return;
      void mergeRemoteLocation(change.doc.data() as LocationRow);
    });
    recomputeStatus();
  }, onSnapError));
  unsubs.push(onSnapshot(collection(db, 'households', code, 'projects'), { includeMetadataChanges: true }, (snap: QuerySnapshot<DocumentData>) => {
    pendingProjects = snap.metadata.hasPendingWrites;
    snap.docChanges().forEach((change) => {
      if (change.type === 'removed') return;
      void mergeRemoteProject(change.doc.data() as ProjectRow);
    });
    recomputeStatus();
  }, onSnapError));
  unsubs.push(onSnapshot(collection(db, 'households', code, 'files'), { includeMetadataChanges: true }, (snap: QuerySnapshot<DocumentData>) => {
    pendingFiles = snap.metadata.hasPendingWrites;
    snap.docChanges().forEach((change) => {
      if (change.type === 'removed') return;
      void mergeRemoteFile(change.doc.data() as StoredFileMeta);
    });
    recomputeStatus();
  }, onSnapError));

  stopMutationListener = onMutation((entity, id, op, payload) => {
    if (suppressDepth > 0 || !activeCode) return;
    void handleLocalMutation(entity, id, op, payload);
  });
}

async function handleLocalMutation(entity: MutationEntity, id: string, _op: MutationOp, payload: unknown): Promise<void> {
  try {
    if (entity === 'file') {
      await pushFile(payload as StoredFile);
      return;
    }
    await pushDoc(COLLECTION_BY_ENTITY[entity], id, payload);
    if (entity === 'observation') {
      try { await pushObservationMedia(payload as Observation); } catch (err) { console.warn('Firebase: photo sync skipped', err); }
    }
  } catch (err) {
    setStatus({ state: navigator.onLine ? 'error' : 'offline', message: (err as Error).message });
  }
}

/** Species/location names can contain characters Firestore treats specially
 * in a document path — most notably "/", which would otherwise split the ID
 * into extra path segments and break the reference. Observation ids are
 * random UUIDs and pass through unchanged. The original, unencoded name is
 * still stored in the document's own data, so reads are unaffected. */
function docSafeId(id: string): string {
  return encodeURIComponent(id);
}

async function pushDoc(col: string, id: string, data: unknown): Promise<void> {
  if (!activeCode) return;
  await setDoc(doc(firebaseDb(), 'households', activeCode, col, docSafeId(id)), sanitize(data) as Record<string, unknown>);
}

/** Uploads any of this observation's photos that haven't reached Firebase
 * Storage yet, stamps their download URL back onto the (already-local)
 * image entries, and re-pushes the observation so other devices get the URL. */
async function pushObservationMedia(obs: Observation): Promise<void> {
  if (!activeCode || !Array.isArray(obs.entries)) return;
  let touched = false;
  for (const entry of obs.entries) {
    if (!Array.isArray(entry.images)) continue;
    for (const img of entry.images) {
      if (img.remoteId?.startsWith('http')) continue; // already uploaded to Firebase
      const media = await getMedia(img.localId);
      if (!media?.blob) continue;
      try {
        const path = `households/${activeCode}/media/${img.localId}`;
        await uploadBytes(ref(firebaseStorage(), path), media.blob, { contentType: media.mime || 'application/octet-stream' });
        img.remoteId = await getDownloadURL(ref(firebaseStorage(), path));
        touched = true;
      } catch (err) {
        // Storage not enabled yet, offline, etc. — leave this image for a
        // later retry (next mutation/app start) without failing the rest.
        console.warn('Firebase: could not upload photo', img.localId, err);
      }
    }
  }
  if (touched) {
    await withSuppressedPush(async () => {
      await putObservationRaw(obs);
      await pushDoc('observations', obs.id, obs);
    });
  }
}

async function mergeRemoteObservation(remote: Observation): Promise<void> {
  const local = await getObservation(remote.id);
  if (local && new Date(local.updatedAt) >= new Date(remote.updatedAt)) return;
  await withSuppressedPush(() => putObservationRaw(remote));
}

async function mergeRemoteSpecies(remote: SpeciesRow): Promise<void> {
  const local = await getSpeciesRaw(remote.name);
  if (local && new Date(local.updatedAt) >= new Date(remote.updatedAt)) return;
  await withSuppressedPush(() => putSpeciesRaw(remote));
}

async function mergeRemoteLocation(remote: LocationRow): Promise<void> {
  const local = await getLocationRaw(remote.name);
  if (local && new Date(local.updatedAt) >= new Date(remote.updatedAt)) return;
  await withSuppressedPush(() => putLocationRaw(remote));
}

async function mergeRemoteProject(remote: ProjectRow): Promise<void> {
  const local = await getProjectRaw(remote.name);
  if (local && new Date(local.updatedAt) >= new Date(remote.updatedAt)) return;
  await withSuppressedPush(() => putProjectRaw(remote));
}

/** Uploads a StoredFile's blob to Storage (same as observation photos) and
 * pushes its metadata (everything except the blob) to Firestore. A deleted
 * tombstone has no blob to upload — it's just the metadata push. */
async function pushFile(file: StoredFile): Promise<void> {
  if (!activeCode) return;
  const meta: StoredFileMeta = {
    id: file.id, name: file.name, kind: file.kind, mime: file.mime,
    createdAt: file.createdAt, updatedAt: file.updatedAt, deleted: !!file.deleted,
  };
  if (!file.deleted && file.blob) {
    try {
      const path = `households/${activeCode}/files/${file.id}`;
      await uploadBytes(ref(firebaseStorage(), path), file.blob, { contentType: file.mime || 'application/octet-stream' });
    } catch (err) {
      // Storage not enabled yet, offline, etc. — leave this file for a later
      // retry (next mutation/app start) rather than pushing metadata that
      // claims a blob other devices can't actually fetch yet.
      console.warn('Firebase: could not upload file', file.id, err);
      return;
    }
  }
  await pushDoc('files', file.id, meta);
}

async function mergeRemoteFile(remote: StoredFileMeta): Promise<void> {
  const local = await getFile(remote.id);
  if (local && new Date(local.updatedAt) >= new Date(remote.updatedAt)) return;
  if (remote.deleted) {
    await withSuppressedPush(() => putFileRaw({ ...remote, blob: undefined }));
    return;
  }
  if (!activeCode) return;
  try {
    const path = `households/${activeCode}/files/${remote.id}`;
    const bytes = await getBytes(ref(firebaseStorage(), path));
    const blob = new Blob([bytes], { type: remote.mime || 'application/octet-stream' });
    await withSuppressedPush(() => putFileRaw({ ...remote, blob }));
  } catch (err) {
    // Blob not uploaded yet (metadata can arrive slightly ahead of the
    // Storage write) or offline — will retry on the next remote update.
    console.warn('Firebase: could not download file', remote.id, err);
  }
}
