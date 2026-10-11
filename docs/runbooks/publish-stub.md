# Publish the storefront stub to the Salla Partners Portal

The App Snippet stub (`packages/player/stub/stub.js`) is static and identical for every store. It is published once to the Salla Partners Portal as the app's Snippet; day-to-day player releases ship through the CDN loader, not through this runbook. Re-publish only when `stub/stub.js` changes.

## Before you publish

1. CI is green on the commit: lint, `packages/player` unit tests (guard, allowed origins, silent failure) and the CLS suite.
2. Check `CDN` and `API` at the top of `stub.js` are the production Slips origins. The stub test fails if any other absolute URL is present.
3. `pnpm --filter @slips/player build` prints the initial payload size: it must stay under 50 KB gzip.

## Publish

1. Sign in to the Salla Partners Portal and open the Slips app.
2. Go to the app's Snippet (storefront script) settings.
3. Paste the contents of `packages/player/stub/stub.js` as the snippet. Do not edit it in the portal.
4. Save, then submit the new version for review if the portal asks.
5. Record the commit hash and date in the release notes.

## After publishing

1. Open a home, category and product page on the demo store (3 or more themes). The `window.__slips` guard must exist and the loader must load once.
2. Block the CDN origin (for example with a request blocker). The page must look and behave as if Slips were not installed.
3. If anything is wrong, restore the previous snippet text from the last release commit.
