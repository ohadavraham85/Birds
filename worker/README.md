# שרת הסנכרון — Cloudflare (Worker + D1 + R2)

Backend חינמי לאפליקציית יומן צפרות: Worker ל-API, **D1** (SQLite) לנתונים
המובנים, ו-**R2** (אחסון אובייקטים, ללא דמי egress) לתמונות. מיישם בדיוק את
חוזה ה-`/api/sync` שהאפליקציה כבר מדברת, בתוספת העלאת/הורדת תמונות.

```
GET  /api/health          → { ok: true }
POST /api/sync            → סנכרון דו-כיווני (last-write-wins + tombstones)
PUT  /api/media/:id       → העלאת תמונה ל-R2
GET  /api/media/:id       → הורדת תמונה מ-R2
```

אימות: כל בקשה (חוץ מ-`/api/health`) חייבת `Authorization: Bearer <SYNC_TOKEN>`.

## התקנה חד-פעמית (הכול בדפדפן, בלי טרמינל)

1. **חשבון Cloudflare** — נרשמים חינם ב-dash.cloudflare.com.
2. **D1** — Storage & Databases → D1 → **Create** → שם `birds`. מעתיקים את
   **Database ID** ומדביקים ב-`wrangler.toml` (שדה `database_id`).
3. **R2** — R2 → **Create bucket** → שם `birds-photos` (יבקש להוסיף אמצעי
   תשלום כדי להפעיל R2, אך לא מחייב בתוך 10GB/הורדות חינם).
4. **API Token** — My Profile → API Tokens → **Create Token** → תבנית
   "Edit Cloudflare Workers", ולוודא הרשאות: Workers Scripts (Edit),
   D1 (Edit), Workers R2 Storage (Edit). מעתיקים את הטוקן.
5. **Account ID** — מופיע בעמוד הראשי של הדשבורד (בצד).
6. **GitHub Secrets** — בריפו: Settings → Secrets and variables → Actions →
   New secret, ומוסיפים שלושה:
   - `CLOUDFLARE_API_TOKEN` = הטוקן מסעיף 4
   - `CLOUDFLARE_ACCOUNT_ID` = ה-Account ID מסעיף 5
   - `SYNC_TOKEN` = סיסמה אקראית ארוכה שתבחרו (הסוד המשותף לכם ולחברים)
7. כל push (או הרצה ידנית של ה-Action **Deploy Sync Worker**) יריץ מיגרציית
   D1, יפרוס את ה-Worker, ויגדיר את `SYNC_TOKEN`.
8. הכתובת של ה-Worker תהיה `https://birds-sync.<subdomain>.workers.dev`.
   מזינים אותה + את `SYNC_TOKEN` באפליקציה: **הגדרות ← סנכרון לשרת**.

## פיתוח מקומי
שרת ההתייחסות ב-`server/index.mjs` (Node, ללא תלויות) מיישם את אותו חוזה
כולל תמונות ואימות — נוח לבדיקות מקומיות:
```bash
SYNC_TOKEN=my-secret npm run server   # http://localhost:8790
```
