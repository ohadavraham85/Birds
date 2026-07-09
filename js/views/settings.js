/* views/settings.js — הגדרות: חיבור Google Drive, ניהול רשימת המינים,
 * וניהול נתונים מקומיים. */

import {
  getSetting, setSetting, listSpecies, addSpecies, removeSpecies,
  clearAllData, listObservations,
} from '../db.js';
import { toast, confirmDialog, fmtDateTime } from '../ui.js';
import { escapeHtml } from '../markdown.js';
import { ensureToken, disconnect, isConnected, syncNow, SPREADSHEET_NAME } from '../drive.js';

let container = null;

export function init(el) {
  container = el;
}

export async function activate() {
  const clientId = await getSetting('googleClientId', '');
  const lastSync = await getSetting('lastSync');
  const spreadsheetId = await getSetting('spreadsheetId');
  const obsCount = (await listObservations()).length;

  container.innerHTML = `
    <h2>הגדרות</h2>

    <div class="settings-card">
      <h3>☁️ חיבור ל-Google Drive</h3>
      <p style="font-size:.9rem;color:var(--ink-soft);margin-top:0">
        כל הנתונים נשמרים בלעדית בחשבון ה-Google Drive הפרטי שלכם: גיליון עם
        שני לשוניות ("תצפיות" ו"רשימת מינים") ותיקיות לתמונות ולדוחות.
        להפעלה חד-פעמית יש ליצור OAuth Client ID — הוראות מלאות בקובץ README.
      </p>
      <div class="field">
        <label for="s-client-id">Google OAuth Client ID</label>
        <input type="text" id="s-client-id" dir="ltr" style="text-align:left"
               placeholder="xxxxx.apps.googleusercontent.com" value="${escapeHtml(clientId)}">
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn btn-primary" id="s-connect">${isConnected() ? '🔄 סנכרון עכשיו' : '🔗 התחברות וסנכרון'}</button>
        <button class="btn" id="s-disconnect" ${clientId ? '' : 'disabled'}>ניתוק</button>
      </div>
      <div class="settings-status ${isConnected() ? 'ok' : ''}" id="s-status">
        ${isConnected() ? 'מחובר ל-Google Drive ✓' : clientId ? 'מוגדר — יש להתחבר ולסנכרן' : 'לא הוגדר חיבור'}
        ${lastSync ? ` · סנכרון אחרון: ${fmtDateTime(lastSync)}` : ''}
      </div>
      ${spreadsheetId ? `
        <div class="settings-status">
          📄 <a href="https://docs.google.com/spreadsheets/d/${escapeHtml(spreadsheetId)}" target="_blank" rel="noopener">
          פתיחת הגיליון "${SPREADSHEET_NAME}" ב-Google Sheets</a>
        </div>` : ''}
    </div>

    <div class="settings-card">
      <h3>🐦 רשימת מינים (גיליון המאסטר)</h3>
      <p style="font-size:.9rem;color:var(--ink-soft);margin-top:0">
        הרשימה משמשת את תיבת הבחירה בטופס הדיווח ומסתנכרנת עם גיליון
        "רשימת מינים" בדרייב.
      </p>
      <div class="add-species-row">
        <input type="text" id="s-new-species" placeholder="שם מין חדש...">
        <button class="btn" id="s-add-species">➕ הוספה</button>
      </div>
      <div class="species-list" id="s-species-list"></div>
    </div>

    <div class="settings-card">
      <h3>🗄️ נתונים מקומיים</h3>
      <p style="font-size:.9rem;color:var(--ink-soft);margin-top:0">
        במכשיר זה שמורות כרגע ${obsCount} תצפיות (לעבודה בשטח גם ללא רשת).
      </p>
      <button class="btn btn-danger" id="s-clear">🗑️ מחיקת כל הנתונים המקומיים</button>
    </div>
  `;

  container.querySelector('#s-connect').addEventListener('click', onConnect);
  container.querySelector('#s-disconnect').addEventListener('click', onDisconnect);
  container.querySelector('#s-add-species').addEventListener('click', onAddSpecies);
  container.querySelector('#s-new-species').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); onAddSpecies(); }
  });
  container.querySelector('#s-clear').addEventListener('click', onClearData);
  await renderSpeciesList();
}

async function renderSpeciesList() {
  const listEl = container.querySelector('#s-species-list');
  const species = await listSpecies();
  listEl.innerHTML = species
    .map((s) => `
      <div class="sp-row">
        <span>${escapeHtml(s)}</span>
        <button data-name="${escapeHtml(s)}" title="הסרה">✕</button>
      </div>`)
    .join('');
  listEl.querySelectorAll('button[data-name]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (await confirmDialog(`להסיר את "${btn.dataset.name}" מרשימת המינים?`, 'הסרה')) {
        await removeSpecies(btn.dataset.name);
        await renderSpeciesList();
      }
    });
  });
}

async function onAddSpecies() {
  const input = container.querySelector('#s-new-species');
  const name = input.value.trim();
  if (!name) return;
  await addSpecies(name);
  input.value = '';
  toast(`"${name}" נוסף לרשימת המינים`);
  await renderSpeciesList();
}

async function onConnect() {
  const clientId = container.querySelector('#s-client-id').value.trim();
  if (!clientId) {
    toast('יש להזין Google Client ID (הוראות יצירה בקובץ README)', true, 5000);
    return;
  }
  await setSetting('googleClientId', clientId);
  await setSetting('setupHintShown', true);
  const status = container.querySelector('#s-status');
  const btn = container.querySelector('#s-connect');
  btn.disabled = true;
  try {
    status.textContent = 'מתחבר...';
    await ensureToken(true);
    const res = await syncNow((msg) => { status.textContent = msg; });
    status.className = 'settings-status ok';
    toast(`מחובר ✓ — ${res.count} תצפיות מסונכרנות`);
    await activate();
  } catch (err) {
    console.error(err);
    status.className = 'settings-status err';
    status.textContent = err.message;
    toast(err.message, true, 6000);
  } finally {
    btn.disabled = false;
  }
}

async function onDisconnect() {
  disconnect();
  if (await confirmDialog('לנתק ולשכוח גם את פרטי החיבור (Client ID והגיליון)?', 'ניתוק מלא')) {
    await setSetting('googleClientId', '');
    await setSetting('spreadsheetId', null);
    await setSetting('mediaFolderId', null);
    await setSetting('reportsFolderId', null);
  }
  toast('נותק מ-Google Drive');
  await activate();
}

async function onClearData() {
  const ok = await confirmDialog(
    'למחוק את כל התצפיות והתמונות השמורות במכשיר זה? נתונים שסונכרנו ל-Google Drive יישארו בענן.',
    'מחיקת הכל',
  );
  if (!ok) return;
  await clearAllData();
  toast('הנתונים המקומיים נמחקו');
  await activate();
}
