/* lib/backup.ts — the full restore file and the readable observations table,
 * plus the weekly "backup to Drive" reminder and flow. Drive gets the files
 * through the phone's share sheet (Web Share API → choose "Drive"), so no
 * Google sign-in or API setup is needed. */

import {
  listObservationsRaw, listSpecies, listLocationRows, listTagRows, listObserverRows,
  listAllMedia, listTracksRaw, listSeriesRows, listEquipmentRaw, listObservations,
} from '../db/repository';
import { getSpeciesDetail } from './species-details-cache';
import { entriesOf, entryImages } from './observation';
import { showModal, toast } from './ui';
import { icon } from './icons';

const LAST_BACKUP_KEY = 'birds-last-drive-backup';
const SNOOZE_KEY = 'birds-backup-snooze-until';
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result as string); r.onerror = rej; r.readAsDataURL(blob); });
}

const today = (): string => new Date().toISOString().slice(0, 10);

/** Everything needed to restore the app on any device (photos at original
 * quality). Built from many small Blob parts rather than one giant string,
 * so a large photo collection doesn't exhaust a phone's memory. */
export interface BackupResult {
  blob: Blob;
  observations: number;
  /** Photos whose image bytes are inside the file. */
  photos: number;
  /** Photos that also have a cloud copy (restorable from the file's link). */
  cloudPhotos: number;
  /** Photos that exist only on this device (no cloud copy). */
  localOnlyPhotos: number;
}

/** `withPhotos: false` keeps every photo's details and cloud link but not
 * its bytes — small enough for the phone's share sheet (which refuses
 * hundreds of MB); photos then reload from the cloud after a restore. */
export async function buildFullBackup({ withPhotos = true } = {}): Promise<BackupResult> {
  const [observations, species, locations, tags, observers, tracks, series, equipment] = await Promise.all([
    listObservationsRaw(), listSpecies(), listLocationRows(), listTagRows(), listObserverRows(),
    listTracksRaw(), listSeriesRows(), listEquipmentRaw(),
  ]);
  const meta = JSON.stringify({
    app: 'birds-journal', format: 4, exportedAt: new Date().toISOString(),
    species, locations, tags, observers, observations, tracks, series, equipment,
  });
  const parts: Blob[] = [new Blob([meta.slice(0, -1), ',"media":['])];
  let photos = 0;
  let cloudPhotos = 0;
  let localOnlyPhotos = 0;
  let written = 0;
  for (const m of await listAllMedia()) {
    const hasBytes = !!m.blob?.size;
    const remote = m.remoteId && /^https?:\/\//.test(m.remoteId) ? m.remoteId : undefined;
    if (!hasBytes && !remote) continue;
    if (remote) cloudPhotos++; else localOnlyPhotos++;
    const include = withPhotos && hasBytes;
    const item = {
      id: m.id, obsId: m.obsId, name: m.name, mime: m.mime, remoteId: remote,
      species: m.species, takenAt: m.takenAt, takenAtSource: m.takenAtSource,
      ...(include ? { data: await blobToDataUrl(m.blob) } : {}),
    };
    if (include) photos++;
    parts.push(new Blob([(written ? ',' : '') + JSON.stringify(item)]));
    written++;
  }
  parts.push(new Blob([']}']));
  return {
    blob: new Blob(parts, { type: 'text/plain' }),
    observations: observations.filter((o) => !o.deleted).length,
    photos, cloudPhotos, localOnlyPhotos,
  };
}

function csvCell(v: unknown): string {
  const s = v == null ? '' : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
}

