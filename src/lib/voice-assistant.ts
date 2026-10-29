/* lib/voice-assistant.ts — the voice assistant's brain: one spoken (or typed)
 * Hebrew sentence in, one change or answer out.
 *
 *  - "תפתח תצפית בנחל תבור"   → a new ongoing observation (status 'active',
 *                               startTime now, GPS point if available)
 *  - "תוסיף 2 חיוואים"         → sightings merged into the active observation
 *  - "סגור תצפית"              → status 'completed', endTime, durationMinutes
 *  - "מתי ראיתי נשר מקראי?"    → a summary answer from the journal's history
 *
 * Gemini only *interprets* the sentence (lib/gemini.ts, structured JSON);
 * every change is applied here in code, to an ordinary Observation saved
 * through the repository — so it shows up in the journal and syncs to
 * Firebase like any other observation, and the last change can be undone.
 * History questions run in two steps: Gemini turns the question into a
 * filter, the matching observations are picked here, and Gemini writes the
 * answer from just those rows. */

import { listObservations, saveObservation, deleteObservation, listSpecies, listLocationRows } from '../db/repository';
import { entriesOf } from './observation';
import { geminiJson, geminiText } from './gemini';
import type { Observation, SpeciesEntry, LocationRow } from '../types';

type Action = 'open' | 'add' | 'close' | 'query' | 'answer' | 'unknown';

interface Interpretation {
  action: Action;
  locationName?: string;
  entries?: { species: string; quantity?: number; mode?: 'add' | 'set' | 'remove'; note?: string }[];
  query?: { species?: string[]; locations?: string[]; from?: string; to?: string };
  reply?: string;
}

export interface AssistantResult {
  /** What to show the user. */
  reply: string;
  /** The active observation after this command (null = none open). */
  active: Observation | null;
  /** True when the command changed data that can be undone. */
  undoable: boolean;
}

const SCHEMA = {
  type: 'OBJECT',
  properties: {
    action: { type: 'STRING', enum: ['open', 'add', 'close', 'query', 'answer', 'unknown'] },
    locationName: { type: 'STRING' },
    entries: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          species: { type: 'STRING' },
          quantity: { type: 'INTEGER' },
          mode: { type: 'STRING', enum: ['add', 'set', 'remove'] },
          note: { type: 'STRING' },
        },
        required: ['species'],
      },
    },
    query: {
      type: 'OBJECT',
      properties: {
        species: { type: 'ARRAY', items: { type: 'STRING' } },
        locations: { type: 'ARRAY', items: { type: 'STRING' } },
        from: { type: 'STRING' },
        to: { type: 'STRING' },
      },
    },
    reply: { type: 'STRING' },
  },
  required: ['action'],
};

