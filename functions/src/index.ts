/* functions/src/index.ts — Firebase Cloud Function that turns one dictated
 * Hebrew field note into a structured observation (species+quantity+note
 * entries, location, tags, smart notes) via Claude.
 *
 * This exists only because an API key can never live in the client bundle of
 * a PWA (anyone can read it out of the shipped JS) — this function holds the
 * secret server-side and the app calls it through the Firebase callable
 * protocol instead. See src/lib/voice-ai.ts on the client side. */

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { defineSecret } from 'firebase-functions/params';
import Anthropic from '@anthropic-ai/sdk';

const anthropicApiKey = defineSecret('ANTHROPIC_API_KEY');

const MODEL = 'claude-haiku-4-5-20251001';
const MAX_LIST_LEN = 500;
const MAX_TRANSCRIPT_LEN = 4000;

interface ParseVoiceRequest {
  transcript: string;
  knownSpecies: string[];
  knownLocations: string[];
  knownTags: string[];
}

interface ParseVoiceResult {
  entries: { species: string; quantity: number; note?: string }[];
  locationName: string | null;
  tags: string[];
  notes: string;
}

function validateRequest(data: unknown): ParseVoiceRequest {
  const d = data as Partial<ParseVoiceRequest> | null;
  if (!d || typeof d.transcript !== 'string' || !d.transcript.trim()) {
    throw new HttpsError('invalid-argument', 'transcript is required');
  }
  const asStringArray = (v: unknown): string[] =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').slice(0, MAX_LIST_LEN) : [];
  return {
    transcript: d.transcript.slice(0, MAX_TRANSCRIPT_LEN),
    knownSpecies: asStringArray(d.knownSpecies),
    knownLocations: asStringArray(d.knownLocations),
    knownTags: asStringArray(d.knownTags),
  };
}

const TOOL_NAME = 'record_observation';

function buildTool(): Anthropic.Tool {
  return {
    name: TOOL_NAME,
    description: 'Records the structured birding observation extracted from the dictated transcript.',
    input_schema: {
      type: 'object',
      properties: {
        entries: {
          type: 'array',
          description: 'One entry per distinct bird species mentioned.',
          items: {
            type: 'object',
            properties: {
              species: { type: 'string', description: 'Must be copied EXACTLY (character for character) from the provided knownSpecies list — never invent or alter a species name.' },
              quantity: { type: 'integer', minimum: 1, description: 'How many individuals were seen. Default to 1 if not stated.' },
              note: { type: 'string', description: 'Short optional per-species note (behavior, plumage, distance, direction). Empty string if nothing specific was said about this species.' },
            },
            required: ['species', 'quantity', 'note'],
          },
        },
        locationName: {
          type: ['string', 'null'],
          description: 'The observation location as best understood from the transcript. Prefer an exact match from knownLocations if one clearly fits; otherwise a short plain place name from the transcript is fine (new locations are allowed). Null if no location was mentioned at all.',
        },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: 'Zero or more tags that clearly apply, copied EXACTLY from knownTags. Never invent a tag not in that list. Empty array if none clearly apply.',
        },
        notes: {
          type: 'string',
          description: 'A short, well-written Hebrew summary of anything in the transcript not already captured by entries/locationName/tags — weather, general conditions, behavior, impressions. Never leave this empty; if there is genuinely nothing extra, briefly restate the gist of what was said.',
        },
      },
      required: ['entries', 'locationName', 'tags', 'notes'],
    },
  };
}

function buildSystemPrompt(req: ParseVoiceRequest): string {
  return [
    'אתה עוזר שמנתח הכתבה קולית של צפר בעברית ומחלץ ממנה תצפית מובנית.',
    'התמלול עשוי להזכיר כמה מיני ציפורים עם כמויות, מיקום, ותנאים כלליים (מזג אוויר, התנהגות וכו׳).',
    '',
    'רשימת מיני הציפורים המוכרים במערכת (יש להעתיק שם מדויק מתוכה בלבד, ואסור בשום אופן להמציא מין שלא ברשימה):',
    JSON.stringify(req.knownSpecies),
    '',
    'רשימת המיקומים השמורים במערכת (עדיפות להתאמה מדויקת מכאן; אם אין התאמה טובה, אפשר להחזיר שם מיקום חדש מהתמלול עצמו):',
    JSON.stringify(req.knownLocations),
    '',
    'רשימת התגיות השמורות במערכת (יש לבחור אך ורק מתוכה, ואסור להמציא תגית חדשה):',
    JSON.stringify(req.knownTags),
    '',
    'אם מוזכר מין ציפור שאין לו שום התאמה סבירה ברשימת המינים המוכרים — השמט אותו מ-entries (עדיף להשמיט מין לא ברור מאשר להמציא שם לא קיים), אבל ציין זאת ב-notes כדי שהמשתמש יוכל להוסיף אותו ידנית.',
  ].join('\n');
}

export const parseVoiceObservation = onCall(
  { secrets: [anthropicApiKey], region: 'us-central1', cors: true },
  async (request): Promise<ParseVoiceResult> => {
    const req = validateRequest(request.data);
    const client = new Anthropic({ apiKey: anthropicApiKey.value() });

    let response;
    try {
      response = await client.messages.create({
        model: MODEL,
        max_tokens: 1024,
        system: buildSystemPrompt(req),
        tools: [buildTool()],
        tool_choice: { type: 'tool', name: TOOL_NAME },
        messages: [{ role: 'user', content: req.transcript }],
      });
    } catch (err) {
      throw new HttpsError('unavailable', `Anthropic request failed: ${(err as Error).message}`);
    }

    const toolUse = response.content.find((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use');
    if (!toolUse) throw new HttpsError('internal', 'Model did not return structured output');

    const input = toolUse.input as ParseVoiceResult;
    return {
      entries: Array.isArray(input.entries)
        ? input.entries
            .filter((e) => e && req.knownSpecies.includes(e.species))
            .map((e) => ({ species: e.species, quantity: Math.max(1, Math.round(e.quantity) || 1), note: e.note || undefined }))
        : [],
      locationName: typeof input.locationName === 'string' ? input.locationName : null,
      tags: Array.isArray(input.tags) ? input.tags.filter((t) => req.knownTags.includes(t)) : [],
      notes: typeof input.notes === 'string' ? input.notes : '',
    };
  },
);
