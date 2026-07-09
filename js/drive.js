/* drive.js — Google Drive integration (סעיפים 2–3 במפרט).
 *
 * All data lives exclusively in the user's own Google Drive:
 *  - A Google Spreadsheet with exactly two sheets: "תצפיות" and "רשימת מינים".
 *  - A Drive folder holding original-quality observation images.
 *  - Exported PDF reports are uploaded to a reports folder.
 *
 * Auth: Google Identity Services (OAuth 2.0 token flow) with the drive.file
 * scope — the app can only touch files it created in the user's Drive.
 *
 * Sync model: offline-first. Everything is written to IndexedDB immediately;
 * syncNow() does a two-way merge (newest updatedAt wins, soft-deletes
 * propagate as tombstone rows) and rewrites the sheet.
 */

import {
  getSetting, setSetting,
  listObservationsRaw, putObservationRaw,
  listSpecies, addSpecies,
  listPendingMedia, saveMedia, getMedia,
} from './db.js';

export const SPREADSHEET_NAME = 'תצפיות צפרות - בסיס נתונים';
export const MEDIA_FOLDER_NAME = 'תצפיות צפרות - תמונות';
export const REPORTS_FOLDER_NAME = 'תצפיות צפרות - דוחות';
const SHEET_OBS = 'תצפיות';
const SHEET_SPECIES = 'רשימת מינים';
const SCOPE = 'https://www.googleapis.com/auth/drive.file';

const OBS_HEADERS = [
  'מפתח תצפית', 'תאריך ושעה', 'מיקום', 'קו רוחב', 'קו אורך', 'פרויקט',
  'מין הציפור', 'מספר פרטים', 'תמונות', 'הערות', 'עודכן בתאריך', 'נמחק',
];

let accessToken = null;
let tokenExpiry = 0;
let tokenClient = null;

/* ---------- auth ---------- */

function loadGisScript() {
  return new Promise((resolve, reject) => {
    if (window.google?.accounts?.oauth2) return resolve();
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('לא ניתן לטעון את שירות ההתחברות של Google. בדקו חיבור לאינטרנט.'));
    document.head.appendChild(s);
  });
}

export function isConnected() {
  return !!accessToken && Date.now() < tokenExpiry;
}

export async function hasClientId() {
  return !!(await getSetting('googleClientId'));
}

function restoreSessionToken() {
  try {
    const raw = sessionStorage.getItem('gdrive-token');
    if (!raw) return;
    const { token, expiry } = JSON.parse(raw);
    if (Date.now() < expiry - 60_000) {
      accessToken = token;
      tokenExpiry = expiry;
    }
  } catch { /* ignore */ }
}
restoreSessionToken();

/** Get a valid access token; pops the Google consent UI when needed. */
export async function ensureToken(interactive = true) {
  if (isConnected()) return accessToken;
  const clientId = await getSetting('googleClientId');
  if (!clientId) throw new Error('לא הוגדר Google Client ID. יש להזין אותו במסך ההגדרות.');
  await loadGisScript();

  return new Promise((resolve, reject) => {
    tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: SCOPE,
      callback: (resp) => {
        if (resp.error) {
          reject(new Error('ההתחברות ל-Google נכשלה: ' + resp.error));
          return;
        }
        accessToken = resp.access_token;
        tokenExpiry = Date.now() + (resp.expires_in - 60) * 1000;
        try {
          sessionStorage.setItem('gdrive-token', JSON.stringify({ token: accessToken, expiry: tokenExpiry }));
        } catch { /* ignore */ }
        resolve(accessToken);
      },
      error_callback: (err) => reject(new Error('חלון ההתחברות של Google נסגר או נחסם' + (err?.type ? ` (${err.type})` : ''))),
    });
    tokenClient.requestAccessToken({ prompt: interactive ? '' : 'none' });
  });
}

export function disconnect() {
  if (accessToken && window.google?.accounts?.oauth2) {
    try { google.accounts.oauth2.revoke(accessToken, () => {}); } catch { /* ignore */ }
  }
  accessToken = null;
  tokenExpiry = 0;
  sessionStorage.removeItem('gdrive-token');
}

/* ---------- low-level API helpers ---------- */

async function api(url, options = {}) {
  const token = await ensureToken();
  const resp = await fetch(url, {
    ...options,
    headers: { Authorization: `Bearer ${token}`, ...(options.headers || {}) },
  });
  if (resp.status === 401) {
    accessToken = null;
    sessionStorage.removeItem('gdrive-token');
    throw new Error('פג תוקף ההתחברות ל-Google. יש לסנכרן שוב.');
  }
  if (!resp.ok) {
    let detail = '';
    try { detail = (await resp.json()).error?.message || ''; } catch { /* ignore */ }
    throw new Error(`שגיאת Google API (${resp.status}) ${detail}`);
  }
  return resp;
}

async function apiJson(url, options = {}) {
  return (await api(url, options)).json();
}

/* ---------- Drive files & folders ---------- */

