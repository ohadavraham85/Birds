/* lib/voice-assistant-modal.ts — the voice assistant's window: the active
 * ongoing observation at the top, the conversation in the middle, and a mic
 * button + text box at the bottom. Each sentence goes to
 * lib/voice-assistant.ts's runCommand(); speech-to-text is the browser's own
 * (lib/voice-dictation.ts), so typing works too where the mic doesn't. */

import { showModal, toast } from './ui';
import { escapeHtml } from './markdown';
import { icon, geminiIcon } from './icons';
import { startDictation, stopDictation, isDictating, isVoiceDictationSupported } from './voice-dictation';
import { hasGeminiKey, syncGeminiKey } from './gemini';
import { runCommand, getActiveObservation, closeActiveObservation, undoLast, canUndo, fmtDuration, type AssistantResult } from './voice-assistant';
import { entriesOf } from './observation';
import { navigate } from '../main';
import type { Observation } from '../types';

const EXAMPLES = ['תפתח תצפית בנחל תבור', 'תוסיף 2 חיוואים', 'ראיתי עוד כוס חורבות', 'סגור תצפית', 'מתי ראיתי נשר מקראי בתקופה האחרונה?'];

/** Takes the key pasted on another device first (lib/gemini.ts's syncGeminiKey). */
export function openVoiceAssistant(): void {
  void syncGeminiKey().then(showVoiceAssistant);
}

