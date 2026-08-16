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
import { ref, uploadBytes, getDownloadURL, getBytes, listAll, getMetadata } from 'firebase/storage';
import { firebaseDb, firebaseStorage } from './app';
import {
  onMutation, getSetting, setSetting,
  listObservationsRaw, putObservationRaw, getObservation, normalizeObservation,
  listSpeciesRows, putSpeciesRaw, getSpeciesRaw,
  listLocationRows, putLocationRaw, getLocationRaw,
  listProjectRows, putProjectRaw, getProjectRaw,
  listTagRows, putTagRaw, getTagRaw,
  listObserverRows, putObserverRaw, getObserverRaw,
  listFilesRaw, putFileRaw, getFile,
  listTracksRaw, putTrackRaw, getTrack,
  listSeriesRows, putSeriesRaw, getSeriesRaw,
  getMedia, listAllMedia, saveMedia, deleteMediaAndUnlink,
  type MutationEntity, type MutationOp,
} from '../db/repository';
import type { Observation, SpeciesRow, LocationRow, ProjectRow, TagRow, ObserverRow, StoredFile, ObservationTrack, MediaRecord, SeriesRow } from '../types';

const COLLECTION_BY_ENTITY: Record<MutationEntity, string> = {
  observation: 'observations',
  species: 'species',
  location: 'locations',
  project: 'projects',
  file: 'files',
  tag: 'tags',
  observer: 'observers',
  track: 'tracks',
  media: 'media',
  series: 'series',
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

/** The `media` Firestore collection holds metadata only for "orphan" Gallery
 * photos — ones uploaded straight into the Gallery tab and not (yet) tied to
 * any observation. A photo already attached to an observation is synced as
 * part of that observation's own document instead (see pushObservationMedia);
 * this separate collection exists purely so a standalone upload has
 * somewhere to announce itself, since nothing else references its id. */
interface MediaMeta {
  id: string;
  name: string;
  mime: string;
  addedAt?: string;
  takenAt?: string;
  takenAtSource?: 'exif' | 'file';
  contentHash?: string;
  species?: string;
  updatedAt: string;
  deleted: boolean;
}

/** The `tracks` Firestore collection only holds this lightweight shape —
 * the heavy fields (points/segments/reportPins/previewImage) live in
 * Storage as a JSON blob, same split as files/photos. A GPS track can have
 * thousands of points (one every ~2s for a multi-hour walk), which would
 * risk Firestore's 1MB document size limit if stored inline. */
interface TrackMeta {
  id: string;
  startedAt: string;
  endedAt: string;
  durationMs: number;
  distanceMeters: number;
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
let pendingTags = false;
let pendingObservers = false;
let pendingTracks = false;
let pendingMedia = false;
let pendingSeries = false;

/** Recomputes the derived state from the last-known pending-writes flags and
 * live connectivity — called whenever either changes. */
function recomputeStatus(): void {
  if (!activeCode) { setStatus({ state: 'disabled', pending: false }); return; }
  const pending = pendingObs || pendingSpecies || pendingLocations || pendingProjects || pendingFiles || pendingTags || pendingObservers || pendingTracks || pendingMedia || pendingSeries;
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

export interface StorageUsage {
  bytes: number;
  fileCount: number;
}

/** Sums the actual byte size of every photo currently sitting in this
 * household's Firebase Storage `media` folder — both Gallery-orphan uploads
 * and observation-attached photos live under the same path (see
 * pushObservationMedia/pushMedia above), so this single listing covers all
 * of them. Used by the Gallery tab to show real usage against the Storage
 * quota, rather than an estimate from locally-cached blobs (which can
 * undercount photos synced from other devices but never downloaded to this
 * one). Throws if the listing fails (e.g. Storage rules don't grant `list`
 * on this path) — the caller decides how to surface that. */
export async function getMediaStorageUsage(): Promise<StorageUsage | null> {
  if (!activeCode) return null;
  const listing = await listAll(ref(firebaseStorage(), `households/${activeCode}/media`));
  const metas = await Promise.all(listing.items.map((item) => getMetadata(item)));
  const bytes = metas.reduce((sum, m) => sum + (m.size || 0), 0);
  return { bytes, fileCount: listing.items.length };
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
export async function forceResyncListsFromCloud(): Promise<{ species: number; locations: number; projects: number; tags: number; observers: number; series: number }> {
  if (!activeCode) throw new Error('סנכרון Firebase אינו מופעל');
  const db = firebaseDb();
  const counts = { species: 0, locations: 0, projects: 0, tags: 0, observers: 0, series: 0 };
  await withSuppressedPush(async () => {
    const speciesSnap = await getDocs(collection(db, 'households', activeCode!, 'species'));
    for (const d of speciesSnap.docs) { await putSpeciesRaw(d.data() as SpeciesRow); counts.species++; }
    const locationsSnap = await getDocs(collection(db, 'households', activeCode!, 'locations'));
    for (const d of locationsSnap.docs) { await putLocationRaw(d.data() as LocationRow); counts.locations++; }
    const projectsSnap = await getDocs(collection(db, 'households', activeCode!, 'projects'));
    for (const d of projectsSnap.docs) { await putProjectRaw(d.data() as ProjectRow); counts.projects++; }
    const tagsSnap = await getDocs(collection(db, 'households', activeCode!, 'tags'));
    for (const d of tagsSnap.docs) { await putTagRaw(d.data() as TagRow); counts.tags++; }
    const observersSnap = await getDocs(collection(db, 'households', activeCode!, 'observers'));
    for (const d of observersSnap.docs) { await putObserverRaw(d.data() as ObserverRow); counts.observers++; }
    const seriesSnap = await getDocs(collection(db, 'households', activeCode!, 'series'));
    for (const d of seriesSnap.docs) { await putSeriesRaw(d.data() as SeriesRow); counts.series++; }
  });
  return counts;
}

/** Retries uploading local photos/files to Storage. The automatic upload
 * sweep only ever runs once per device (as part of the one-time initial
 * sync) — so on a household that enabled Storage *after* that first sync
 * already ran (e.g. just upgraded off the free Spark plan), any photos/files
 * saved before then never got a chance to upload and won't retry on their
 * own. Safe to call any time: already-uploaded photos are skipped (matched
 * by remoteId); files have no such flag, so they're simply re-pushed. */
export async function retryMediaUploads(): Promise<{ observations: number; files: number; tracks: number; gallery: number }> {
  if (!activeCode) throw new Error('סנכרון Firebase אינו מופעל');
  let observations = 0;
  for (const o of await listObservationsRaw()) {
    try { await pushObservationMedia(o); observations++; } catch (err) { console.warn('Firebase: photo retry skipped', o.id, err); }
  }
  let files = 0;
  for (const f of await listFilesRaw()) {
    if (f.deleted) continue;
    try { await pushFile(f); files++; } catch (err) { console.warn('Firebase: file retry skipped', f.id, err); }
  }
  let tracks = 0;
  for (const t of await listTracksRaw()) {
    if (t.deleted) continue;
    try { await pushTrack(t); tracks++; } catch (err) { console.warn('Firebase: track retry skipped', t.id, err); }
  }
  let gallery = 0;
  for (const m of await listAllMedia()) {
    if (m.obsId || m.remoteId) continue;
    try { await pushMedia(m); gallery++; } catch (err) { console.warn('Firebase: gallery photo retry skipped', m.id, err); }
  }
  return { observations, files, tracks, gallery };
}

/** Downloads every observation photo that's referenced by a remote download
 * URL (`ObservationImage.remoteId`) but has no local blob yet — the normal
 * gap on any device that never happened to open the specific observation a
 * photo belongs to, since photo downloads are otherwise lazy (only fetched
 * the moment something tries to display that exact image). Lets a device
 * catch its local Gallery up with everything the household has, on demand,
 * without silently downloading a whole photo library on every sync. */
export async function pullAllObservationMedia(): Promise<{ downloaded: number; observations: number }> {
  if (!activeCode) throw new Error('סנכרון Firebase אינו מופעל');
  let downloaded = 0;
  let observations = 0;
  for (const o of await listObservationsRaw()) {
    if (o.deleted || !Array.isArray(o.entries)) continue;
    let touched = false;
    for (const entry of o.entries) {
      if (!Array.isArray(entry.images)) continue;
      for (const img of entry.images) {
        const remoteId = img.remoteId;
        if (!img.localId || !remoteId || !/^https?:\/\//.test(remoteId)) continue;
        const existing = await getMedia(img.localId);
        if (existing?.blob) continue;
        try {
          const blob = await (await fetch(remoteId)).blob();
          await withSuppressedPush(() => saveMedia({
            id: img.localId, obsId: o.id, name: img.name || '', mime: blob.type, blob, remoteId,
          }));
          downloaded++;
          touched = true;
        } catch (err) {
          console.warn('Firebase: could not download photo', img.localId, err);
        }
      }
    }
    if (touched) observations++;
  }
  return { downloaded, observations };
}

/** Re-attempts downloading every "orphan" Gallery photo (the `media`
 * collection — species-tagged photos not tied to any observation) that's
 * missing locally. Normally this only self-heals the next time the sync
 * listeners attach (mergeRemoteMedia below fires once per doc on every
 * fresh connection) — but a Storage upload that lands a moment after its
 * Firestore metadata write, a dropped connection mid-download, or a
 * permissions hiccup can leave a photo with no local row at all until then,
 * so it never shows up anywhere (not even as a broken placeholder) despite
 * being tagged. Safe to call any time: already-present photos are skipped
 * untouched. Returns how many were newly downloaded. */
export async function retryMissingGalleryDownloads(): Promise<number> {
  if (!activeCode) throw new Error('סנכרון Firebase אינו מופעל');
  const snap = await getDocs(collection(firebaseDb(), 'households', activeCode, 'media'));
  let downloaded = 0;
  for (const d of snap.docs) {
    const remote = d.data() as MediaMeta;
    if (remote.deleted || await getMedia(remote.id)) continue;
    await mergeRemoteMedia(remote);
    if (await getMedia(remote.id)) downloaded++;
  }
  return downloaded;
}

export function stopFirebaseSync(): void {
  unsubs.forEach((u) => u());
  unsubs = [];
  stopMutationListener?.();
  stopMutationListener = null;
  activeCode = null;
  pendingObs = pendingSpecies = pendingLocations = pendingProjects = pendingFiles = pendingTags = pendingObservers = pendingTracks = pendingMedia = pendingSeries = false;
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
        for (const t of await listTagRows()) await pushDoc('tags', t.name, t);
        for (const ob of await listObserverRows()) await pushDoc('observers', ob.name, ob);
        for (const s of await listSeriesRows()) await pushDoc('series', s.id, s);
        // Photo upload (Storage) is best-effort and optional — a project that
        // hasn't enabled Storage yet (e.g. still on the free Spark plan) must
        // not lose text-data sync (Firestore) just because photos can't upload.
        for (const o of await listObservationsRaw()) {
          try { await pushObservationMedia(o); } catch (err) { console.warn('Firebase: photo sync skipped', err); }
        }
        for (const f of await listFilesRaw()) {
          try { await pushFile(f); } catch (err) { console.warn('Firebase: file sync skipped', err); }
        }
        for (const t of await listTracksRaw()) {
          try { await pushTrack(t); } catch (err) { console.warn('Firebase: track sync skipped', err); }
        }
        for (const m of await listAllMedia()) {
          if (m.obsId) continue; // covered by pushObservationMedia above
          try { await pushMedia(m); } catch (err) { console.warn('Firebase: gallery photo sync skipped', err); }
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
  unsubs.push(onSnapshot(collection(db, 'households', code, 'tags'), { includeMetadataChanges: true }, (snap: QuerySnapshot<DocumentData>) => {
    pendingTags = snap.metadata.hasPendingWrites;
    snap.docChanges().forEach((change) => {
      if (change.type === 'removed') return;
      void mergeRemoteTag(change.doc.data() as TagRow);
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
  unsubs.push(onSnapshot(collection(db, 'households', code, 'tracks'), { includeMetadataChanges: true }, (snap: QuerySnapshot<DocumentData>) => {
    pendingTracks = snap.metadata.hasPendingWrites;
    snap.docChanges().forEach((change) => {
      if (change.type === 'removed') return;
      void mergeRemoteTrack(change.doc.data() as TrackMeta);
    });
    recomputeStatus();
  }, onSnapError));
  unsubs.push(onSnapshot(collection(db, 'households', code, 'observers'), { includeMetadataChanges: true }, (snap: QuerySnapshot<DocumentData>) => {
    pendingObservers = snap.metadata.hasPendingWrites;
    snap.docChanges().forEach((change) => {
      if (change.type === 'removed') return;
      void mergeRemoteObserver(change.doc.data() as ObserverRow);
    });
    recomputeStatus();
  }, onSnapError));
  unsubs.push(onSnapshot(collection(db, 'households', code, 'media'), { includeMetadataChanges: true }, (snap: QuerySnapshot<DocumentData>) => {
    pendingMedia = snap.metadata.hasPendingWrites;
    snap.docChanges().forEach((change) => {
      if (change.type === 'removed') return;
      void mergeRemoteMedia(change.doc.data() as MediaMeta);
    });
    recomputeStatus();
  }, onSnapError));
  unsubs.push(onSnapshot(collection(db, 'households', code, 'series'), { includeMetadataChanges: true }, (snap: QuerySnapshot<DocumentData>) => {
    pendingSeries = snap.metadata.hasPendingWrites;
    snap.docChanges().forEach((change) => {
      if (change.type === 'removed') return;
      void mergeRemoteSeries(change.doc.data() as SeriesRow);
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
    if (entity === 'track') {
      await pushTrack(payload as ObservationTrack);
      return;
    }
    if (entity === 'media') {
      await pushMedia(payload as MediaRecord & { deleted?: boolean });
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
    // Without bumping updatedAt, other devices' last-write-wins merge check
    // (local.updatedAt >= remote.updatedAt) silently rejects this re-push
    // forever — the photo's new download URL would never actually reach
    // them, even though the upload itself succeeded.
    obs.updatedAt = new Date().toISOString();
    await withSuppressedPush(async () => {
      await putObservationRaw(obs);
      await pushDoc('observations', obs.id, obs);
    });
  }
}

async function mergeRemoteObservation(remote: Observation): Promise<void> {
  const local = await getObservation(remote.id);
  if (local && new Date(local.updatedAt) >= new Date(remote.updatedAt)) return;
  // A doc pushed before the tags feature existed (never edited since) has no
  // `tags` field at all — heal it on the way in so the stored local copy is
  // correct too, not just reads (see repository.ts's normalizeObservation).
  await withSuppressedPush(() => putObservationRaw(normalizeObservation(remote)));
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

async function mergeRemoteTag(remote: TagRow): Promise<void> {
  const local = await getTagRaw(remote.name);
  if (local && new Date(local.updatedAt) >= new Date(remote.updatedAt)) return;
  await withSuppressedPush(() => putTagRaw(remote));
}

async function mergeRemoteObserver(remote: ObserverRow): Promise<void> {
  const local = await getObserverRaw(remote.name);
  if (local && new Date(local.updatedAt) >= new Date(remote.updatedAt)) return;
  await withSuppressedPush(() => putObserverRaw(remote));
}

async function mergeRemoteSeries(remote: SeriesRow): Promise<void> {
  const local = await getSeriesRaw(remote.id);
  if (local && new Date(local.updatedAt) >= new Date(remote.updatedAt)) return;
  await withSuppressedPush(() => putSeriesRaw(remote));
}

/** Uploads an "orphan" Gallery photo's blob to Storage and pushes its
 * metadata to Firestore's `media` collection, so a photo uploaded straight
 * into the Gallery (not yet attached to any observation) actually reaches
 * other devices — previously this only happened once a photo was linked to
 * an observation. A photo that's already attached is skipped (`media.obsId`
 * set) since it's synced as part of that observation's own document instead. */
async function pushMedia(media: MediaRecord & { deleted?: boolean }): Promise<void> {
  if (!activeCode || media.obsId) return;
  const meta: MediaMeta = {
    id: media.id, name: media.name, mime: media.mime,
    addedAt: media.addedAt, takenAt: media.takenAt, takenAtSource: media.takenAtSource,
    contentHash: media.contentHash, species: media.species,
    updatedAt: media.updatedAt || new Date().toISOString(), deleted: !!media.deleted,
  };
  // Once uploaded, only the metadata doc needs pushing again on further edits
  // (e.g. tagging a species onto it later) — re-uploading the same blob would
  // be redundant.
  if (!media.deleted && !media.remoteId) {
    if (!media.blob) return;
    try {
      const path = `households/${activeCode}/media/${media.id}`;
      await uploadBytes(ref(firebaseStorage(), path), media.blob, { contentType: media.mime || 'application/octet-stream' });
      const url = await getDownloadURL(ref(firebaseStorage(), path));
      await withSuppressedPush(() => saveMedia({ ...media, remoteId: url }));
    } catch (err) {
      // Storage not enabled yet, offline, etc. — leave this photo for a
      // later retry rather than pushing metadata pointing at a blob other
      // devices can't actually fetch yet.
      console.warn('Firebase: could not upload gallery photo', media.id, err);
      return;
    }
  }
  await pushDoc('media', media.id, meta);
}

async function mergeRemoteMedia(remote: MediaMeta): Promise<void> {
  const local = await getMedia(remote.id);
  if (remote.deleted) {
    // Only remove it if this device still has it as an orphan too — if it's
    // since been attached to an observation here, that association (and any
    // future deletion of it) is this device's own business from now on.
    if (local && !local.obsId) await withSuppressedPush(() => deleteMediaAndUnlink(remote.id));
    return;
  }
  if (!activeCode) return;
  if (local) {
    if (local.obsId) return; // associated locally since — its own business now, not this collection's
    if (local.updatedAt && new Date(local.updatedAt) >= new Date(remote.updatedAt)) return; // local is newer/equal
    // Blob is already present locally — just bring metadata (e.g. a species
    // tag added on another device) up to date.
    await withSuppressedPush(() => saveMedia({
      ...local, name: remote.name, takenAt: remote.takenAt, takenAtSource: remote.takenAtSource,
      contentHash: remote.contentHash, species: remote.species, updatedAt: remote.updatedAt,
    }));
    return;
  }
  try {
    const path = `households/${activeCode}/media/${remote.id}`;
    const bytes = await getBytes(ref(firebaseStorage(), path));
    const blob = new Blob([bytes], { type: remote.mime || 'application/octet-stream' });
    await withSuppressedPush(() => saveMedia({
      id: remote.id, obsId: '', name: remote.name, mime: remote.mime, blob,
      addedAt: remote.addedAt, takenAt: remote.takenAt, takenAtSource: remote.takenAtSource,
      contentHash: remote.contentHash, species: remote.species, updatedAt: remote.updatedAt,
    }));
  } catch (err) {
    // Blob not uploaded yet (metadata can arrive slightly ahead of the
    // Storage write) or offline — will retry on the next remote update.
    console.warn('Firebase: could not download gallery photo', remote.id, err);
  }
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

/** Uploads a track's heavy fields (points/segments/reportPins/previewImage)
 * to Storage as a single JSON blob, and pushes its lightweight metadata to
 * Firestore — same split as files/photos, and for the same reason: a
 * multi-hour recording's point array could otherwise exceed Firestore's
 * 1MB document limit. A deleted tombstone has nothing to upload. */
async function pushTrack(track: ObservationTrack): Promise<void> {
  if (!activeCode) return;
  const meta: TrackMeta = {
    id: track.id, startedAt: track.startedAt, endedAt: track.endedAt,
    durationMs: track.durationMs, distanceMeters: track.distanceMeters,
    updatedAt: track.updatedAt, deleted: !!track.deleted,
  };
  if (!track.deleted) {
    try {
      const path = `households/${activeCode}/tracks/${track.id}`;
      const json = JSON.stringify({
        points: track.points, segments: track.segments,
        reportPins: track.reportPins, previewImage: track.previewImage,
      });
      await uploadBytes(ref(firebaseStorage(), path), new Blob([json], { type: 'application/json' }));
    } catch (err) {
      // Storage not enabled yet, offline, etc. — leave this track for a
      // later retry rather than pushing metadata other devices can't
      // actually fetch the route data for yet.
      console.warn('Firebase: could not upload track', track.id, err);
      return;
    }
  }
  await pushDoc('tracks', track.id, meta);
}

async function mergeRemoteTrack(remote: TrackMeta): Promise<void> {
  const local = await getTrack(remote.id);
  if (local && new Date(local.updatedAt) >= new Date(remote.updatedAt)) return;
  if (remote.deleted) {
    await withSuppressedPush(() => putTrackRaw({
      id: remote.id, points: [], segments: [], startedAt: remote.startedAt, endedAt: remote.endedAt,
      durationMs: remote.durationMs, distanceMeters: remote.distanceMeters, updatedAt: remote.updatedAt, deleted: true,
    }));
    return;
  }
  if (!activeCode) return;
  try {
    const path = `households/${activeCode}/tracks/${remote.id}`;
    const bytes = await getBytes(ref(firebaseStorage(), path));
    const data = JSON.parse(new TextDecoder().decode(bytes)) as
      Pick<ObservationTrack, 'points' | 'segments' | 'reportPins' | 'previewImage'>;
    await withSuppressedPush(() => putTrackRaw({
      id: remote.id, points: data.points, segments: data.segments,
      reportPins: data.reportPins, previewImage: data.previewImage,
      startedAt: remote.startedAt, endedAt: remote.endedAt, durationMs: remote.durationMs,
      distanceMeters: remote.distanceMeters, updatedAt: remote.updatedAt,
    }));
  } catch (err) {
    // Blob not uploaded yet (metadata can arrive slightly ahead of the
    // Storage write) or offline — will retry on the next remote update.
    console.warn('Firebase: could not download track', remote.id, err);
  }
}
