/* views/settings-assistant.ts — Settings → עוזר קולי: the Gemini API key
 * (kept on this device only, see lib/gemini.ts) and, optionally, a model
 * chosen by hand instead of the automatic pick. */

import { getGeminiKey, setGeminiKey, getManualModel, setManualModel, currentModel, geminiText, cleanKey, keyKind, GeminiError } from '../lib/gemini';
import { escapeHtml } from '../lib/markdown';
import { toast, withBusyButton } from '../lib/ui';
import { qs } from '../lib/dom';

/** A Gemini key from AI Studio is 39 characters, starting with "AIza". */
const STUDIO_KEY_LENGTH = 39;

/** "AIza…k3Xw · 39 תווים · AI Studio" — enough to recognise the key without
 * showing it, and which service it will be sent to. */
function keySummary(key: string): string {
  if (!key) return 'אין מפתח שמור.';
  const base = `מפתח שמור: ${key.slice(0, 4)}…${key.slice(-4)} · ${key.length} תווים`;
  if (keyKind(key) === 'vertex') return `${base} · Google Cloud (Vertex AI)`;
  const shape = key.length === STUDIO_KEY_LENGTH ? '' : ` — מפתח AI Studio רגיל אורכו ${STUDIO_KEY_LENGTH} תווים, כדאי להעתיק שוב`;
  return `${base} · Google AI Studio${shape}`;
}

export function assistantHtml(): string {
  const key = getGeminiKey();
  return `
    <div class="settings-card">
      <p style="margin-top:0">העוזר הקולי פותח תצפית מתמשכת ("תפתח תצפית בנחל תבור"), מוסיף אליה ציפורים ("תוסיף 2 חיוואים"), סוגר אותה ("סגור תצפית"), ועונה על שאלות על היסטוריית התצפיות ("מתי ראיתי נשר מקראי?"). ההבנה של המשפטים נעשית ב-Gemini של Google.</p>
      <h4>מפתח Gemini</h4>
      <p class="hint">עובד עם שני סוגי מפתחות. האפליקציה מזהה לבד את הסוג:</p>
      <ul class="hint" style="padding-inline-start:18px">
        <li><b>Google AI Studio</b> (מתחיל ב-AIza): מ-<a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener">aistudio.google.com/apikey</a> ← <b>Create API key</b> ← <b>Copy</b>.</li>
        <li><b>Google Cloud / Vertex AI</b> (מתחיל למשל ב-AQ.): מפתח API מ-Google Cloud. בפרויקט צריך שה-Vertex AI API יהיה מופעל.</li>
      </ul>
      <p class="hint">מדביקים כאן ולוחצים "שמירה ובדיקה". המפתח נשמר רק במכשיר הזה (לא בענן ולא בקוד), ובכל מכשיר נוסף מדביקים אותו שוב.</p>
      <div class="field">
        <input type="text" id="s-gemini-key" placeholder="${key ? 'להחלפה: מדביקים כאן מפתח חדש' : 'מדביקים כאן את המפתח (AIza... או AQ....)'}"
          autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" dir="ltr">
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button type="button" class="btn btn-primary" id="s-gemini-save">שמירה ובדיקה</button>
        ${key ? '<button type="button" class="btn" id="s-gemini-test">בדיקה חוזרת</button><button type="button" class="btn btn-danger" id="s-gemini-clear">מחיקת המפתח</button>' : ''}
      </div>
      <p class="hint" id="s-gemini-key-summary">${escapeHtml(keySummary(key))}</p>
      <p class="settings-status" id="s-gemini-status" style="white-space:pre-wrap;overflow-wrap:anywhere"></p>

      <h4>מודל</h4>
      <div class="field">
        <input type="text" id="s-gemini-model" value="${escapeHtml(getManualModel())}" placeholder="אוטומטי (המודל ה-Flash העדכני)" dir="ltr"
          autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false">
      </div>
      <p class="hint">משאירים ריק כדי שהאפליקציה תבחר לבד מודל שעובד עם המפתח. <span id="s-gemini-model-now"></span></p>
    </div>`;
}

export function wireAssistant(container: HTMLElement): void {
  const keyEl = qs<HTMLInputElement>(container, '#s-gemini-key');
  const modelEl = qs<HTMLInputElement>(container, '#s-gemini-model');
  const status = qs(container, '#s-gemini-status');
  const summary = qs(container, '#s-gemini-key-summary');
  const modelNow = qs(container, '#s-gemini-model-now');

  const showModel = (): void => {
    if (!getGeminiKey()) { modelNow.textContent = ''; return; }
    void currentModel().then((m) => { modelNow.textContent = `בשימוש עכשיו: ${m}`; }).catch(() => { modelNow.textContent = ''; });
  };
  showModel();

  async function test(btn: HTMLButtonElement): Promise<void> {
    status.className = 'settings-status';
    status.textContent = '';
    await withBusyButton(btn, 'בודק...', async () => {
      try {
        await geminiText('ענה במילה אחת.', 'כתוב: תקין');
        status.className = 'settings-status ok';
        status.textContent = `המפתח עובד ✓ (מודל: ${await currentModel()})`;
        toast('העוזר הקולי מוכן ✓');
      } catch (err) {
        const e = err as Error;
        const detail = err instanceof GeminiError && err.detail ? `\nתשובת Google: ${err.detail}` : '';
        status.className = 'settings-status err';
        status.textContent = `הבדיקה נכשלה: ${e.message}${detail}`;
      }
      showModel();
    });
  }

  const saveBtn = qs<HTMLButtonElement>(container, '#s-gemini-save');
  saveBtn.addEventListener('click', () => {
    const typed = cleanKey(keyEl.value);
    if (typed) setGeminiKey(typed);
    setManualModel(modelEl.value);
    keyEl.value = '';
    summary.textContent = keySummary(getGeminiKey());
    if (!getGeminiKey()) { status.textContent = 'לא הודבק מפתח.'; return; }
    void test(saveBtn);
  });

  const testBtn = container.querySelector<HTMLButtonElement>('#s-gemini-test');
  testBtn?.addEventListener('click', () => void test(testBtn));

  container.querySelector('#s-gemini-clear')?.addEventListener('click', () => {
    setGeminiKey('');
    keyEl.value = '';
    summary.textContent = keySummary('');
    status.textContent = 'המפתח נמחק מהמכשיר.';
    showModel();
  });
}
