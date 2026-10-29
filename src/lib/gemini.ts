/* lib/gemini.ts — direct calls from the app to Gemini, for the voice
 * assistant (lib/voice-assistant.ts). Two kinds of key work:
 *  - a Google AI Studio key ("AIza…") → the Gemini API
 *    (generativelanguage.googleapis.com);
 *  - a Google Cloud / Vertex AI key ("AQ.…", e.g. bound to a service account,
 *    or Vertex express mode) → Vertex AI's global endpoint
 *    (aiplatform.googleapis.com/v1/publishers/google/models/…).
 * Both take the key in the x-goog-api-key header, allow calls from the app's
 * origin (CORS) and share the same generateContent request/response shape.
 *
 * The API key is the user's own, typed into Settings → עוזר קולי on each
 * device and kept only in that device's localStorage: it is never part of
 * the shipped code, the repo, or the synced Firestore data. That's what lets
 * this work straight from the phone, without a server of our own (the older
 * Claude-based Cloud Function in functions/ needed the Firebase Blaze plan
 * and a deploy from a computer).
 *
 * Which model to call is picked automatically from the models the key can
 * use — newest stable "flash" first, then older/preview/lite ones — and the
 * next candidate is tried whenever one is retired (404) or has no quota on
 * this key's tier (429 / "limit: 0"), so the assistant keeps working as
 * Google changes model names and free-tier limits. A model chosen by hand in
 * Settings is always used as-is. */

const KEY_STORAGE = 'birds-gemini-key';
const MODEL_STORAGE = 'birds-gemini-model';
const AUTO_MODEL_CACHE = 'birds-gemini-auto-model';
const STUDIO_API = 'https://generativelanguage.googleapis.com/v1beta';
const VERTEX_API = 'https://aiplatform.googleapis.com/v1/publishers/google';
/** Tried (in order) when the model list can't be read for some reason. */
const FALLBACK_MODELS: string[] = ['gemini-2.5-flash', 'gemini-flash-latest', 'gemini-2.0-flash', 'gemini-2.5-flash-lite'];
/** Vertex AI doesn't list its models to an API key, so these are tried in
 * order (newest first; a name Vertex doesn't have just fails with 404 and
 * the next is tried, and the first that works is remembered). */
const VERTEX_MODELS: string[] = [
  'gemini-3-flash', 'gemini-3-flash-preview', 'gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-2.0-flash-001',
];
/** How many models to try before giving up on one call. */
const MAX_MODEL_TRIES = 6;

function read(key: string): string {
  try { return localStorage.getItem(key) || ''; } catch { return ''; }
}
function write(key: string, value: string): void {
  try {
    if (value) localStorage.setItem(key, value);
    else localStorage.removeItem(key);
  } catch { /* private mode — nothing to persist */ }
}

/** A Google key is plain ASCII (letters, digits, ".", "-" and "_"). Pasting
 * on a phone can drag along spaces, line breaks, quotes or invisible
 * direction marks from a Hebrew keyboard — any of which makes Google reject
 * the key. */
export function cleanKey(raw: string): string {
  return raw.replace(/[^A-Za-z0-9._-]/g, '');
}

export type KeyKind = 'studio' | 'vertex';
/** AI Studio keys start with "AIza"; anything else is treated as a Google
 * Cloud / Vertex AI key. */
export function keyKind(key = getGeminiKey()): KeyKind {
  return key.startsWith('AIza') ? 'studio' : 'vertex';
}

export function getGeminiKey(): string { return cleanKey(read(KEY_STORAGE)); }
export function setGeminiKey(key: string): void {
  write(KEY_STORAGE, cleanKey(key));
  write(AUTO_MODEL_CACHE, '');
}
export function hasGeminiKey(): boolean { return !!getGeminiKey(); }