function showVoiceAssistant(): void {
  const wrap = document.createElement('div');
  wrap.className = 'va';
  if (!hasGeminiKey()) {
    wrap.innerHTML = `
      <h3>${geminiIcon()} עוזר קולי</h3>
      <p>כדי שהעוזר יעבוד צריך מפתח Gemini אישי (חינמי). מוסיפים אותו פעם אחת בהגדרות ← עוזר קולי.</p>
      <div class="modal-actions">
        <button type="button" class="btn btn-primary" id="va-settings">${icon('gear')} להגדרות</button>
        <button type="button" class="btn" id="va-close">סגירה</button>
      </div>`;
    const close = showModal(wrap);
    wrap.querySelector('#va-settings')!.addEventListener('click', () => { close(); navigate('settings', { settingsCategory: 'assistant' }); });
    wrap.querySelector('#va-close')!.addEventListener('click', close);
    return;
  }

  const micSupported = isVoiceDictationSupported();
  wrap.innerHTML = `
    <h3>${geminiIcon()} עוזר קולי</h3>
    <div class="va-session" id="va-session"></div>
    <div class="va-log" id="va-log">
      <p class="hint va-examples">אפשר לומר למשל:<br>${EXAMPLES.map((e) => `<span class="va-example">"${escapeHtml(e)}"</span>`).join('<br>')}</p>
    </div>
    <form class="va-input" id="va-form">
      ${micSupported ? `<button type="button" class="btn btn-icon va-mic" id="va-mic" title="דיבור" aria-label="דיבור">${icon('mic')}</button>` : ''}
      <input type="text" id="va-text" placeholder="${micSupported ? 'מדברים או כותבים כאן...' : 'כותבים כאן...'}" autocomplete="off">
      <button type="submit" class="btn btn-primary" id="va-send">שליחה</button>
    </form>
    <div class="modal-actions">
      <button type="button" class="btn" id="va-undo" hidden>${icon('refresh')} ביטול הפעולה האחרונה</button>
      <button type="button" class="btn" id="va-close">סגירה</button>
    </div>`;
  const closeModal = showModal(wrap);

  const sessionEl = wrap.querySelector<HTMLElement>('#va-session')!;
  const logEl = wrap.querySelector<HTMLElement>('#va-log')!;
  const form = wrap.querySelector<HTMLFormElement>('#va-form')!;
  const textEl = wrap.querySelector<HTMLInputElement>('#va-text')!;
  const sendBtn = wrap.querySelector<HTMLButtonElement>('#va-send')!;
  const micBtn = wrap.querySelector<HTMLButtonElement>('#va-mic');
  const undoBtn = wrap.querySelector<HTMLButtonElement>('#va-undo')!;
  let active: Observation | null = null;
  let busy = false;

  function renderSession(): void {
    if (!active) {
      sessionEl.innerHTML = '<p class="hint va-no-session">אין תצפית פעילה.</p>';
      return;
    }
    const start = active.startTime || active.dateTime;
    const minutes = Math.max(0, Math.round((Date.now() - new Date(start).getTime()) / 60000));
    const list = entriesOf(active).filter((e) => e.species);
    sessionEl.innerHTML = `
      <div class="va-session-card">
        <div class="va-session-head">
          <span class="va-live-dot" aria-hidden="true"></span>
          <strong>${escapeHtml(active.locationName || 'תצפית פעילה')}</strong>
          <span class="va-session-time">מ-${new Date(start).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })} · ${fmtDuration(minutes)}</span>
        </div>
        <div class="va-session-species">${list.length
          ? list.map((e) => `<span class="va-chip">${escapeHtml(e.species)}${e.quantity > 1 ? ` ×${e.quantity}` : ''}</span>`).join('')
          : '<span class="hint">עדיין אין מינים</span>'}</div>
        <div class="va-session-actions">
          <button type="button" class="btn btn-sm" id="va-open-obs">${icon('journal')} פתיחת התצפית</button>
          <button type="button" class="btn btn-sm btn-primary" id="va-close-obs">${icon('check')} סגירת תצפית</button>
        </div>
      </div>`;
  }

  function addBubble(text: string, who: 'user' | 'bot' | 'error'): void {
    logEl.querySelector('.va-examples')?.remove();
    const b = document.createElement('div');
    b.className = `va-bubble va-${who}`;
    b.textContent = text;
    logEl.appendChild(b);
    logEl.scrollTop = logEl.scrollHeight;
  }

  function setBusy(on: boolean): void {
    busy = on;
    sendBtn.disabled = on;
    if (micBtn) micBtn.disabled = on;
    sendBtn.textContent = on ? 'רגע...' : 'שליחה';
  }

  function applyResult(r: AssistantResult): void {
    active = r.active;
    addBubble(r.reply, 'bot');
    undoBtn.hidden = !canUndo();
    renderSession();
  }

  async function send(text: string): Promise<void> {
    text = text.trim();
    if (!text || busy) return;
    textEl.value = '';
    addBubble(text, 'user');
    setBusy(true);
    try {
      applyResult(await runCommand(text));
    } catch (err) {
      addBubble((err as Error).message || 'משהו השתבש.', 'error');
    } finally {
      setBusy(false);
    }
  }

  form.addEventListener('submit', (e) => { e.preventDefault(); void send(textEl.value); });

  micBtn?.addEventListener('click', () => {
    if (isDictating()) { stopDictation(); return; }
    micBtn.classList.add('listening');
    textEl.value = '';
    textEl.placeholder = 'מקשיב...';
    let heard = '';
    startDictation({
      onInterim: (t) => { textEl.value = t; },
      onFinal: (t) => { heard = t; textEl.value = t; },
      onError: (msg) => toast(msg, true, 5000),
      onEnd: () => {
        micBtn.classList.remove('listening');
        textEl.placeholder = 'מדברים או כותבים כאן...';
        if (heard.trim()) void send(heard);
      },
    });
  });

  sessionEl.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    if (t.closest('#va-open-obs') && active) { stop(); navigate('detail', { viewId: active.id }); return; }
    if (t.closest('#va-close-obs') && !busy) {
      setBusy(true);
      void closeActiveObservation().then(applyResult).finally(() => setBusy(false));
    }
  });

  undoBtn.addEventListener('click', () => {
    if (busy) return;
    setBusy(true);
    void undoLast().then((a) => {
      active = a;
      undoBtn.hidden = true;
      addBubble('הפעולה האחרונה בוטלה.', 'bot');
      renderSession();
    }).finally(() => setBusy(false));
  });

  const timer = window.setInterval(() => { if (document.body.contains(wrap)) renderSession(); else window.clearInterval(timer); }, 30000);

  function stop(): void {
    if (isDictating()) stopDictation();
    window.clearInterval(timer);
    closeModal();
  }
  wrap.querySelector('#va-close')!.addEventListener('click', stop);

  void getActiveObservation().then((a) => { active = a; renderSession(); });
  renderSession();
}

/** Top-of-screen entry point (home and journal): the active ongoing
 * observation when there is one, otherwise just the button. Clicks are
 * handled by the host view via `[data-voice-assistant]`. */
export function voiceAssistantBarHtml(active: Observation | undefined, withButton: boolean): string {
  if (active) {
    const start = active.startTime || active.dateTime;
    const n = entriesOf(active).filter((e) => e.species).length;
    return `
      <button type="button" class="va-banner" data-voice-assistant>
        <span class="va-live-dot" aria-hidden="true"></span>
        <span class="va-banner-text"><strong>תצפית פעילה${active.locationName ? ` · ${escapeHtml(active.locationName)}` : ''}</strong>
          <span>מ-${new Date(start).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })} · ${n} מינים</span></span>
        <span class="va-banner-mic">${geminiIcon()}</span>
      </button>`;
  }
  return withButton ? `<button type="button" class="btn btn-block va-open-btn" data-voice-assistant>${geminiIcon('va-badge')} עוזר קולי</button>` : '';
}
