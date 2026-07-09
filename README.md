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