const SYSTEM = `אתה עוזר קולי באפליקציית יומן צפרות בעברית. המשתמש מדבר בשטח, והתמלול עלול להכיל שגיאות. החזר JSON בלבד לפי הסכמה.

פעולות (action):
- "open": המשתמש פותח תצפית מתמשכת חדשה ("תפתח תצפית ב..."). locationName = שם המקום. אם הוא תואם (גם בקירוב) למקום מרשימת המקומות, השתמש בשם המדויק מהרשימה. אם באותו משפט נאמרו גם ציפורים, הוסף אותן ל-entries.
- "add": המשתמש מדווח על ציפורים בתצפית הפעילה ("תוסיף 2 חיוואים", "ראיתי עוד כוס חורבות", "עוד 3 עגורים"). לכל מין: species, quantity (ברירת מחדל 1), mode:
  "add" = להוסיף לכמות הקיימת (ברירת המחדל: "תוסיף", "עוד", "ראיתי"),
  "set" = לקבוע כמות מדויקת ("בעצם יש 5", "תתקן ל-4", "סה״כ 7"),
  "remove" = להסיר את המין ("תמחק", "טעות, לא היה").
  note = פרט נוסף שנאמר על אותו מין (מגדר, גיל, התנהגות), אם יש.
- "close": סגירת התצפית הפעילה ("סגור תצפית", "סיימתי").
- "query": שאלה על היסטוריית התצפיות ("מתי ראיתי...", "תן לי את הלוג של...", "כמה פעמים..."). מלא query: species (שמות מדויקים מרשימת המינים), locations (שמות מדויקים מרשימת המקומות — כל השמות שמתאימים), from/to בפורמט YYYY-MM-DD אם נאמר טווח זמן (למשל "בתקופה האחרונה" = 3 החודשים האחרונים, "השנה" = מתחילת השנה). השאר ריק את מה שלא נאמר.
- "answer": שאלה על התצפית הפעילה עצמה ("מה ראיתי עד עכשיו?", "כמה זמן אני כאן?") — כתוב את התשובה ב-reply לפי מצב התצפית הפעילה.
- "unknown": לא ברור — כתוב ב-reply שאלה קצרה או הסבר.

שמות מינים: תמיד צורת היחיד ושם המין המדויק מרשימת המינים, גם כשנאמר ברבים או בשם עממי/חלקי (למשל "חיוואים" → השם המלא מהרשימה שמתאים). רק אם אין שום מין מתאים ברשימה, כתוב את השם כפי שנאמר, ביחיד.
reply: משפט קצר בעברית שמסכם מה הבנת (למשל "נוספו 2 חיוויאי נחשים").`;

/* ---------- active observation ---------- */

export async function getActiveObservation(): Promise<Observation | null> {
  const all = await listObservations();
  return all.filter((o) => o.status === 'active').sort((a, b) => ((a.startTime || a.dateTime) < (b.startTime || b.dateTime) ? 1 : -1))[0] ?? null;
}

/** Last change, for "ביטול": each touched observation as it was before
 * (null = it didn't exist, so undo deletes it). */
let undoStack: { id: string; before: Observation | null }[] = [];

export function canUndo(): boolean { return undoStack.length > 0; }

export async function undoLast(): Promise<Observation | null> {
  const steps = undoStack;
  undoStack = [];
  for (const { id, before } of [...steps].reverse()) {
    if (before) await saveObservation({ ...before });
    else await deleteObservation(id);
  }
  return getActiveObservation();
}

function clone(o: Observation): Observation {
  return JSON.parse(JSON.stringify(o)) as Observation;
}

function minutesBetween(fromIso: string, toIso: string): number {
  return Math.max(0, Math.round((new Date(toIso).getTime() - new Date(fromIso).getTime()) / 60000));
}

export function fmtDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (!h) return `${m} דק׳`;
  return m ? `${h} ש׳ ${m} דק׳` : `${h} ש׳`;
}

function currentPosition(timeoutMs = 8000): Promise<{ lat: number; lng: number } | null> {
  if (!('geolocation' in navigator)) return Promise.resolve(null);
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 60000 },
    );
  });
}

function speciesSummary(o: Observation): string {
  const list = entriesOf(o).filter((e) => e.species);
  if (!list.length) return 'עדיין אין מינים';
  return list.map((e) => (e.quantity > 1 ? `${e.species} ×${e.quantity}` : e.species)).join(', ');
}

/** Merges spoken sightings into an entries list; returns a short Hebrew line per change. */
function applyEntries(entries: SpeciesEntry[], changes: NonNullable<Interpretation['entries']>, known: Set<string>): string[] {
  const done: string[] = [];
  for (const c of changes) {
    const species = c.species?.trim();
    if (!species) continue;
    const qty = Math.max(0, Math.round(c.quantity ?? 1));
    const mode = c.mode ?? 'add';
    const i = entries.findIndex((e) => e.species === species);
    const unknownMark = known.has(species) ? '' : ' (לא ברשימת המינים)';
    if (mode === 'remove') {
      if (i >= 0) { entries.splice(i, 1); done.push(`הוסר: ${species}`); }
      continue;
    }
    if (i >= 0) {
      const e = entries[i]!;
      e.quantity = mode === 'set' ? Math.max(1, qty) : e.quantity + Math.max(1, qty);
      if (c.note) e.note = e.note ? `${e.note}; ${c.note}` : c.note;
      done.push(`${species}: ${e.quantity}${unknownMark}`);
    } else {
      entries.push({ species, quantity: Math.max(1, qty), ...(c.note ? { note: c.note } : {}), images: [] });
      done.push(`נוסף ${species}${qty > 1 ? ` ×${qty}` : ''}${unknownMark}`);
    }
  }
  return done;
}

