/* version.ts — a simple release counter shown in the topbar, bumped by one
 * with every shipped fix/feature so it's visible at a glance which build is
 * currently running (and can be quoted back — "גרסה X שוחררה" — whenever a
 * requested fix goes out). Independent of package.json's semver, which
 * isn't bumped per change. */
export const APP_VERSION = 1;
