/* lib/voice-ai.ts — client wrapper around the parseVoiceObservation Cloud
 * Function (functions/src/index.ts), which turns one dictated Hebrew field
 * note into a full structured observation (multiple species entries,
 * location, tags, smart notes) via Claude. The API key that makes this work
 * lives only in that server-side function — never in this file or anywhere
 * else in the client bundle.
 *
 * Every failure mode (function not yet deployed, no network, Anthropic
 * error) resolves to `null` rather than throwing, so callers can fall back
 * to the plain transcript — same resilience philosophy as the existing
 * heuristic voice-parse.ts. */

import { httpsCallable } from 'firebase/functions';
import { firebaseFunctions } from '../firebase/app';

export interface AiVoiceEntry {
  species: string;
  quantity: number;
  note?: string;
}

export interface AiVoiceResult {
  entries: AiVoiceEntry[];
  locationName: string | null;
  tags: string[];
  notes: string;
}

interface CallableRequest {
  transcript: string;
  knownSpecies: string[];
  knownLocations: string[];
  knownTags: string[];
}

export async function parseObservationWithAi(
  transcript: string,
  knownSpecies: string[],
  knownLocations: string[],
  knownTags: string[],
): Promise<AiVoiceResult | null> {
  if (!transcript.trim()) return null;
  try {
    const fn = httpsCallable<CallableRequest, AiVoiceResult>(firebaseFunctions(), 'parseVoiceObservation');
    const { data } = await fn({ transcript, knownSpecies, knownLocations, knownTags });
    return data;
  } catch {
    return null;
  }
}
