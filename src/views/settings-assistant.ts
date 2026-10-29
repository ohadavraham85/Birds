/* views/settings-assistant.ts — Settings → עוזר קולי: the Gemini API key
 * (kept on this device only, see lib/gemini.ts) and, optionally, a model
 * chosen by hand instead of the automatic pick. */

import { getGeminiKey, setGeminiKey, getManualModel, setManualModel, currentModel, geminiText } from '../lib/gemini';
import { escapeHtml } from '../lib/markdown';
import { toast, withBusyButton } from '../lib/ui';
import { qs } from '../lib/dom';

export function assistantHtml(): string {
  const key = getGeminiKey();
  return `
    <div class="settings-card">
      <p style="margin-top:0">העוזר הקולי פותח תצפית מתמשכת ("תפתח תצפית בנחל תבור"), מוסיף אליה ציפורים ("תוסיף 2 חיוואים"), סוגר אותה ("סגור תצפית"), ועונה על שאלות על היסטוריית התצפיות ("מתי ראיתי נשר מקראי?"). ההבנה של המשפטים נעשית ב-Gemini של Google.</p>
      <h4>מפתח Gemini</h4>
      <ol class="hint" style="padding-inline-start:18px">
        <li>נכנסים ל-<a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener">aistudio.google.com/apikey</a> עם חשבון Google.</li>
        <li>לוחצים <b>Create API key</b> ומעתיקים את המפתח.</li>
        <li>מדביקים כאן ושומרים. המפתח נשמר רק במכשיר הזה (לא בענן ולא בקוד), ובכל מכשיר נוסף מדביקים אותו שוב.</li>
      </ol>
      <div class="field">
        <input type="password" id="s-gemini-key" value="${escapeHtml(key)}" placeholder="AIza..." autocomplete="off" dir="ltr">
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button type="button" class="btn btn-primary" id="s-gemini-save">שמירה ובדיקה</button>
        ${key ? '<button type="button" class="btn btn-danger" id="s-gemini-clear">מחיקת המפתח</button>' : ''}
      </div>
      <p class="settings-status" id="s-gemini-status">${key ? 'מפתח שמור במכשיר.' : 'אין מפתח שמור.'}</p>

      <h4>מודל</h4>
      <div class="field">
        <input type="text" id="s-gemini-model" value="${escapeHtml(getManualModel())}" placeholder="אוטומטי (המודל ה-Flash העדכני)" dir="ltr">
      </div>
      <p class="hint">משאירים ריק כדי שהאפליקציה תבחר לבד את המודל העדכני. <span id="s-gemini-model-now"></span></p>
    </div>`;
}

export function wireAssistant(container: HTMLElement): void {
  const keyEl = qs<HTMLInputElement>(container, '#s-gemini-key');
  const modelEl = qs<HTMLInputElement>(container, '#s-gemini-model');
  const status = qs(container, '#s-gemini-status');
  const modelNow = qs(container, '#s-gemini-model-now');

  const showModel = (): void => {
    if (!getGeminiKey()) { modelNow.textContent = ''; return; }
    void currentModel().then((m) => { modelNow.textContent = `בשימוש עכשיו: ${m}`; }).catch(() => { modelNow.textContent = ''; });
  };
  showModel();

  const saveBtn = qs<HTMLButtonElement>(container, '#s-gemini-save');
  saveBtn.addEventListener('click', () => {
    setGeminiKey(keyEl.value);
    setManualModel(modelEl.value);
    if (!getGeminiKey()) { status.textContent = 'אין מפתח שמור.'; return; }
    void withBusyButton(saveBtn, 'בודק...', async () => {
      try {
        await geminiText('ענה במילה אחת.', 'כתוב: תקין');
        status.textContent = 'המפתח נשמר ועובד ✓';
        toast('העוזר הקולי מוכן ✓');
      } catch (err) {
        status.textContent = `המפתח נשמר, אבל הבדיקה נכשלה: ${(err as Error).message}`;
      }
      showModel();
    });
  });

  container.querySelector('#s-gemini-clear')?.addEventListener('click', () => {
    setGeminiKey('');
    keyEl.value = '';
    status.textContent = 'המפתח נמחק מהמכשיר.';
    showModel();
  });
}
