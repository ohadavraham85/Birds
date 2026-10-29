# יומן צפרות 🦉 — PWA לניהול ותיעוד תצפיות

אפליקציית **PWA offline-first** לתיעוד תצפיות צפרות בשטח.
עובדת באופן מלא **ללא רשת**, ומסתנכרנת אוטומטית מול שרת **כשחוזרת התקשורת**.

בנויה ב-**TypeScript + Vite**, עם **Dexie** (IndexedDB מוטיפס), **Workbox**
(Service Worker, מטמון shell + Background Sync), ו-**Leaflet** למפה.

## פלטפורמה אחת — שלוש תצורות

| תצורה | התקנה |
|---|---|
| 📱 **Android (Chrome)** | תפריט ⋮ → "התקנת אפליקציה" / "הוספה למסך הבית" |
| 📱 **iPhone (Safari)** | שיתוף → "הוסף למסך הבית" |
| 💻 **דסקטופ (Chrome/Edge)** | סמל ההתקנה ⊕ בשורת הכתובת |
| 🌐 **דפדפן** | גלישה רגילה לכתובת |

## תכונות

- **טופס דיווח אחוד** — מסך אחד: תאריך, מיקום, GPS אוטומטי, פרויקט, מין, כמות, תמונות באיכות מקור, הערות.
- **בחירת מין מרשימת מאסטר** (571 מינים) עם חיפוש והשלמה אוטומטית.
- **6 מסכים** — טופס, מפה (Leaflet), רשימה, יומן, מינים, הגדרות.
- **רשימה מתקדמת** — סינון (חיפוש + מין + פרויקט + טווח תאריכים), מיון לפי עמודה, קיבוץ, סימון מרובה, ייצוא Excel/PDF.
- **טאב מינים** — כרטיס לכל מין עם שם עברי/אנגלי/מדעי ומשפחה, וקישור לתצפיות של אותו מין.
- **ייבוא CSV** ו**ייצוא PDF/Excel**.
- **Offline-first** — כל פעולה נשמרת מיידית ב-IndexedDB ועובדת בלי רשת.
- **סנכרון לשרת** — כשמוגדרת כתובת שרת בהגדרות, שינויים נדחפים ונמשכים אוטומטית (online / Background Sync / רקע תקופתי), עם מיזוג last-write-wins ותומכי מחיקה.
- **גיבוי/שחזור** מקומי לקובץ JSON יחיד (כולל תמונות).

## פיתוח

```bash
npm install
npm run dev          # Vite dev server (http://localhost:8787)
npm run server       # שרת הסנכרון לדוגמה (http://localhost:8790)
npm run build        # tsc --noEmit && vite build  → dist/
npm run preview      # תצוגת ה-build
```

בפיתוח, ה-dev server מפנה `/api/*` לשרת הסנכרון (proxy). בפרודקשן מגדירים את
כתובת השרת המלאה במסך **הגדרות ← סנכרון לשרת** (השאירו ריק לעבודה מקומית בלבד).

## סנכרון — חוזה ה-API

השרת (ראו `server/index.mjs` — מימוש התייחסות ללא תלויות) חושף:

```
GET  /api/health → { ok: true }
POST /api/sync   { deviceId, since, ops: [{ entity, op, payload }] }
              →  { cursor, changes: { observations: [], species: [] } }
```

- **push** — הלקוח שולח את תור השינויים המקומי (outbox).
- **pull** — השרת מחזיר כל מה שהשתנה מאז ה-`cursor` של הלקוח.
- **מיזוג** — last-write-wins לפי `updatedAt`; מחיקות מיוצגות כ-tombstone (`deleted:true`).

להחלפת שרת ההתייחסות ב-backend אמיתי — יש לממש את אותם שני endpoints.

## עוזר קולי (Gemini)

כפתור **עוזר קולי** במסך הבית (וגם ביומן, תחת ⋯) פותח חלון שבו מדברים או כותבים:

| משפט | מה קורה |
|---|---|
| "תפתח תצפית בנחל תבור" | נפתחת תצפית מתמשכת: `status: "active"`, `startTime` = עכשיו, נקודת GPS אם יש |
| "תוסיף 2 חיוואים" / "ראיתי עוד כוס חורבות" / "בעצם 5 עגורים" | המינים מתווספים / הכמות מתעדכנת בתצפית הפעילה |
| "סגור תצפית" | `status: "completed"`, `endTime`, `durationMinutes` |
| "מתי ראיתי נשר מקראי בתקופה האחרונה?" / "תן לי את הלוג של נחל תבור" | תשובה מסוכמת מתוך היסטוריית התצפיות |

