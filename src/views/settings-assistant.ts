/* views/settings-assistant.ts — Settings → עוזר קולי: the Gemini API key
 * (pasted once and shared with the other devices through Firebase, see
 * lib/gemini.ts) and, optionally, a model chosen by hand instead of the
 * automatic pick. */

import { getGeminiKey, saveGeminiKeyEverywhere, getManualModel, setManualModel, currentModel, geminiText, cleanKey, knownEndpoint, ENDPOINT_LABEL, GeminiError } from '../lib/gemini';
import { escapeHtml } from '../lib/markdown';
import { toast, withBusyButton } from '../lib/ui';
import { qs } from '../lib/dom';
import { isFirebaseSyncActive } from '../firebase/firestore-sync';

/** A Gemini key from AI Studio is 39 characters, starting with "AIza". */
const STUDIO_KEY_LENGTH = 39;

/** "AIza…k3Xw · 39 תווים · AI Studio" — enough to recognise the key without
 * showing it, and which service it will be sent to. */
function keySummary(key: string): string {
  if (!key) return 'אין מפתח שמור.';
  const base = `מפתח שמור: ${key.slice(0, 4)}…${key.slice(-4)} · ${key.length} תווים`;
  const endpoint = knownEndpoint();
  const where = endpoint ? ` · ${ENDPOINT_LABEL[endpoint]}` : '';
  const shape = key.startsWith('AIza') && key.length !== STUDIO_KEY_LENGTH ? ` — מפתח AIza רגיל אורכו ${STUDIO_KEY_LENGTH} תווים, כדאי להעתיק שוב` : '';
  return `${base}${where}${shape}`;
}

export function assistantHtml(): string {
  const key = getGeminiKey();
  return `
    <div class="settings-card">
      <p style="margin-top:0">העוזר הקולי פותח תצפית מתמשכת ("תפתח תצפית בנחל תבור"), מוסיף אליה ציפורים ("תוסיף 2 חיוואים"), סוגר אותה ("סגור תצפית"), ועונה על שאלות על היסטוריית התצפיות ("מתי ראיתי נשר מקראי?"). ההבנה של המשפטים נעשית ב-Gemini של Google.</p>
      <h4>מפתח Gemini</h4>
      <p class="hint">מוציאים מפתח ב-<a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener">aistudio.google.com/apikey</a> ← <b>Create API key</b> ← <b>Copy</b>. המפתח יכול להתחיל ב-AIza או ב-AQ.. גם מפתח מ-Google Cloud עם הרשאה ל-Vertex AI עובד, והאפליקציה מזהה לבד לאן לשלוח אותו.</p>
      <p class="hint">מדביקים כאן ולוחצים "שמירה ובדיקה". ${isFirebaseSyncActive()
        ? 'המפתח נשמר בסנכרון לענן (עם קוד המשפחה) ומגיע לבד לשאר המכשירים, כך שמדביקים אותו פעם אחת.'
        : 'הסנכרון לענן לא מופעל, ולכן המפתח נשמר רק במכשיר הזה. כשמפעילים סנכרון (הגדרות ← סנכרון וגיבוי), הוא יעבור לבד לשאר המכשירים.'}</p>
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
        summary.textContent = keySummary(getGeminiKey());
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
  saveBtn.addEventListener('click', () => void (async () => {
    const typed = cleanKey(keyEl.value);
    setManualModel(modelEl.value);
    keyEl.value = '';
    const shared = typed ? await saveGeminiKeyEverywhere(typed) : true;
    summary.textContent = keySummary(getGeminiKey());
    if (!getGeminiKey()) { status.textContent = 'לא הודבק מפתח.'; return; }
    await test(saveBtn);
    if (typed && !shared && isFirebaseSyncActive()) status.textContent += '\nשימו לב: לא הצלחתי לשמור את המפתח בענן כרגע, ולכן הוא שמור רק במכשיר הזה. שומרים שוב כשיש רשת.';
  })());

  const testBtn = container.querySelector<HTMLButtonElement>('#s-gemini-test');
  testBtn?.addEventListener('click', () => void test(testBtn));

  container.querySelector('#s-gemini-clear')?.addEventListener('click', () => void (async () => {
    const shared = await saveGeminiKeyEverywhere('');
    keyEl.value = '';
    summary.textContent = keySummary('');
    status.className = 'settings-status';
    status.textContent = shared ? 'המפתח נמחק מכל המכשירים.' : 'המפתח נמחק מהמכשיר הזה.';
    showModel();
  })());
}
