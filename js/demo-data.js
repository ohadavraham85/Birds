/* demo-data.js — נתוני דמה להתרשמות מהאפליקציה.
 * נטענים מכפתור במסך ההגדרות; כל רשומת דמה מסומנת demo:true כך שאפשר
 * למחוק את כולן בלחיצה בלי לפגוע בתצפיות אמיתיות.
 */

import { saveObservation, saveMedia, listObservationsRaw, deleteObservation } from './db.js';

const DEMO = [
  {
    d: '2026-07-07T05:42', loc: 'מחצבת שדה אליהו', lat: 32.4413, lng: 35.5108,
    proj: 'אוחים - עמק המעיינות', sp: 'אוח מצוי', q: 5, emoji: '🦉',
    notes: '# תצפית בוקר במחצבה\nהמשפחה בשלמותה: זוג הבוגרים + **3 פרחונים**.\n\n- הפרחונים כבר מנתרים בין המדפים בקיר הצפוני\n- הבוגר האכיל פעמיים בין 05:50 ל-06:20\n- קריאות ערות לאורך כל השהות',
  },
  {
    d: '2026-07-04T17:55', loc: 'נחל שחל, רמת סירין', lat: 32.6068, lng: 35.4472,
    proj: 'קינון חיוויאים 2026', sp: 'חיוויאי הנחשים', q: 2, emoji: '🦅',
    notes: '## ביקורת קן על השיזף\nהגוזל גדל יפה — מוערך בן **3 שבועות**.\n\nההורה הגיע עם נחש (זעמן?) ב-18:10. מצלמת השביל הוחלפה סוללה ונמצאה תקינה.',
  },
  {
    d: '2026-07-01T06:15', loc: 'בריכות הדגים, עמק המעיינות', lat: 32.4589, lng: 35.4936,
    proj: 'סקר קיץ', sp: 'שרקרק מצוי', q: 14, emoji: '🌈',
    notes: 'להקה פעילה מעל הבריכה המזרחית, ציד שפיריות אינטנסיבי. לפחות 3 זוגות מקננים בסוללה.',
  },
  {
    d: '2026-06-28T19:30', loc: 'מחצבת שדה אליהו', lat: 32.4409, lng: 35.5102,
    proj: 'אוחים - עמק המעיינות', sp: 'אוח מצוי', q: 2, emoji: '🦉',
    notes: 'תצפית ערב: שני פרחונים על שפת המחצבה. אחד ביצע *גלישת תעופה* ראשונה של ~15 מטר!',
  },
  {
    d: '2026-06-21T08:05', loc: 'שמורת החולה', lat: 33.0623, lng: 35.5964,
    proj: '', sp: 'עגור אפור', q: 47, emoji: '🪶',
    notes: 'להקת קייטנים סביב אגמון. ספירה מהמסתור הצפוני.',
  },
  {
    d: '2026-06-18T06:50', loc: 'נחל שחל, רמת סירין', lat: 32.6071, lng: 35.4469,
    proj: 'קינון חיוויאים 2026', sp: 'חיוויאי הנחשים', q: 1, emoji: '🦅',
    notes: '# בקיעה!\n**נצפה גוזל בקן!** ההורה הסיר קליפות ביצה מהקן ב-07:12.\n\n- הוצבה מצלמת שביל על העץ הסמוך\n- מרחק תצפית נשמר: 120 מ׳',
  },
  {
    d: '2026-06-12T11:20', loc: 'גמלא', lat: 32.9032, lng: 35.7402,
    proj: '', sp: 'נשר מקראי', q: 6, emoji: '🪽',
    notes: 'שישה פרטים בתרמיקה מעל הנחל, בהם שניים מתויגים (דגלול כנף צהוב).',
  },
  {
    d: '2026-06-05T05:35', loc: 'בריכות הדגים, עמק המעיינות', lat: 32.4601, lng: 35.4921,
    proj: 'סקר קיץ', sp: 'שלדג לבן-חזה', q: 3, emoji: '💙',
    notes: 'זוג + צעיר על חוטי החשמל לאורך התעלה. הצעיר נצפה מקבל דג מההורה.',
  },
  {
    d: '2026-05-30T20:45', loc: 'מושב שדה אליהו', lat: 32.4402, lng: 35.5115,
    proj: '', sp: 'תנשמת', q: 1, emoji: '🤍',
    notes: 'יוצאת מתיבת הקינון בכרם התמרים עם רדת החשכה.',
  },
  {
    d: '2026-05-24T06:40', loc: 'מחצבת שדה אליהו', lat: 32.4415, lng: 35.5111,
    proj: 'אוחים - עמק המעיינות', sp: 'אוח מצוי', q: 5, emoji: '🦉',
    notes: '## תיעוד ראשון של המשפחה המלאה\nזוג בוגרים + 3 פרחונים על מדף הסלע.\n\nצולם ברצף עם עדשת 600. *נקודת תצפית קבועה נבחרה בגדה המערבית.*',
  },
  {
    d: '2026-05-18T07:10', loc: 'רמת סירין', lat: 32.6103, lng: 35.4418,
    proj: 'קינון חיוויאים 2026', sp: 'חיוויאי הנחשים', q: 2, emoji: '🦅',
    notes: 'הזוג משלים בניית קן על שיזף בערוץ. הועברו ענפים פעמיים במהלך התצפית.',
  },
  {
    d: '2026-05-11T06:25', loc: 'בריכות הדגים, עמק המעיינות', lat: 32.4595, lng: 35.4948,
    proj: 'סקר קיץ', sp: 'דוכיפת', q: 2, emoji: '👑',
    notes: 'זוג מאכיל בקן שבקיר הבטון של תעלת ההזנה.',
  },
];

