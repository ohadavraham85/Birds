/* lib/voice-dictation.ts — wraps the browser's Web Speech API (SpeechRecognition)
 * so a whole observation can be dictated by voice instead of typed.
 *
 * Browser support varies: works well in Chrome/Android (which is what most
 * phones running this PWA in the field will be), but is unsupported in
 * Firefox and historically flaky in Safari/iOS. It also isn't offline —
 * Chrome's implementation streams the audio to a cloud speech service, so
 * dictation needs a live network connection even though the rest of the app
 * works fully offline. Both limitations are surfaced to the user rather than
 * silently failing. */

interface SpeechRecognitionResultLike {
  0: { transcript: string };
  isFinal: boolean;
}
interface SpeechRecognitionEventLike extends Event {
  results: ArrayLike<SpeechRecognitionResultLike>;
  resultIndex: number;
}
interface SpeechRecognitionLike extends EventTarget {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  onresult: ((e: SpeechRecognitionEventLike) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
}
type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

function getCtor(): SpeechRecognitionCtor | null {
  const w = window as unknown as { SpeechRecognition?: SpeechRecognitionCtor; webkitSpeechRecognition?: SpeechRecognitionCtor };
  return w.SpeechRecognition || w.webkitSpeechRecognition || null;
}

export function isVoiceDictationSupported(): boolean {
  return getCtor() != null;
}

let active: SpeechRecognitionLike | null = null;

export interface DictationHandlers {
  /** Fired repeatedly while speaking, with the best-guess transcript so far. */
  onInterim: (text: string) => void;
  /** Fired once when the recognizer settles on a final transcript. */
  onFinal: (text: string) => void;
  onError: (message: string) => void;
  onEnd: () => void;
}

/** Starts listening; safely no-ops if already listening or if the browser
 * doesn't support the API (call isVoiceDictationSupported() first to decide
 * whether to show the mic button's active state at all).
 *
 * `continuous: true` keeps the recognizer listening across pauses between
 * sentences instead of stopping after the first one — used by the home
 * screen's whole-observation dictation, where the birder describes several
 * species/location/notes in one go rather than a single short phrase. */
export function startDictation(handlers: DictationHandlers, options: { continuous?: boolean } = {}): void {
  if (active) return;
  const Ctor = getCtor();
  if (!Ctor) { handlers.onError('דפדפן זה אינו תומך בהכתבה קולית'); return; }

  const rec = new Ctor();
  rec.lang = 'he-IL';
  rec.continuous = options.continuous ?? false;
  rec.interimResults = true;

  // Some Chrome/Android builds re-fire the exact same finalized segment a
  // second time (same text, same isFinal) instead of moving on to the next
  // one — with `continuous: true` this silently double-applies whatever the
  // caller does per onFinal call (e.g. the observation form adding a species
  // row twice for what was really one spoken phrase). Guards only against a
  // literal repeat of the last final text, so two genuinely different
  // phrases in one recording still each fire their own onFinal as before.
  let lastFinalText = '';
  rec.onresult = (e) => {
    let finalText = '';
    let interimText = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const r = e.results[i]!;
      if (r.isFinal) finalText += r[0].transcript;
      else interimText += r[0].transcript;
    }
    const trimmedFinal = finalText.trim();
    if (trimmedFinal) {
      if (trimmedFinal !== lastFinalText) { lastFinalText = trimmedFinal; handlers.onFinal(trimmedFinal); }
    } else if (interimText) handlers.onInterim(interimText.trim());
  };
  rec.onerror = (e) => {
    const messages: Record<string, string> = {
      'not-allowed': 'הגישה למיקרופון נחסמה — יש לאשר הרשאה בדפדפן',
      'no-speech': 'לא זוהה דיבור — נסו שוב',
      network: 'נדרש חיבור רשת פעיל להכתבה קולית',
    };
    handlers.onError(messages[e.error] || `שגיאת הכתבה: ${e.error}`);
  };
  rec.onend = () => { active = null; handlers.onEnd(); };

  active = rec;
  rec.start();
}

export function stopDictation(): void {
  active?.stop();
}

export function isDictating(): boolean {
  return active != null;
}