async function openObservation(locationName: string, locations: LocationRow[]): Promise<Observation> {
  const now = new Date().toISOString();
  const gps = await currentPosition();
  const saved = locations.find((l) => l.name === locationName && l.lat != null && l.lng != null);
  const point = gps ?? (saved ? { lat: saved.lat!, lng: saved.lng! } : null);
  return {
    id: crypto.randomUUID(),
    dateTime: now,
    startTime: now,
    status: 'active',
    locationName,
    lat: point?.lat ?? null,
    lng: point?.lng ?? null,
    project: '',
    tags: [],
    entries: [],
    images: [],
    notes: '',
    deleted: false,
    updatedAt: now,
  };
}

async function closeObservation(o: Observation): Promise<Observation> {
  const end = new Date().toISOString();
  return { ...o, status: 'completed', endTime: end, durationMinutes: minutesBetween(o.startTime || o.dateTime, end) };
}

/** The window's "סגירת תצפית" button — closes without going through Gemini. */
export async function closeActiveObservation(): Promise<AssistantResult> {
  const active = await getActiveObservation();
  if (!active) return { reply: 'אין תצפית פעילה לסגור.', active: null, undoable: false };
  const before = clone(active);
  const closed = await closeObservation(active);
  await saveObservation(closed);
  undoStack = [{ id: closed.id, before }];
  return { reply: closedReply(closed), active: null, undoable: true };
}

function closedReply(o: Observation): string {
  const count = entriesOf(o).filter((e) => e.species).length;
  return `התצפית ב${o.locationName || 'מקום'} נסגרה. משך: ${fmtDuration(o.durationMinutes ?? 0)} · ${count} מינים.\n${speciesSummary(o)}`;
}

/* ---------- history questions ---------- */

const MAX_ROWS = 400;

