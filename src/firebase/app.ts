/* firebase/app.ts — lazy Firebase app/Firestore/Storage singletons.
 *
 * The config below is the standard public Web SDK config (not a secret —
 * it just names which Firebase project to talk to). Access to the data
 * itself is controlled by Firestore/Storage security rules, scoped by the
 * "household code" the user enters in Settings (see firestore-sync.ts). */

import { initializeApp, type FirebaseApp } from 'firebase/app';
import { initializeFirestore, type Firestore } from 'firebase/firestore';
import { getStorage, type FirebaseStorage } from 'firebase/storage';

const firebaseConfig = {
  apiKey: 'AIzaSyAPQuB8HSAaLnIWptriLCtLnpuqyDg4VFI',
  authDomain: 'ohad-avraham-birding-log.firebaseapp.com',
  projectId: 'ohad-avraham-birding-log',
  storageBucket: 'ohad-avraham-birding-log.firebasestorage.app',
  messagingSenderId: '977779496102',
  appId: '1:977779496102:web:1b529d33ff2d97de26d067',
};

let app: FirebaseApp | undefined;
let db: Firestore | undefined;
let storage: FirebaseStorage | undefined;

function getApp(): FirebaseApp {
  if (!app) app = initializeApp(firebaseConfig);
  return app;
}

export function firebaseDb(): Firestore {
  // Some networks (corporate proxies, some mobile carriers) reset Firestore's
  // default streaming (WebChannel) connection outright, before auto-detection
  // even gets a chance to fall back — forcing long-polling unconditionally
  // makes sync work everywhere at a small latency cost.
  if (!db) db = initializeFirestore(getApp(), { experimentalForceLongPolling: true });
  return db;
}

export function firebaseStorage(): FirebaseStorage {
  if (!storage) storage = getStorage(getApp());
  return storage;
}
