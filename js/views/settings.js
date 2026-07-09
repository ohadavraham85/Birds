/* views/settings.js — הגדרות POC: ניהול רשימת המינים, גיבוי/שחזור מלא
 * וניהול הנתונים המקומיים. הכול בקליינט — ללא שום צד שרת. */

import {
  listSpecies, addSpecies, removeSpecies,
  clearAllData, listObservations, listObservationsRaw,
  putObservationRaw, saveMedia, mediaForObservation, seedSpeciesIfEmpty,
} from '../db.js';
import { toast, confirmDialog } from '../ui.js';
import { escapeHtml } from '../markdown.js';

let container = null;

export function init(el) {
  container = el;
}

export async function activate() {
  const obsCount = (await listObservations()).length;
  let version = '';
  try {
    version = (await (await fetch('version.json')).json()).version;
  } catch { /* dev mode — no version stamp */ }

  container.innerHTML = `
    <h2>הגדרות</h2>

    <div class="settings-card">
      <h3>🐦 רשימת מינים (רשימת המאסטר)</h3>
      <p style="font-size:.9rem;color:var(--ink-soft);margin-top:0">
        הרשימה משמשת את תיבת הבחירה בטופס הדיווח — הדיווח מוגבל למינים שבה בלבד.
      </p>
      <div class="add-species-row">
        <input type="text" id="s-new-species" placeholder="שם מין חדש...">
        <button class="btn" id="s-add-species">➕ הוספה</button>
      </div>
      <div class="species-list" id="s-species-list"></div>
    </div>

    <div class="settings-card">
      <h3>💾 גיבוי ושחזור</h3>
      <p style="font-size:.9rem;color:var(--ink-soft);margin-top:0">
        גרסת POC — כל הנתונים (כולל תמונות באיכות מקור) נשמרים במכשיר זה בלבד.
        מומלץ להוריד קובץ גיבוי מדי פעם; אפשר לשחזר אותו בכל מכשיר אחר.
      </p>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn btn-primary" id="s-backup">⬇️ הורדת קובץ גיבוי מלא</button>
        <label class="btn" style="cursor:pointer">
          ⬆️ שחזור מקובץ גיבוי
          <input type="file" id="s-restore" accept=".json,application/json" hidden>
        </label>
      </div>
    </div>

    <div class="settings-card">
      <h3>🎬 נתוני הדגמה</h3>
      <p style="font-size:.9rem;color:var(--ink-soft);margin-top:0">
        רוצים לראות איך האפליקציה נראית מלאה? טענו 12 תצפיות לדוגמה (עם מפה,
        תמונות והערות). אפשר להסיר אותן בלחיצה בלי לפגוע בתצפיות אמיתיות.
      </p>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn btn-primary" id="s-demo-load">🎬 טעינת נתוני דמה</button>
        <button class="btn" id="s-demo-remove">🧹 הסרת נתוני הדמה</button>
      </div>
    </div>

    <div class="settings-card">
      <h3>🗄️ נתונים מקומיים</h3>
      <p style="font-size:.9rem;color:var(--ink-soft);margin-top:0">
        במכשיר זה שמורות כרגע ${obsCount} תצפיות.
        ${version ? `· גרסת אפליקציה: v${escapeHtml(version)}` : ''}
      </p>
      <button class="btn btn-danger" id="s-clear">🗑️ מחיקת כל הנתונים</button>
    </div>
  `;

  container.querySelector('#s-add-species').addEventListener('click', onAddSpecies);
  container.querySelector('#s-new-species').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); onAddSpecies(); }
  });
  container.querySelector('#s-backup').addEventListener('click', onBackup);
  container.querySelector('#s-restore').addEventListener('change', onRestore);
  container.querySelector('#s-clear').addEventListener('click', onClearData);
  container.querySelector('#s-demo-load').addEventListener('click', onLoadDemo);
  container.querySelector('#s-demo-remove').addEventListener('click', onRemoveDemo);
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

/* ---------- full backup / restore (JSON, images as base64) ---------- */

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = reject;
    r.readAsDataURL(blob);
  });
}

async function dataUrlToBlob(dataUrl) {
  return (await fetch(dataUrl)).blob();
}

async function onBackup() {
  toast('מכין קובץ גיבוי...', false, 8000);
  const observations = await listObservationsRaw();
  const species = await listSpecies();
  const media = [];
  for (const o of observations) {
    for (const m of await mediaForObservation(o.id)) {
      media.push({
        id: m.id,
        obsId: m.obsId,
        name: m.name,
        mime: m.mime,
        data: await blobToDataUrl(m.blob),
      });
    }
  }
  const backup = {
    app: 'birds-journal',
    format: 1,
    exportedAt: new Date().toISOString(),
    species,
    observations,
    media,
  };
  const blob = new Blob([JSON.stringify(backup)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `גיבוי-תצפיות-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
  toast(`קובץ הגיבוי הורד ✓ (${observations.length} תצפיות, ${media.length} תמונות)`);
}

async function onRestore(e) {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  let backup;
  try {
    backup = JSON.parse(await file.text());
    if (backup.app !== 'birds-journal' || !Array.isArray(backup.observations)) throw new Error();
  } catch {
    toast('קובץ גיבוי לא תקין', true);
    return;
  }
  const ok = await confirmDialog(
    `לשחזר ${backup.observations.length} תצפיות מהגיבוי? הן יתווספו לנתונים הקיימים (תצפיות עם אותו מזהה יוחלפו).`,
    'שחזור',
  );
  if (!ok) return;
  for (const name of backup.species || []) await addSpecies(name);
  for (const o of backup.observations) await putObservationRaw(o);
  for (const m of backup.media || []) {
    await saveMedia({
      id: m.id,
      obsId: m.obsId,
      name: m.name,
      mime: m.mime,
      blob: await dataUrlToBlob(m.data),
    });
  }
  toast('השחזור הושלם ✓');
  await activate();
}

async function onLoadDemo() {
  const btn = container.querySelector('#s-demo-load');
  btn.disabled = true;
  try {
    const { loadDemoData } = await import('../demo-data.js');
    const n = await loadDemoData();
    toast(`נטענו ${n} תצפיות לדוגמה — עברו למסכי היומן, הרשימה והמפה 🎉`, false, 5000);
    await activate();
  } finally {
    btn.disabled = false;
  }
}

async function onRemoveDemo() {
  const { removeDemoData } = await import('../demo-data.js');
  const n = await removeDemoData();
  toast(n ? `הוסרו ${n} תצפיות דמה` : 'אין נתוני דמה להסרה');
  await activate();
}

async function onClearData() {
  const ok = await confirmDialog(
    'למחוק את כל התצפיות והתמונות השמורות במכשיר זה? פעולה זו אינה הפיכה (מומלץ להוריד גיבוי קודם).',
    'מחיקת הכל',
  );
  if (!ok) return;
  await clearAllData();
  toast('כל הנתונים נמחקו');
  await activate();
}
