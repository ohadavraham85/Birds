/* firebase/firestore-sync.ts — optional two-way sync backend using
 * Firestore + Storage, selected in Settings by entering a shared
 * "household code" (instead of, or alongside, the Cloudflare server
 * URL/token). Unlike the polling/outbox-based Cloudflare sync, this pushes
 * every local mutation live and listens for remote changes in real time;
 * conflicts are resolved last-write-wins by `updatedAt`, same policy as the
 * rest of the app. */

import {
  collection, doc, setDoc, onSnapshot, type Unsubscribe,
} from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { firebaseDb, firebaseStorage } from './app';
import {
  onMutation, getSetting, setSetting,
  listObservationsRaw, putObservationRaw, getObservation,
  listSpeciesRows, putSpeciesRaw, getSpeciesRaw,
  listLocationRows, putLocationRaw, getLocationRaw,
  getMedia,
  type MutationEntity, type MutationOp,
} from '../db/repository';
import type { Observation, SpeciesRow, LocationRow } from '../types';

const COLLECTION_BY_ENTITY: Record<MutationEntity, string> = {
  observation: 'observations',
  species: 'species',
  location: 'locations',
};

let activeCode: string | null = null;
let unsubs: Unsubscribe[] = [];
let stopMutationListener: (() => void) | null = null;

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

export function stopFirebaseSync(): void {
  unsubs.forEach((u) => u());
  unsubs = [];
  stopMutationListener?.();
  stopMutationListener = null;
  activeCode = null;
}

async function startFirebaseSync(code: string): Promise<void> {
  activeCode = code;
  const db = firebaseDb();

  // One-time initial full push per code — anything created locally before
  // Firebase was configured (or while offline) needs to reach the cloud too.
  // Remote listeners below bring in whatever the *other* device already has.
  // Only runs once (not on every app boot) to stay well within Firestore's
  // free-tier write quota; ongoing changes are pushed live via onMutation.
  const seedFlagKey = `firebaseSeeded_${code}`;
  if (!(await getSetting<boolean>(seedFlagKey, false))) {
    await withSuppressedPush(async () => {
      for (const o of await listObservationsRaw()) await pushDoc('observations', o.id, o);
      for (const s of await listSpeciesRows()) await pushDoc('species', s.name, s);
      for (const l of await listLocationRows()) await pushDoc('locations', l.name, l);
      // Photo upload (Storage) is best-effort and optional — a project that
      // hasn't enabled Storage yet (e.g. still on the free Spark plan) must
      // not lose text-data sync (Firestore) just because photos can't upload.
      for (const o of await listObservationsRaw()) {
        try { await pushObservationMedia(o); } catch (err) { console.warn('Firebase: photo sync skipped', err); }
      }
    });
    await setSetting(seedFlagKey, true);
  }

  unsubs.push(onSnapshot(collection(db, 'households', code, 'observations'), (snap) => {
    snap.docChanges().forEach((change) => {
      if (change.type === 'removed') return;
      void mergeRemoteObservation(change.doc.data() as Observation);
    });
  }));
  unsubs.push(onSnapshot(collection(db, 'households', code, 'species'), (snap) => {
    snap.docChanges().forEach((change) => {
      if (change.type === 'removed') return;
      void mergeRemoteSpecies(change.doc.data() as SpeciesRow);
    });
  }));
  unsubs.push(onSnapshot(collection(db, 'households', code, 'locations'), (snap) => {
    snap.docChanges().forEach((change) => {
      if (change.type === 'removed') return;
      void mergeRemoteLocation(change.doc.data() as LocationRow);
    });
  }));

  stopMutationListener = onMutation((entity, id, op, payload) => {
    if (suppressDepth > 0 || !activeCode) return;
    void handleLocalMutation(entity, id, op, payload);
  });
}

async function handleLocalMutation(entity: MutationEntity, id: string, _op: MutationOp, payload: unknown): Promise<void> {
  await pushDoc(COLLECTION_BY_ENTITY[entity], id, payload);
  if (entity === 'observation') {
    try { await pushObservationMedia(payload as Observation); } catch (err) { console.warn('Firebase: photo sync skipped', err); }
  }
}

async function pushDoc(col: string, id: string, data: unknown): Promise<void> {
  if (!activeCode) return;
  await setDoc(doc(firebaseDb(), 'households', activeCode, col, id), sanitize(data) as Record<string, unknown>);
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