/** One row per species seen, readable in Excel / Google Sheets. */
export async function buildObservationsTable(): Promise<Blob> {
  const header = ['מס׳ תצפית', 'תאריך', 'שעה', 'מיקום', 'קו רוחב', 'קו אורך', 'מין', 'שם אנגלי', 'שם מדעי', 'משפחה', 'כמות', 'הערה למין', 'תמונות', 'תגיות', 'צופים', 'הערות'];
  const rows: string[] = [header.map(csvCell).join(',')];
  const pad = (n: number): string => String(n).padStart(2, '0');
  for (const o of [...(await listObservations())].reverse()) {
    const d = new Date(o.dateTime);
    const date = isNaN(d.getTime()) ? '' : `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    const time = isNaN(d.getTime()) ? '' : `${pad(d.getHours())}:${pad(d.getMinutes())}`;
    const entries = entriesOf(o);
    for (const e of entries.length ? entries : [{ species: '', quantity: 0 }]) {
      const det = e.species ? getSpeciesDetail(e.species) : { en: '', sci: '', family: '' };
      rows.push([
        o.seqNo ?? '', date, time, o.locationName, o.lat ?? '', o.lng ?? '',
        e.species, det.en, det.sci, det.family, e.species ? e.quantity : '', 'note' in e ? e.note ?? '' : '',
        entryImages(e).length || '', (o.tags || []).join('; '), (o.observers || []).join('; '), o.notes,
      ].map(csvCell).join(','));
    }
  }
  // BOM so Excel opens the Hebrew correctly.
  return new Blob(['﻿' + rows.join('\r\n')], { type: 'text/csv' });
}

export function lastDriveBackup(): string | null {
  try { return localStorage.getItem(LAST_BACKUP_KEY); } catch { return null; }
}

function markBackedUp(): void {
  try { localStorage.setItem(LAST_BACKUP_KEY, new Date().toISOString()); localStorage.removeItem(SNOOZE_KEY); } catch { /* storage blocked */ }
}

function isBackupDue(): boolean {
  try {
    const snooze = Number(localStorage.getItem(SNOOZE_KEY) || 0);
    if (snooze > Date.now()) return false;
    const last = localStorage.getItem(LAST_BACKUP_KEY);
    return !last || Date.now() - new Date(last).getTime() > WEEK_MS;
  } catch { return false; }
}

function downloadFile(file: File): void {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(file);
  a.download = file.name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
}

/** Two steps on purpose: the share sheet must open straight from a tap, and
 * building a large backup can take longer than the browser allows between
 * the tap and the share call. */
export function openDriveBackup(): void {
  const wrap = document.createElement('div');
  wrap.className = 'drive-backup-modal';
  wrap.innerHTML = `
    <h3>${icon('drive')} גיבוי לדרייב</h3>
    <p class="hint" style="margin-top:0">שני קבצים: קובץ שחזור (כל הנתונים, וקישור לכל תמונה בענן) וטבלת תצפיות לאקסל/גיליונות. קובצי התמונות עצמם גדולים מדי לשליחה מהטלפון — הם שמורים בענן הסנכרון, וגיבוי מלא איתם אפשר להוריד בהגדרות.</p>
    <p class="drive-backup-status">מכין את הקבצים...</p>
    <div class="modal-actions">
      <button type="button" class="btn btn-primary" id="db-share" disabled>${icon('drive')} שליחה לדרייב</button>
      <button type="button" class="btn" id="db-cancel">ביטול</button>
    </div>`;
  const close = showModal(wrap);
  const status = wrap.querySelector<HTMLElement>('.drive-backup-status')!;
  const shareBtn = wrap.querySelector<HTMLButtonElement>('#db-share')!;
  wrap.querySelector('#db-cancel')!.addEventListener('click', close);

  void (async () => {
    let files: File[];
    try {
      const [full, table] = await Promise.all([buildFullBackup({ withPhotos: false }), buildObservationsTable()]);
      // Android's share sheet refuses .json files, so the restore file is
      // shared as .txt — its content is the same JSON the restore button reads.
      files = [
        // ASCII names: some browsers drop non-ASCII download names to "download".
        new File([full.blob], `birds-backup-restore-${today()}.txt`, { type: 'text/plain' }),
        new File([table], `birds-observations-table-${today()}.csv`, { type: 'text/csv' }),
      ];
      const mb = (full.blob.size / (1024 * 1024)).toFixed(1);
      const localNote = full.localOnlyPhotos
        ? ` שימו לב: ${full.localOnlyPhotos} תמונות שמורות רק בטלפון ולא בענן — גבו אותן ב"הורדת קובץ גיבוי מלא".`
        : '';
      status.textContent = `מוכן: ${full.observations} תצפיות, ${full.cloudPhotos} תמונות בענן (${mb} MB). לחצו "שליחה לדרייב" ובחרו Drive.${localNote}`;
      shareBtn.disabled = false;
    } catch (err) {
      status.textContent = `הכנת הגיבוי נכשלה: ${(err as Error).message || err}`;
      return;
    }

    shareBtn.addEventListener('click', () => {
      void (async () => {
        if (navigator.canShare?.({ files })) {
          try {
            await navigator.share({ files, title: `גיבוי יומן צפרות ${today()}` });
            markBackedUp();
            close();
            toast('הגיבוי נשלח ✓');
          } catch (err) {
            if ((err as Error).name === 'AbortError') return;
            // Sharing refused (e.g. too large for this phone): save the files instead.
            files.forEach(downloadFile);
            markBackedUp();
            close();
            toast('השליחה לא הצליחה, אז הקבצים נשמרו בהורדות — העלו אותם לדרייב מאפליקציית Drive', true, 8000);
          }
          return;
        }
        // No file sharing (e.g. desktop): download both, to upload to Drive by hand.
        files.forEach(downloadFile);
        markBackedUp();
        close();
        toast('שני הקבצים הורדו — העלו אותם לתיקיית הגיבויים בדרייב', false, 6000);
      })();
    });
  })();
}

function showReminder(): void {
  if (document.getElementById('backup-reminder')) return;
  const bar = document.createElement('div');
  bar.id = 'backup-reminder';
  bar.className = 'backup-reminder';
  bar.innerHTML = `
    <span class="icon" aria-hidden="true">${icon('drive')}</span>
    <span class="backup-reminder-text">הגיע הזמן לגיבוי השבועי לדרייב</span>
    <button type="button" class="backup-reminder-go">גיבוי</button>
    <button type="button" class="backup-reminder-later">אחר כך</button>`;
  document.body.appendChild(bar);
  bar.querySelector('.backup-reminder-go')!.addEventListener('click', () => { bar.remove(); openDriveBackup(); });
  bar.querySelector('.backup-reminder-later')!.addEventListener('click', () => {
    try { localStorage.setItem(SNOOZE_KEY, String(Date.now() + DAY_MS)); } catch { /* storage blocked */ }
    bar.remove();
  });
}

/** Shows the weekly reminder when a backup is due (and there's something to back up). */
export async function maybeRemindBackup(): Promise<void> {
  if (!isBackupDue()) return;
  if (!(await listObservations()).length) return;
  showReminder();
}

/** Asks the browser to keep this app's storage instead of treating it as
 * evictable cache — without this, a phone low on space may silently wipe
 * the local database (observations, settings, sync code). */
async function requestPersistentStorage(): Promise<void> {
  try {
    if (navigator.storage?.persist && !(await navigator.storage.persisted())) await navigator.storage.persist();
  } catch { /* not supported */ }
}

export function setupBackupReminder(): void {
  void requestPersistentStorage();
  void maybeRemindBackup();
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') void maybeRemindBackup(); });
}
