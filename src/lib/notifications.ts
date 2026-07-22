/* lib/notifications.ts — local (device-only) notifications: bird migration
 * season reminders and "on this day" reminders for past observations. No
 * server/push infrastructure is involved — notifications are shown via the
 * Notification API (through the service worker when available) and are only
 * checked when the app itself is opened, since that's the only time a PWA
 * can run JS at all without a real push subscription. Preferences are
 * device-local settings (like theme), not synced between devices. */

import { getSetting, setSetting } from '../db/repository';
import type { Observation } from '../types';

const KEY_ENABLED = 'notifEnabled';
const KEY_MIGRATION = 'notifMigrationEnabled';
const KEY_ON_THIS_DAY = 'notifOnThisDayEnabled';

export function notificationsSupported(): boolean {
  return typeof Notification !== 'undefined';
}

export type NotifPermission = 'default' | 'granted' | 'denied' | 'unsupported';

export function permissionState(): NotifPermission {
  if (!notificationsSupported()) return 'unsupported';
  return Notification.permission;
}

export async function requestPermission(): Promise<NotifPermission> {
  if (!notificationsSupported()) return 'unsupported';
  const result = await Notification.requestPermission();
  return result;
}

export async function isEnabled(): Promise<boolean> {
  return getSetting<boolean>(KEY_ENABLED, false);
}

export async function setEnabled(value: boolean): Promise<void> {
  await setSetting(KEY_ENABLED, value);
}

export async function isMigrationEnabled(): Promise<boolean> {
  return getSetting<boolean>(KEY_MIGRATION, true);
}

export async function setMigrationEnabled(value: boolean): Promise<void> {
  await setSetting(KEY_MIGRATION, value);
}

export async function isOnThisDayEnabled(): Promise<boolean> {
  return getSetting<boolean>(KEY_ON_THIS_DAY, true);
}

export async function setOnThisDayEnabled(value: boolean): Promise<void> {
  await setSetting(KEY_ON_THIS_DAY, value);
}

interface MigrationWindow { key: string; month: number; day: number; title: string; body: string }

/** Fixed calendar reminders for Israel's bird migration seasons — month is
 * 0-indexed to match Date. Peak dates roughly bracket the busiest weeks of
 * each migration; start dates give a heads-up before it ramps up. */
const MIGRATION_WINDOWS: MigrationWindow[] = [
  { key: 'spring-start', month: 1, day: 15, title: 'עונת נדידת האביב מתחילה', body: 'נדידת האביב יוצאת לדרך — זמן טוב לצאת לצפות.' },
  { key: 'spring-peak', month: 2, day: 15, title: 'שיא נדידת האביב', body: 'אנחנו בשיא נדידת האביב בישראל — ימים טובים לצפרות.' },
  { key: 'autumn-start', month: 7, day: 15, title: 'עונת נדידת הסתיו מתחילה', body: 'נדידת הסתיו יוצאת לדרך — זמן טוב לצאת לצפות.' },
  { key: 'autumn-peak', month: 8, day: 15, title: 'שיא נדידת הסתיו', body: 'אנחנו בשיא נדידת הסתיו בישראל — ימים טובים לצפרות.' },
];

async function showNotification(title: string, body: string, tag: string): Promise<void> {
  if (!notificationsSupported() || Notification.permission !== 'granted') return;
  if ('serviceWorker' in navigator) {
    try {
      const reg = await navigator.serviceWorker.ready;
      await reg.showNotification(title, { body, tag, icon: '/icons/icon-192.png' });
      return;
    } catch {
      // fall through to page-context notification
    }
  }
  new Notification(title, { body, tag });
}

async function checkMigration(): Promise<void> {
  const now = new Date();
  for (const w of MIGRATION_WINDOWS) {
    if (now.getMonth() !== w.month || now.getDate() !== w.day) continue;
    const flagKey = `notifiedMigration_${w.key}_${now.getFullYear()}`;
    if (await getSetting<boolean>(flagKey, false)) continue;
    await showNotification(w.title, w.body, `migration-${w.key}`);
    await setSetting(flagKey, true);
  }
}

/** Finds the most recent observation (a year or more back) that falls on
 * today's month/day, mirroring the "on this day" card on the home screen. */
function pickOnThisDay(observations: Observation[], now: Date): Observation | null {
  let best: Observation | null = null;
  let bestDate: Date | null = null;
  for (const obs of observations) {
    const d = new Date(obs.dateTime);
    if (d.getMonth() !== now.getMonth() || d.getDate() !== now.getDate()) continue;
    if (d.getFullYear() >= now.getFullYear()) continue;
    if (!bestDate || d > bestDate) { best = obs; bestDate = d; }
  }
  return best;
}

async function checkOnThisDay(observations: Observation[]): Promise<void> {
  const now = new Date();
  const match = pickOnThisDay(observations, now);
  if (!match) return;
  const flagKey = `notifiedOnThisDay_${now.getFullYear()}-${now.getMonth()}-${now.getDate()}`;
  if (await getSetting<boolean>(flagKey, false)) return;
  const years = now.getFullYear() - new Date(match.dateTime).getFullYear();
  const yearsLabel = years === 1 ? 'לפני שנה' : `לפני ${years} שנים`;
  const place = match.locationName ? ` ב${match.locationName}` : '';
  await showNotification('תצפית מהעבר', `בדיוק ${yearsLabel} צפית${place}. הצצה לתצפית הישנה?`, 'on-this-day');
  await setSetting(flagKey, true);
}

/** Call once at app startup (after Notification permission has been granted
 * and the feature turned on) to check both reminder types for "today". */
export async function checkAndNotify(observations: Observation[]): Promise<void> {
  if (!notificationsSupported() || Notification.permission !== 'granted') return;
  if (!(await isEnabled())) return;
  if (await isMigrationEnabled()) await checkMigration();
  if (await isOnThisDayEnabled()) await checkOnThisDay(observations);
}
