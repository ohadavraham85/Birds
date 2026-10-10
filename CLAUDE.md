# Birds — notes for Claude

- **Every user-visible change adds a "מה חדש" entry** at the top of
  `src/data/changelog.ts` (next `id`, today's date, a short Hebrew title and
  1–3 Hebrew bullet points written for the user, not for developers). Leave
  `version` out — CI assigns the release number at merge time.
- Run `npm run build` (includes `tsc`) before pushing.
- Releases deploy automatically from the default branch
  (`claude/bird-observation-pwa-kqedtw`); the user wants changes merged
  there without asking.