/** '' = automatic. */
export function getManualModel(): string { return read(MODEL_STORAGE).trim(); }
export function setManualModel(model: string): void {
  write(MODEL_STORAGE, model.trim().replace(/^models\//, ''));
  write(AUTO_MODEL_CACHE, '');
}

export class GeminiError extends Error {
  /** Google's own (English) error text, for the settings screen's check. */
  readonly detail: string;
  constructor(message: string, readonly status = 0, detail = '') {
    super(message);
    this.detail = detail;
  }
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const key = getGeminiKey();
  if (!key) throw new GeminiError('לא הוגדר מפתח Gemini. מוסיפים אותו בהגדרות ← עוזר קולי.');
  let res: Response;
  try {
    res = await fetch(`${keyKind(key) === 'studio' ? STUDIO_API : VERTEX_API}/${path}`, { ...init, headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key, ...init?.headers } });
  } catch {
    throw new GeminiError('אין חיבור לאינטרנט — העוזר הקולי צריך רשת.');
  }
  if (!res.ok) {
    let detail = '';
    try { detail = ((await res.json()) as { error?: { message?: string } }).error?.message || ''; } catch { /* not JSON */ }
    if (isKeyError(res.status, detail)) throw new GeminiError('Google לא מכיר את המפתח. כדאי להעתיק אותו שוב.', res.status, detail);
    if (res.status === 403) throw new GeminiError(forbiddenMessage(detail, keyKind(key)), res.status, detail);
    if (res.status === 429) throw new GeminiError('אין מכסת שימוש פנויה ב-Gemini כרגע. נסו שוב בעוד דקה.', res.status, detail);
    if (res.status === 404) throw new GeminiError('המודל לא נמצא.', res.status, detail);
    throw new GeminiError(`שגיאה מ-Gemini (${res.status}).`, res.status, detail);
  }
  return res.json() as Promise<T>;
}

/** Google's 403s have several distinct causes, each fixed in a different
 * place in the Google Cloud console — say which one it is. */
function forbiddenMessage(detail: string, kind: KeyKind): string {
  const api = kind === 'vertex' ? 'Vertex AI API (Agent Platform API)' : 'Generative Language API';
  if (/referer|referrer/i.test(detail)) {
    return `המפתח מוגבל לאתרים מסוימים. ב-Google Cloud: Credentials ← המפתח ← Application restrictions: מוסיפים את כתובת האפליקציה (${location.origin}/*), או בוחרים None.`;
  }
  if (/are blocked/i.test(detail)) {
    return `המפתח חסום לשירות הזה. ב-Google Cloud: APIs & Services ← Credentials ← לוחצים על המפתח ← API restrictions: מוסיפים לרשימה את ${api}, או בוחרים Don't restrict key, ושומרים.`;
  }
  if (/has not been used|is disabled|SERVICE_DISABLED/i.test(detail)) {
    return `השירות ${api} לא מופעל בפרויקט. מפעילים אותו בקישור שבתשובת Google, ומחכים כמה דקות.`;
  }
  if (/billing/i.test(detail)) return 'בפרויקט ב-Google Cloud צריך לחבר חשבון חיוב (Billing).';
  return kind === 'vertex'
    ? 'למפתח אין הרשאה ל-Vertex AI. ב-Google Cloud ← IAM נותנים לחשבון השירות של המפתח את התפקיד Vertex AI User.'
    : 'למפתח אין הרשאה להשתמש ב-Gemini API.';
}

/** 401 (Vertex) / 400 (AI Studio) about the key itself. */
function isKeyError(status: number, detail: string): boolean {
  return status === 401 || (status === 400 && /api key/i.test(detail));
}

interface ModelInfo { name: string; supportedGenerationMethods?: string[] }

/** Text models worth trying, best first: stable "gemini-X.Y-flash" newest
 * first, then the "flash-latest" alias, other flash variants (previews),
 * and finally the lighter "flash-lite" ones. */
export function rankModels(names: string[]): string[] {
  const ids = [...new Set(names.map((n) => n.replace(/^models\//, '')))];
  const version = (id: string): number => Number(/^gemini-(\d+(?:\.\d+)?)/.exec(id)?.[1] ?? 0);
  const byNewest = (a: string, b: string): number => version(b) - version(a);
  const textFlash = ids.filter((id) => id.startsWith('gemini-') && id.includes('flash') && !/image|tts|audio|live|embedding|thinking/.test(id));
  const stable = textFlash.filter((id) => /^gemini-\d+(\.\d+)?-flash$/.test(id)).sort(byNewest);
  const latest: string[] = textFlash.filter((id) => id === 'gemini-flash-latest');
  const lite = textFlash.filter((id) => id.includes('lite')).sort(byNewest);
  const other = textFlash.filter((id) => !stable.includes(id) && !latest.includes(id) && !lite.includes(id)).sort(byNewest);
  return [...stable, ...latest, ...other, ...lite];
}

/** Kept for the tests/older callers: the first ranked model. */
export function pickModel(names: string[]): string {
  return rankModels(names)[0] ?? FALLBACK_MODELS[0]!;
}

async function candidateModels(): Promise<string[]> {
  const manual = getManualModel();
  if (manual) return [manual];
  const cached = read(AUTO_MODEL_CACHE);
  const cachedFirst = (list: string[]): string[] => (cached && list.includes(cached) ? [cached, ...list.filter((m) => m !== cached)] : list);
  if (keyKind() === 'vertex') return cachedFirst(VERTEX_MODELS);
  let ranked: string[] = [];
  try {
    const { models = [] } = await call<{ models?: ModelInfo[] }>('models?pageSize=1000');
    ranked = rankModels(models.filter((m) => m.supportedGenerationMethods?.includes('generateContent')).map((m) => m.name));
  } catch (err) {
    // A bad key fails here already — say so instead of trying models.
    if (err instanceof GeminiError && (isKeyError(err.status, err.detail) || err.status === 403)) throw err;
  }
  if (!ranked.length) ranked = FALLBACK_MODELS;
  return cachedFirst(ranked);
}

/** The model the next call will use (for the settings screen). */
export async function currentModel(): Promise<string> {
  return getManualModel() || read(AUTO_MODEL_CACHE) || (await candidateModels())[0]!;
}

interface GenerateResponse {
  candidates?: { content?: { parts?: { text?: string }[] } }[];
  promptFeedback?: { blockReason?: string };
}

/** A failure that another model might not have: retired (404), no quota on
 * this tier (429), or a request option that model doesn't support (400 that
 * isn't about the key). */
function worthTryingAnother(err: unknown): boolean {
  return err instanceof GeminiError && (err.status === 404 || err.status === 429 || (err.status === 400 && !isKeyError(err.status, err.detail)));
}

async function generate(system: string, prompt: string, generationConfig: Record<string, unknown>): Promise<string> {
  const body = JSON.stringify({
    systemInstruction: { parts: [{ text: system }] },
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig,
  });
  const models = (await candidateModels()).slice(0, MAX_MODEL_TRIES);
  let lastErr: unknown = null;
  for (const model of models) {
    let res: GenerateResponse;
    try {
      res = await call<GenerateResponse>(`models/${encodeURIComponent(model)}:generateContent`, { method: 'POST', body });
    } catch (err) {
      lastErr = err;
      if (!getManualModel() && worthTryingAnother(err)) continue;
      throw err;
    }
    if (!getManualModel()) write(AUTO_MODEL_CACHE, model);
    const text = res.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('') ?? '';
    if (!text) throw new GeminiError(res.promptFeedback?.blockReason ? 'Gemini סירב לענות על הבקשה.' : 'Gemini לא החזיר תשובה.');
    return text;
  }
  throw lastErr ?? new GeminiError('לא נמצא מודל Gemini זמין למפתח הזה.');
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
