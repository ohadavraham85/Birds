# ניהול נכסי חשמל ⚡ — PWA לניהול מפת נכסים ותחזוקה

אפליקציית **PWA offline-first** למיפוי וניהול נכסי חשמל (עמודים, שנאים, לוחות
חשמל, מוני חשמל, קווים/כבלים, מפסקים וגנרטורים), עם יומן תחזוקה לכל נכס.
עובדת באופן מלא **ללא רשת**.

בנויה ב-**TypeScript + Vite**, עם **Dexie** (IndexedDB מוטיפס), **Workbox**
(Service Worker, מטמון shell), ו-**Leaflet** למפה.

## פלטפורמה אחת — שלוש תצורות

| תצורה | התקנה |
|---|---|
| 📱 **Android (Chrome)** | תפריט ⋮ → "התקנת אפליקציה" / "הוספה למסך הבית" |
| 📱 **iPhone (Safari)** | שיתוף → "הוסף למסך הבית" |
| 💻 **דסקטופ (Chrome/Edge)** | סמל ההתקנה ⊕ בשורת הכתובת |
| 🌐 **דפדפן** | גלישה רגילה לכתובת |

## תכונות

- **מפת נכסים** (Leaflet, שכבת לוויין/כבישים/תוויות) — כל נכס מוצג כסמן צבוע
  לפי סטטוס (פעיל/בתחזוקה/תקול/מושבת) עם אייקון סוג הנכס. לחיצה ארוכה על
  המפה מוסיפה נכס חדש במיקום שנבחר; לחיצה על סמן קיים פותחת את פרטיו.
  סינון לפי סוג נכס וסטטוס ישירות על המפה.
- **טופס נכס** — מספר/תג נכס, שם/תיאור, סוג (עמוד/שנאי/לוח/מונה/קו/מפסק/
  גנרטור), סטטוס, רמת מתח (נמוך/בינוני/גבוה), מיקום (ידני / בחירה על המפה /
  GPS נוכחי), כתובת, תאריך התקנה, הערות ותמונות.
- **רשימת נכסים** — חיפוש, סינון לפי סוג/סטטוס, מיון לפי עמודה, סימון מרובה
  למחיקה, וייצוא ל-Excel/CSV.
- **פרטי נכס ויומן תחזוקה** — היסטוריית טיפולים לכל נכס (תאריך, תיאור, איש
  תחזוקה), עם אפשרות הוספת רשומה חדשה וסנכרון אוטומטי של "תחזוקה אחרונה".
- **לוח בית** — ספירת נכסים לפי סטטוס וסוג (לחיצה מסננת את הרשימה), ופעילות
  תחזוקה אחרונה.
- **Offline-first** — כל פעולה נשמרת מיידית ב-IndexedDB ועובדת בלי רשת.
- **גיבוי/שחזור** מקומי לקובץ JSON יחיד (כולל תמונות).

## פיתוח

```bash
npm install
npm run dev          # Vite dev server (http://localhost:8787)
npm run build        # tsc --noEmit && vite build  → dist/
npm run preview      # תצוגת ה-build
```

## מבנה הקוד

```
index.html              נקודת כניסה (Vite)
vite.config.ts          Vite + vite-plugin-pwa (Workbox injectManifest)
src/
  main.ts               אתחול, ניווט, רישום SW
  types.ts               מודלים (Asset, MaintenanceLog...)
  db/
    database.ts         סכימת Dexie (assets, maintenance, media, settings)
    repository.ts        שכבת גישה offline-first
  lib/                  ui, csv, media, מפה (leaflet-setup/map-layers/location-picker), אייקונים, עיצוב
  views/                home, map, form, table (רשימה), detail, settings
  sw.ts                 Service Worker (precache + tiles)
  styles/app.css        עיצוב
```

## בנייה ופריסה (CI)

כל push מריץ GitHub Action: `npm ci` → type-check → `vite build` → תיוג
`vX.Y.Z`, פרסום Release עם ה-dist, ופריסה אוטומטית ל-**GitHub Pages**.