function dayOf(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function timeOf(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function obsLine(o: Observation): string {
  const birds = entriesOf(o).filter((e) => e.species).map((e) => `${e.species} ×${e.quantity}${e.note ? ` (${e.note})` : ''}`).join(', ');
  const notes = o.notes?.trim() ? ` | הערות: ${o.notes.trim().replace(/\s+/g, ' ').slice(0, 160)}` : '';
  return `${dayOf(o.dateTime)} ${timeOf(o.dateTime)} | ${o.locationName || 'ללא מיקום'} | ${birds || 'ללא מינים'}${notes}`;
}

async function answerQuestion(question: string, q: NonNullable<Interpretation['query']>): Promise<string> {
  const species = new Set((q.species ?? []).filter(Boolean));
  const locations = (q.locations ?? []).filter(Boolean);
  const all = await listObservations();
  const matches = all.filter((o) => {
    if (species.size && !entriesOf(o).some((e) => species.has(e.species))) return false;
    if (locations.length && !locations.some((l) => o.locationName === l || o.locationName.includes(l))) return false;
    const day = dayOf(o.dateTime);
    if (q.from && day < q.from) return false;
    if (q.to && day > q.to) return false;
    return true;
  });
  if (!matches.length) return 'לא מצאתי תצפיות שמתאימות לשאלה.';
  const rows = matches.slice(0, MAX_ROWS);
  const more = matches.length > rows.length ? `\n(מוצגות ${rows.length} התצפיות האחרונות מתוך ${matches.length} שמתאימות.)` : '';
  return geminiText(
    'אתה עוזר ביומן צפרות. ענה בעברית, בקצרה ובצורה מסודרת, רק לפי שורות התצפיות שניתנו (כל שורה: תאריך שעה | מקום | מינים ×כמות | הערות). סדר לפי תאריך, מהחדש לישן, וציין מקומות וכמויות. אם מבקשים "לוג", הצג רשימה של התצפיות. אל תמציא נתונים.',
    `השאלה: ${question}\n\nהיום: ${dayOf(new Date().toISOString())}\nמספר התצפיות שמתאימות: ${matches.length}${more}\n\nתצפיות:\n${rows.map(obsLine).join('\n')}`,
  );
}

/* ---------- one command ---------- */

export async function runCommand(text: string): Promise<AssistantResult> {
  const [species, locations, active] = await Promise.all([listSpecies(), listLocationRows(), getActiveObservation()]);
  const nowIso = new Date().toISOString();
  const state = active
    ? `תצפית פעילה: מקום "${active.locationName || 'לא צוין'}", נפתחה ב-${timeOf(active.startTime || active.dateTime)} (לפני ${fmtDuration(minutesBetween(active.startTime || active.dateTime, nowIso))}). מינים עד עכשיו: ${speciesSummary(active)}.`
    : 'אין כרגע תצפית פעילה.';
  const prompt = `עכשיו: ${new Date().toLocaleString('he-IL', { dateStyle: 'full', timeStyle: 'short' })} (${dayOf(nowIso)})
${state}

רשימת המינים:
${species.join(' | ')}

רשימת המקומות:
${locations.map((l) => l.name).join(' | ') || '(אין)'}

מה המשתמש אמר: "${text}"`;
  const it = await geminiJson<Interpretation>(SYSTEM, prompt, SCHEMA);
  const known = new Set(species);

  switch (it.action) {
    case 'open': {
      const name = (it.locationName || '').trim();
      const steps: typeof undoStack = [];
      const lines: string[] = [];
      if (active) {
        steps.push({ id: active.id, before: clone(active) });
        const closed = await closeObservation(active);
        await saveObservation(closed);
        lines.push(`התצפית ב${active.locationName || 'מקום הקודם'} נסגרה (${fmtDuration(closed.durationMinutes ?? 0)}).`);
      }
      const obs = await openObservation(name, locations);
      const added = it.entries?.length ? applyEntries(obs.entries, it.entries, known) : [];
      await saveObservation(obs);
      steps.push({ id: obs.id, before: null });
      undoStack = steps;
      lines.push(`נפתחה תצפית${name ? ` ב${name}` : ''} בשעה ${timeOf(obs.startTime!)}${obs.lat == null ? ' (בלי נקודת מיקום)' : ''}.`);
      if (added.length) lines.push(added.join(' · '));
      if (!name) lines.push('לא שמעתי את שם המקום — אפשר להשלים אותו בעריכת התצפית.');
      return { reply: lines.join('\n'), active: obs, undoable: true };
    }
    case 'add': {
      if (!active) return { reply: 'אין תצפית פעילה. אמרו קודם "תפתח תצפית ב..." ואז את הציפורים.', active: null, undoable: false };
      const before = clone(active);
      const next = { ...active, entries: entriesOf(active).map((e) => ({ ...e })) };
      const done = applyEntries(next.entries, it.entries ?? [], known);
      if (!done.length) return { reply: it.reply || 'לא זיהיתי ציפורים להוסיף.', active, undoable: false };
      await saveObservation(next);
      undoStack = [{ id: next.id, before }];
      return { reply: `${done.join(' · ')}\nסה״כ בתצפית: ${speciesSummary(next)}`, active: next, undoable: true };
    }
    case 'close':
      return closeActiveObservation();
    case 'query':
      return { reply: await answerQuestion(text, it.query ?? {}), active, undoable: false };
    case 'answer':
      return { reply: it.reply || state, active, undoable: false };
    default:
      return { reply: it.reply || 'לא הבנתי. אפשר לנסות שוב, למשל: "תוסיף 2 חיוואים".', active, undoable: false };
  }
}