/* ---------- placeholder image generation (canvas, client-side) ---------- */

const PALETTES = [
  ['#2d6a4f', '#95d5b2'], ['#1d3557', '#a8dadc'], ['#7f5539', '#e6ccb2'],
  ['#354f52', '#cad2c5'], ['#5f0f40', '#fdc500'],
];

function makeDemoImage(species, emoji, seed) {
  const canvas = document.createElement('canvas');
  canvas.width = 800;
  canvas.height = 560;
  const ctx = canvas.getContext('2d');
  const [c1, c2] = PALETTES[seed % PALETTES.length];
  const g = ctx.createLinearGradient(0, 0, 800, 560);
  g.addColorStop(0, c1);
  g.addColorStop(1, c2);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 800, 560);
  // "sun"
  ctx.fillStyle = 'rgba(255,255,255,.25)';
  ctx.beginPath();
  ctx.arc(640, 120, 70, 0, Math.PI * 2);
  ctx.fill();
  // bird emoji
  ctx.font = '190px serif';
  ctx.textAlign = 'center';
  ctx.fillText(emoji, 400, 330);
  // caption
  ctx.fillStyle = 'rgba(255,255,255,.92)';
  ctx.font = 'bold 44px sans-serif';
  ctx.direction = 'rtl';
  ctx.fillText(species, 400, 460);
  ctx.font = '26px sans-serif';
  ctx.fillStyle = 'rgba(255,255,255,.75)';
  ctx.fillText('תמונת הדגמה', 400, 505);
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.9));
}

/* ---------- load / remove ---------- */

export async function loadDemoData() {
  let created = 0;
  for (const [i, item] of DEMO.entries()) {
    const id = 'demo-' + i;
    const images = [];
    // an image for roughly every second observation
    if (i % 2 === 0) {
      const blob = await makeDemoImage(item.sp, item.emoji, i);
      const mediaId = 'demo-img-' + i;
      await saveMedia({ id: mediaId, obsId: id, name: `demo-${i}.jpg`, mime: 'image/jpeg', blob });
      images.push({ localId: mediaId, name: `demo-${i}.jpg` });
    }
    await saveObservation({
      id,
      demo: true,
      dateTime: new Date(item.d).toISOString(),
      locationName: item.loc,
      lat: item.lat,
      lng: item.lng,
      project: item.proj,
      species: item.sp,
      quantity: item.q,
      images,
      notes: item.notes,
      deleted: false,
    });
    created++;
  }
  return created;
}

export async function removeDemoData() {
  const all = await listObservationsRaw();
  let removed = 0;
  for (const o of all) {
    if (o.demo) {
      await deleteObservation(o.id);
      removed++;
    }
  }
  return removed;
}

export async function hasDemoData() {
  const all = await listObservationsRaw();
  return all.some((o) => o.demo);
}