async function findByName(name, mimeType) {
  const q = encodeURIComponent(`name = '${name.replace(/'/g, "\\'")}' and mimeType = '${mimeType}' and trashed = false`);
  const data = await apiJson(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name)&pageSize=1`);
  return data.files?.[0]?.id || null;
}

async function ensureFolder(name, settingKey) {
  let id = await getSetting(settingKey);
  if (id) return id;
  id = await findByName(name, 'application/vnd.google-apps.folder');
  if (!id) {
    const data = await apiJson('https://www.googleapis.com/drive/v3/files', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, mimeType: 'application/vnd.google-apps.folder' }),
    });
    id = data.id;
  }
  await setSetting(settingKey, id);
  return id;
}

/** Upload a blob to Drive at original quality (no recompression). */
export async function uploadFileToDrive(blob, name, folderId) {
  const metadata = { name, parents: [folderId] };
  const boundary = 'birds' + Math.random().toString(36).slice(2);
  const body = new Blob([
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n`,
    JSON.stringify(metadata),
    `\r\n--${boundary}\r\nContent-Type: ${blob.type || 'application/octet-stream'}\r\n\r\n`,
    blob,
    `\r\n--${boundary}--`,
  ]);
  const data = await apiJson(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink',
    { method: 'POST', headers: { 'Content-Type': `multipart/related; boundary=${boundary}` }, body },
  );
  return data;
}

/* ---------- spreadsheet setup ---------- */

async function ensureSpreadsheet() {
  let id = await getSetting('spreadsheetId');
  if (!id) {
    id = await findByName(SPREADSHEET_NAME, 'application/vnd.google-apps.spreadsheet');
  }
  if (!id) {
    const data = await apiJson('https://sheets.googleapis.com/v4/spreadsheets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        properties: { title: SPREADSHEET_NAME, locale: 'iw_IL' },
        sheets: [
          { properties: { title: SHEET_OBS, gridProperties: { frozenRowCount: 1 } } },
          { properties: { title: SHEET_SPECIES } },
        ],
      }),
    });
    id = data.spreadsheetId;
    await putValues(id, `'${SHEET_OBS}'!A1`, [OBS_HEADERS]);
    await putValues(id, `'${SHEET_SPECIES}'!A1`, [['שם המין']]);
  } else {
    // Make sure both sheets exist on a pre-existing spreadsheet.
    const meta = await apiJson(`https://sheets.googleapis.com/v4/spreadsheets/${id}?fields=sheets.properties.title`);
    const titles = (meta.sheets || []).map((s) => s.properties.title);
    const requests = [];
    if (!titles.includes(SHEET_OBS)) requests.push({ addSheet: { properties: { title: SHEET_OBS } } });
    if (!titles.includes(SHEET_SPECIES)) requests.push({ addSheet: { properties: { title: SHEET_SPECIES } } });
    if (requests.length) {
      await apiJson(`https://sheets.googleapis.com/v4/spreadsheets/${id}:batchUpdate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requests }),
      });
      if (!titles.includes(SHEET_OBS)) await putValues(id, `'${SHEET_OBS}'!A1`, [OBS_HEADERS]);
      if (!titles.includes(SHEET_SPECIES)) await putValues(id, `'${SHEET_SPECIES}'!A1`, [['שם המין']]);
    }
  }
  await setSetting('spreadsheetId', id);
  return id;
}

async function getValues(spreadsheetId, range) {
  const data = await apiJson(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(range)}`,
  );
  return data.values || [];
}

async function putValues(spreadsheetId, range, values) {
  await apiJson(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(range)}?valueInputOption=RAW`,
    { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ values }) },
  );
}

async function clearValues(spreadsheetId, range) {
  await apiJson(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(range)}:clear`,
    { method: 'POST' },
  );
}

/* ---------- row (de)serialization ---------- */

function obsToRow(o) {
  return [
    o.id,
    o.dateTime || '',
    o.locationName || '',
    o.lat ?? '',
    o.lng ?? '',
    o.project || '',
    o.species || '',
    o.quantity ?? 1,
    JSON.stringify(o.images || []),
    o.notes || '',
    o.updatedAt || '',
    o.deleted ? 1 : 0,
  ];
}

function rowToObs(r) {
  if (!r || !r[0]) return null;
  let images = [];
  try { images = JSON.parse(r[8] || '[]'); } catch { /* ignore */ }
  if (!Array.isArray(images)) images = [];
  return {
    id: String(r[0]),
    dateTime: r[1] || '',
    locationName: r[2] || '',
    lat: r[3] !== '' && r[3] != null ? parseFloat(r[3]) : null,
    lng: r[4] !== '' && r[4] != null ? parseFloat(r[4]) : null,
    project: r[5] || '',
    species: r[6] || '',
    quantity: r[7] !== '' && r[7] != null ? parseInt(r[7], 10) || 1 : 1,
    images,
    notes: r[9] || '',
    updatedAt: r[10] || '',
    deleted: String(r[11]) === '1' || String(r[11]).toUpperCase() === 'TRUE',
  };
}

/* ---------- media sync ---------- */

