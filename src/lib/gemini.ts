/* lib/gemini.ts — direct calls from the app to the Gemini API (Google AI
 * Studio), for the voice assistant (lib/voice-assistant.ts).
 *
 * The API key is the user's own, typed into Settings → עוזר קולי on each
 * device and kept only in that device's localStorage: it is never part of
 * the shipped code, the repo, or the synced Firestore data. That's what lets
 * this work straight from the phone, without a server of our own (the older
 * Claude-based Cloud Function in functions/ needed the Firebase Blaze plan
 * and a deploy from a computer).
 *
 * Which model to call is picked automatically from the models the key can
 * use (the newest stable "flash" model), so the assistant keeps working as
 * Google retires old model names; a model chosen by hand in Settings wins. */

const KEY_STORAGE = 'birds-gemini-key';
const MODEL_STORAGE = 'birds-gemini-model';
const AUTO_MODEL_CACHE = 'birds-gemini-auto-model';
const API = 'https://generativelanguage.googleapis.com/v1beta';
/** Used when the model list can't be read for some reason. */
const FALLBACK_MODEL = 'gemini-2.5-flash';

function read(key: string): string {
  try { return localStorage.getItem(key) || ''; } catch { return ''; }
}
function write(key: string, value: string): void {
  try {
    if (value) localStorage.setItem(key, value);
    else localStorage.removeItem(key);
  } catch { /* private mode — nothing to persist */ }
}

export function getGeminiKey(): string { return read(KEY_STORAGE).trim(); }
export function setGeminiKey(key: string): void {
  write(KEY_STORAGE, key.trim());
  write(AUTO_MODEL_CACHE, '');
}
export function hasGeminiKey(): boolean { return !!getGeminiKey(); }

/** '' = automatic. */
export function getManualModel(): string { return read(MODEL_STORAGE).trim(); }
export function setManualModel(model: string): void { write(MODEL_STORAGE, model.trim().replace(/^models\//, '')); }

export class GeminiError extends Error {
  constructor(message: string, readonly status = 0) { super(message); }
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const key = getGeminiKey();
  if (!key) throw new GeminiError('לא הוגדר מפתח Gemini. מוסיפים אותו בהגדרות ← עוזר קולי.');
  let res: Response;
  try {
    res = await fetch(`${API}/${path}`, { ...init, headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key, ...init?.headers } });
  } catch {
    throw new GeminiError('אין חיבור לאינטרנט — העוזר הקולי צריך רשת.');
  }
  if (!res.ok) {
    let detail = '';
    try { detail = ((await res.json()) as { error?: { message?: string } }).error?.message || ''; } catch { /* not JSON */ }
    if (res.status === 400 && /api key/i.test(detail)) throw new GeminiError('מפתח ה-Gemini לא תקין. בודקים אותו בהגדרות ← עוזר קולי.', res.status);
    if (res.status === 403) throw new GeminiError('למפתח ה-Gemini אין הרשאה ל-Gemini API.', res.status);
    if (res.status === 429) throw new GeminiError('הגעתם למכסת השימוש של Gemini לעכשיו. נסו שוב בעוד דקה.', res.status);
    throw new GeminiError(`שגיאה מ-Gemini (${res.status})${detail ? `: ${detail}` : ''}`, res.status);
  }
  return res.json() as Promise<T>;
}

interface ModelInfo { name: string; supportedGenerationMethods?: string[] }

/** Newest stable "gemini-X.Y-flash" the key can use; failing that, any other
 * text flash model; failing that, the fallback name. */
export function pickModel(names: string[]): string {
  const ids = names.map((n) => n.replace(/^models\//, ''));
  const version = (id: string): number => Number(/^gemini-(\d+(?:\.\d+)?)/.exec(id)?.[1] ?? 0);
  const byNewest = (a: string, b: string): number => version(b) - version(a);
  const stable = ids.filter((id) => /^gemini-\d+(\.\d+)?-flash$/.test(id)).sort(byNewest);
  if (stable[0]) return stable[0];
  const other = ids
    .filter((id) => id.startsWith('gemini-') && id.includes('flash') && !/lite|image|tts|audio|live|embedding|thinking/.test(id))
    .sort(byNewest);
  return other[0] ?? FALLBACK_MODEL;
}

async function resolveModel(): Promise<string> {
  const manual = getManualModel();
  if (manual) return manual;
  const cached = read(AUTO_MODEL_CACHE);
  if (cached) return cached;
  try {
    const { models = [] } = await call<{ models?: ModelInfo[] }>('models?pageSize=1000');
    const usable = models.filter((m) => m.supportedGenerationMethods?.includes('generateContent')).map((m) => m.name);
    const model = pickModel(usable);
    write(AUTO_MODEL_CACHE, model);
    return model;
  } catch (err) {
    if (err instanceof GeminiError && err.status) throw err;
    return FALLBACK_MODEL;
  }
}

/** The model the next call will use (for the settings screen). */
export async function currentModel(): Promise<string> { return resolveModel(); }

interface GenerateResponse {
  candidates?: { content?: { parts?: { text?: string }[] } }[];
  promptFeedback?: { blockReason?: string };
}

async function generate(system: string, prompt: string, generationConfig: Record<string, unknown>): Promise<string> {
  const body = JSON.stringify({
    systemInstruction: { parts: [{ text: system }] },
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig,
  });
  const run = async (model: string): Promise<GenerateResponse> =>
    call<GenerateResponse>(`models/${encodeURIComponent(model)}:generateContent`, { method: 'POST', body });
  let res: GenerateResponse;
  try {
    res = await run(await resolveModel());
  } catch (err) {
    // An automatically chosen model that has since been retired: pick again once.
    if (err instanceof GeminiError && err.status === 404 && !getManualModel()) {
      write(AUTO_MODEL_CACHE, '');
      res = await run(await resolveModel());
    } else throw err;
  }
  const text = res.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('') ?? '';
  if (!text) throw new GeminiError(res.promptFeedback?.blockReason ? 'Gemini סירב לענות על הבקשה.' : 'Gemini לא החזיר תשובה.');
  return text;
}

/** Structured answer, shaped by an OpenAPI-style `schema` (Gemini's responseSchema). */
export async function geminiJson<T>(system: string, prompt: string, schema: Record<string, unknown>): Promise<T> {
  const text = await generate(system, prompt, { temperature: 0.1, responseMimeType: 'application/json', responseSchema: schema });
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new GeminiError('התשובה מ-Gemini לא הייתה בפורמט הצפוי.');
  }
}

export async function geminiText(system: string, prompt: string): Promise<string> {
  return (await generate(system, prompt, { temperature: 0.3 })).trim();
}
