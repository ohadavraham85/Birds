/* lib/voice-parse.ts — turns one dictated Hebrew sentence ("ראיתי שלושה
 * עורבים אפורים בנחל גבול") into a best-effort species/quantity/location
 * guess. This is closed-vocabulary matching against the app's own species
 * and location lists, not general NLU — free-form phrasing that doesn't
 * happen to contain a known name/number just falls through to the notes
 * field untouched, so nothing said is ever lost even when nothing is
 * recognized structurally. */

const HEBREW_NUMBER_WORDS: Record<string, number> = {
  'אחד': 1, 'אחת': 1,
  'שניים': 2, 'שתיים': 2, 'שני': 2, 'שתי': 2,
  'שלושה': 3, 'שלוש': 3,
  'ארבעה': 4, 'ארבע': 4,
  'חמישה': 5, 'חמש': 5,
  'שישה': 6, 'שש': 6,
  'שבעה': 7, 'שבע': 7,
  'שמונה': 8,
  'תשעה': 9, 'תשע': 9,
  'עשרה': 10, 'עשר': 10,
};

export interface VoiceParseResult {
  species?: string;
  quantity: number;
  locationName?: string;
  /** The full transcript, always — even when species/location/quantity were
   * confidently extracted, so no detail from what was actually said is lost. */
  notes: string;
}

/** Picks the longest known name that appears anywhere in the transcript —
 * longest-first so e.g. "עורב אפור" matches whole rather than stopping at
 * the shorter "עורב" the moment it's found as a substring. */
function findKnownMatch(text: string, candidates: string[]): string | undefined {
  const sorted = [...new Set(candidates.filter(Boolean))].sort((a, b) => b.length - a.length);
  return sorted.find((c) => text.includes(c));
}

function extractQuantity(text: string): number {
  const digitMatch = text.match(/\d+/);
  if (digitMatch) return parseInt(digitMatch[0], 10);
  for (const raw of text.split(/\s+/)) {
    const word = raw.replace(/[.,!?"'׳״]/g, '');
    if (HEBREW_NUMBER_WORDS[word] != null) return HEBREW_NUMBER_WORDS[word];
  }
  return 1;
}

export function parseObservationVoice(transcript: string, knownSpecies: string[], knownLocations: string[]): VoiceParseResult {
  return {
    species: findKnownMatch(transcript, knownSpecies),
    quantity: extractQuantity(transcript),
    locationName: findKnownMatch(transcript, knownLocations),
    notes: transcript,
  };
}
