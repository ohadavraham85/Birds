# Cloud Function: parseVoiceObservation

Turns one dictated Hebrew field note into a structured observation (species +
quantity + note entries, location, tags, smart notes) using Claude. This has
to live server-side — an Anthropic API key can never be embedded in the PWA's
client code, since anyone can read it straight out of the shipped JavaScript.

## One-time setup (you only do this once)

1. **Install the Firebase CLI** (if you don't have it):
   ```
   npm install -g firebase-tools
   ```

2. **Log in** with the Google account that owns the `ohad-avraham-birding-log`
   Firebase project:
   ```
   firebase login
   ```

3. **Enable the Blaze (pay-as-you-go) plan** for the project — Cloud
   Functions cannot call external services (like the Anthropic API) on the
   free Spark plan. Open:
   https://console.firebase.google.com/project/ohad-avraham-birding-log/usage/details
   and follow the upgrade prompt. There's a generous free tier included even
   on Blaze; you only pay for usage beyond it, and this function's own usage
   here is tiny.

4. **Get an Anthropic API key** from https://console.anthropic.com (API
   access is separate from a claude.ai chat subscription — it has its own
   billing). Copy the key.

5. **Store the key as a Firebase secret** (from the repo root):
   ```
   firebase functions:secrets:set ANTHROPIC_API_KEY
   ```
   Paste the key when prompted. It's stored in Google Secret Manager, never
   in the repo or the client bundle.

## Deploying (every time you change functions/src/index.ts)

```
cd functions
npm install
npm run build
firebase deploy --only functions
```

(`npm run deploy` inside `functions/` does the build + deploy in one step.)

## Cost

Model used: `claude-haiku-4-5-20251001` — Anthropic's fast/cheap tier.
For personal-scale usage (a handful of dictated observations per outing),
expect the cost to be a small fraction of a cent per call.
