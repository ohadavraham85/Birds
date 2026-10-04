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
  /** Close-but-not-exact species names to offer the user a pick from, when
   * speech recognition got near a known name but not quite onto it (e.g.
   * dictating "חיווי נחשים" when the real listed name is "חיוויאי הנחשים") —
   * only ever set when `species` itself is undefined. */
  speciesSuggestions?: string[];
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

/** Standard edit distance (insert/delete/substitute), used word-by-word
 * below rather than on whole phrases — speech recognition errors tend to
 * land within a single word (a dropped/garbled syllable), not evenly
 * smeared across the sentence. */
function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  if (!m) return n;
  if (!n) return m;
  const prev = new Array<number>(n + 1);
  const curr = new Array<number>(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      curr[j] = a[i - 1] === b[j - 1]
        ? prev[j - 1]
        : 1 + Math.min(prev[j - 1], prev[j], curr[j - 1]);
    }
    for (let j = 0; j <= n; j++) prev[j] = curr[j];
  }
  return prev[n];
}

const wordSimilarity = (a: string, b: string): number => 1 - levenshtein(a, b) / Math.max(a.length, b.length, 1);

/** How well a candidate name's own words are each echoed somewhere in the
 * transcript — the best-matching transcript word per candidate word,
 * averaged, so extra words said around it (and their own order) don't
 * matter, only whether each piece of the name is recognizably there. */
function fuzzyScore(candidateWords: string[], transcriptWords: string[]): number {
  if (!candidateWords.length || !transcriptWords.length) return 0;
  let total = 0;
  for (const cw of candidateWords) {
    let best = 0;
    for (const tw of transcriptWords) best = Math.max(best, wordSimilarity(cw, tw));
    total += best;
  }
  return total / candidateWords.length;
}

const FUZZY_THRESHOLD = 0.55;
const FUZZY_LIMIT = 5;

/** Common sighting-sentence filler ("ראיתי שלושה עורבים..." → "ראיתי") —
 * stripped before fuzzy-matching because a short filler word can otherwise
 * score deceptively high against an unrelated short species name purely by
 * sharing a couple of common Hebrew letters (e.g. "ראיתי" vs. "רמית"),
 * surfacing it as a bogus suggestion with nothing to do with what was said. */
const FILLER_WORDS = new Set([
  'ראיתי', 'ראינו', 'ראה', 'ראתה', 'שמעתי', 'שמענו', 'שמע', 'שמעה',
  'יש', 'היה', 'היתה', 'היו', 'גם', 'רק', 'של', 'זה', 'זאת', 'אלה',
  'על', 'עם', 'את', 'ליד', 'אצל', 'כאן', 'שם', 'הנה',
  ...Object.keys(HEBREW_NUMBER_WORDS),
]);

/** Only called once a literal substring match has already failed — so this
 * is specifically for "close but not exact" dictation, not a replacement
 * for findKnownMatch. */
function findFuzzyMatches(text: string, candidates: string[]): string[] {
  const transcriptWords = text.split(/\s+/)
    .map((w) => w.replace(/[.,!?"'׳״]/g, ''))
    .filter((w) => w && !FILLER_WORDS.has(w));
  if (!transcriptWords.length) return [];
  return [...new Set(candidates.filter(Boolean))]
    .map((name) => ({ name, score: fuzzyScore(name.split(/\s+/).filter(Boolean), transcriptWords) }))
    .filter((s) => s.score >= FUZZY_THRESHOLD)
    .sort((a, b) => b.score - a.score)
    .slice(0, FUZZY_LIMIT)
    .map((s) => s.name);
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
  const species = findKnownMatch(transcript, knownSpecies);
  const speciesSuggestions = species ? undefined : findFuzzyMatches(transcript, knownSpecies);
  return {
    species,
    speciesSuggestions: speciesSuggestions?.length ? speciesSuggestions : undefined,
    quantity: extractQuantity(transcript),
    locationName: findKnownMatch(transcript, knownLocations),
    notes: transcript,
  };
}
