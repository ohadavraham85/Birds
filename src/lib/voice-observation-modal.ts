/* lib/voice-observation-modal.ts — the home screen's "תצפית קולית חכמה"
 * button: dictate a whole field note in one go, then let Claude (via the
 * parseVoiceObservation Cloud Function — see lib/voice-ai.ts) turn it into
 * a multi-species observation with location/tags/notes already filled in,
 * ready for the user to review and save on the normal form.
 *
 * Unlike the form's own mic button (voice-dictation.ts + voice-parse.ts,
 * one short phrase -> one species row via closed-vocabulary matching), this
 * listens continuously across pauses so a whole rambling field note can be
 * captured in one recording, and hands the understanding off to an LLM
 * instead of regex matching. */

import { showModal, toast } from './ui';
import { escapeHtml } from './markdown';
import { icon } from './icons';
import { startDictation, stopDictation, isDictating, isVoiceDictationSupported } from './voice-dictation';
import { parseObservationWithAi } from './voice-ai';
import { listSpecies, listLocationRows, listTagRows } from '../db/repository';
import { navigate } from '../main';

export function openSmartVoiceModal(): void {
  if (!isVoiceDictationSupported()) {
    toast('הדפדפן הזה לא תומך בהכתבה קולית — נסו דפדפן Chrome, ורק כשיש חיבור אינטרנט', true, 6000);
    return;
  }

  const wrap = document.createElement('div');
  wrap.className = 'voice-ai-modal';
  wrap.innerHTML = `
    <h3>${icon('sparkles')} תצפית קולית חכמה</h3>
    <p class="hint">ספרו בקול חופשי מה ראיתם — כמה מיני ציפורים, איפה, וכל פרט אחר. AI יבנה מזה תצפית מלאה שתוכלו לבדוק ולשמור.</p>
    <div class="voice-ai-transcript" id="voice-ai-transcript"></div>
    <div class="track-status voice-status" id="voice-ai-status" hidden>
      <span class="track-dot"></span>
      <span>מקשיב...</span>
    </div>
    <div class="modal-actions">
      <button type="button" class="btn btn-primary" id="voice-ai-toggle">${icon('mic')} התחלת הקלטה</button>
      <button type="button" class="btn" id="voice-ai-cancel">ביטול</button>
    </div>
  `;
  const close = showModal(wrap);

  let finalText = '';
  const transcriptEl = wrap.querySelector<HTMLElement>('#voice-ai-transcript')!;
  const statusEl = wrap.querySelector<HTMLElement>('#voice-ai-status')!;
  const toggleBtn = wrap.querySelector<HTMLButtonElement>('#voice-ai-toggle')!;
  const cancelBtn = wrap.querySelector<HTMLButtonElement>('#voice-ai-cancel')!;

  function renderTranscript(interim = ''): void {
    transcriptEl.innerHTML = `${escapeHtml(finalText)}${interim ? `<span class="voice-ai-interim">${escapeHtml(interim)}</span>` : ''}`;
  }

  function stopAndClose(): void {
    if (isDictating()) stopDictation();
    close();
  }

  cancelBtn.addEventListener('click', stopAndClose);

  toggleBtn.addEventListener('click', () => {
    if (isDictating()) {
      stopDictation();
      return;
    }
    finalText = '';
    renderTranscript();
    statusEl.hidden = false;
    toggleBtn.innerHTML = `${icon('mic')} סיום הקלטה`;
    startDictation(
      {
        onInterim: (text) => renderTranscript(text),
        onFinal: (text) => { finalText = finalText ? `${finalText} ${text}` : text; renderTranscript(); },
        onError: (msg) => toast(msg, true, 5000),
        onEnd: () => {
          statusEl.hidden = true;
          toggleBtn.disabled = true;
          toggleBtn.innerHTML = `${icon('sparkles')} מנתח...`;
          void finishAndParse();
        },
      },
      { continuous: true },
    );
  });

  async function finishAndParse(): Promise<void> {
    const transcript = finalText.trim();
    if (!transcript) { close(); return; }

    const [knownSpecies, locationRows, tagRows] = await Promise.all([listSpecies(), listLocationRows(), listTagRows()]);
    const result = await parseObservationWithAi(transcript, knownSpecies, locationRows.map((l) => l.name), tagRows.map((t) => t.name));

    close();
    if (!result || !result.entries.length) {
      toast('לא הצלחנו לנתח את ההקלטה אוטומטית — התמלול נשמר בהערות, השלימו את שאר הפרטים ידנית', true, 6000);
      navigate('form', { prefillNotes: transcript });
      return;
    }
    navigate('form', {
      prefillEntries: result.entries,
      prefillTags: result.tags,
      locationName: result.locationName || undefined,
      prefillNotes: result.notes || transcript,
    });
  }
}