- **ההבנה** נעשית ב-Gemini API (`src/lib/gemini.ts`) עם תשובת JSON מובנית (`responseSchema`). את השינויים עצמם מחיל הקוד (`src/lib/voice-assistant.ts`), ולכן אפשר לבטל את הפעולה האחרונה.
- **שאלות היסטוריה** עוברות שני שלבים: Gemini מתרגם את השאלה לסינון (מינים, מקומות, טווח תאריכים), האפליקציה מסננת את התצפיות במכשיר, ו-Gemini מנסח תשובה רק מהשורות שנמצאו.
- **המפתח:** מוזן ב**הגדרות ← עוזר קולי**, ונשמר רק ב-localStorage של המכשיר. הוא לא נכנס לקוד, לריפו או ל-Firestore. יש שני סוגים, והאפליקציה מזהה לבד את הסוג:
  - **מפתח AI Studio** (מתחיל ב-`AIza`, מ-[aistudio.google.com/apikey](https://aistudio.google.com/apikey)) נשלח ל-Gemini API, `generativelanguage.googleapis.com`.
  - **מפתח Google Cloud / Vertex AI** (למשל `AQ.…`) נשלח לנקודת הקצה הגלובלית של Vertex AI, `aiplatform.googleapis.com/v1/publishers/google/models/…`. בפרויקט צריך שה-Vertex AI API יהיה מופעל.
- **המודל** נבחר אוטומטית: מודל ה-Flash העדכני ביותר שעובד עם המפתח. אם מודל לא קיים (404) או שאין לו מכסה (429), האפליקציה עוברת לבא בתור. ב-Vertex, שלא מציג למפתח API את רשימת המודלים, נבדקת רשימה קבועה מהחדש לישן. אפשר גם לקבוע מודל ידנית באותו מסך.

### מבנה מסמך תצפית ב-Firestore

`households/{קוד משפחה}/observations/{id}` — אותו אובייקט `Observation` מ-`src/types.ts`:

```jsonc
{
  "id": "uuid",
  "seqNo": 980,
  "dateTime": "2026-10-29T06:30:00.000Z",   // לתצפית מתמשכת = startTime
  "locationName": "נחל תבור",
  "lat": 32.69, "lng": 35.42,                // null אם אין נקודה
  "tags": [], "notes": "", "observers": [],
  "entries": [                               // מין + כמות (+ הערה ותמונות)
    { "species": "חיוויאי הנחשים", "quantity": 2, "note": "", "images": [] }
  ],
  // תצפית מתמשכת (רק כשנפתחה בעוזר הקולי):
  "status": "active",                        // "active" | "completed"
  "startTime": "2026-10-29T06:30:00.000Z",
  "endTime": "2026-10-29T08:05:00.000Z",     // בסגירה
  "durationMinutes": 95,                     // בסגירה
  "deleted": false,
  "updatedAt": "2026-10-29T08:05:00.000Z"    // מיזוג last-write-wins
}
```

## מבנה הקוד

```
index.html              נקודת כניסה (Vite)
vite.config.ts          Vite + vite-plugin-pwa (Workbox injectManifest)
src/
  main.ts               אתחול, ניווט, רישום SW, חיווט סנכרון
  types.ts              מודלים
  db/
    database.ts         סכימת Dexie (observations, species, media, settings, outbox)
    repository.ts       שכבת גישה offline-first + תור סנכרון
  sync/
    sync-engine.ts      דחיפה/משיכה, מיזוג, טריגרים (online / רקע / Background Sync)
    api-client.ts       קליינט REST
  lib/                  ui, csv, markdown, pdf, media, dom
  data/                 species-seed, species-data, demo-data
  views/                form, map, table, cards, species, settings
  sw.ts                 Service Worker (precache + tiles + Background Sync)
  styles/app.css        עיצוב
server/index.mjs        שרת סנכרון לדוגמה (Node, ללא תלויות)
```

## בנייה ופריסה (CI)

כל push מריץ GitHub Action: `npm ci` → type-check → `vite build` → תיוג
`vX.Y.Z`, פרסום Release עם ה-dist, ופריסה אוטומטית ל-**GitHub Pages**
(`https://<user>.github.io/Birds/`).