async function uploadPendingMedia(onStatus) {
  const pending = await listPendingMedia();
  if (!pending.length) return;
  const folderId = await ensureFolder(MEDIA_FOLDER_NAME, 'mediaFolderId');
  let n = 0;
  for (const m of pending) {
    n++;
    onStatus?.(`מעלה תמונה ${n} מתוך ${pending.length}...`);
    const ext = (m.name || '').includes('.') ? '' : guessExt(m.mime);
    const driveName = `${m.obsId}_${m.id}_${m.name || 'image'}${ext}`;
    const file = await uploadFileToDrive(m.blob, driveName, folderId);
    m.driveId = file.id;
    await saveMedia(m);
    // reflect the Drive id inside the owning observation's images list
    const all = await listObservationsRaw();
    const obs = all.find((o) => o.id === m.obsId);
    if (obs) {
      const img = (obs.images || []).find((i) => i.localId === m.id);
      if (img && !img.driveId) {
        img.driveId = file.id;
        await putObservationRaw(obs);
      }
    }
  }
}

function guessExt(mime) {
  const map = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/heic': '.heic', 'image/tiff': '.tif' };
  return map[mime] || '';
}

/** Resolve an observation image to a local object URL, fetching from Drive
 * (and caching in IndexedDB) when the blob isn't stored locally. */
export async function getImageObjectUrl(img, obsId) {
  if (img.localId) {
    const m = await getMedia(img.localId);
    if (m?.blob) return URL.createObjectURL(m.blob);
  }
  if (img.driveId) {
    const cached = await getMedia('drive-' + img.driveId);
    if (cached?.blob) return URL.createObjectURL(cached.blob);
    if (!navigator.onLine) return null;
    try {
      const resp = await api(`https://www.googleapis.com/drive/v3/files/${img.driveId}?alt=media`);
      const blob = await resp.blob();
      await saveMedia({ id: 'drive-' + img.driveId, obsId, name: img.name || '', mime: blob.type, blob, driveId: img.driveId });
      return URL.createObjectURL(blob);
    } catch {
      return null;
    }
  }
  return null;
}

/* ---------- full two-way sync ---------- */

export async function syncNow(onStatus = () => {}) {
  onStatus('מתחבר ל-Google Drive...');
  await ensureToken(true);
  const spreadsheetId = await ensureSpreadsheet();

  onStatus('מעלה תמונות...');
  await uploadPendingMedia(onStatus);

  onStatus('קורא נתונים מהענן...');
  const remoteRows = await getValues(spreadsheetId, `'${SHEET_OBS}'!A2:L`);
  const remote = new Map();
  for (const r of remoteRows) {
    const o = rowToObs(r);
    if (o) remote.set(o.id, o);
  }

  onStatus('ממזג נתונים...');
  const local = await listObservationsRaw();
  const localMap = new Map(local.map((o) => [o.id, o]));
  const merged = new Map();
  const ids = new Set([...remote.keys(), ...localMap.keys()]);
  for (const id of ids) {
    const l = localMap.get(id);
    const r = remote.get(id);
    if (l && r) {
      merged.set(id, (l.updatedAt || '') >= (r.updatedAt || '') ? l : r);
    } else {
      merged.set(id, l || r);
    }
  }

  // update local store with anything newer from remote
  for (const [id, o] of merged) {
    const l = localMap.get(id);
    if (!l || (l.updatedAt || '') < (o.updatedAt || '')) {
      await putObservationRaw(o);
    }
  }

  // species: union of local + remote master lists
  const remoteSpecies = (await getValues(spreadsheetId, `'${SHEET_SPECIES}'!A2:A`))
    .map((r) => String(r[0] || '').trim())
    .filter(Boolean);
  const localSpecies = await listSpecies();
  const allSpecies = [...new Set([...localSpecies, ...remoteSpecies])].sort((a, b) => a.localeCompare(b, 'he'));
  for (const name of remoteSpecies) {
    if (!localSpecies.includes(name)) await addSpecies(name);
  }

  onStatus('כותב נתונים לענן...');
  const mergedRows = [...merged.values()]
    .sort((a, b) => (a.dateTime < b.dateTime ? 1 : -1))
    .map(obsToRow);
  await clearValues(spreadsheetId, `'${SHEET_OBS}'!A2:L`);
  await putValues(spreadsheetId, `'${SHEET_OBS}'!A1`, [OBS_HEADERS, ...mergedRows]);
  await clearValues(spreadsheetId, `'${SHEET_SPECIES}'!A2:A`);
  await putValues(spreadsheetId, `'${SHEET_SPECIES}'!A1`, [['שם המין'], ...allSpecies.map((s) => [s])]);

  const now = new Date().toISOString();
  await setSetting('lastSync', now);
  onStatus('הסנכרון הושלם');
  return { count: mergedRows.length, lastSync: now };
}

/** Upload an exported PDF report to the reports folder in Drive. */
export async function uploadReportPdf(blob, name) {
  await ensureToken(true);
  const folderId = await ensureFolder(REPORTS_FOLDER_NAME, 'reportsFolderId');
  return uploadFileToDrive(blob, name, folderId);
}
