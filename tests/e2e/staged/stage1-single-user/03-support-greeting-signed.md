# Test: TechSupport — Signed Greeting Renders Once and Verifies

covers: docs/TODO.md K2 items 1, 4, 5

**File:** 03-support-greeting-signed.spec.ts
**Features tested:** the pre-signed, per-locale welcome template renders and persists correctly
for a single ordinary user, the stored record's signature independently verifies against the
compiled DM trust anchors, and the greeting survives a clear-storage + re-open with no
duplication (deterministic message id).

---

## What this test does (in plain English):

1. **Login:** one ordinary browser user logs in via the normal stage1 flow.
2. **Rendered check:** opens the support conversation (Me tab → the TechSupport conversation
   list item) and asserts the thread shows the greeting text containing both "Welcome to
   IinPublic" and the user's own stage name — proving the `{name}` placeholder was substituted
   correctly after verification.
3. **Stored-record check:** reads the greeting record back (via the server export-snapshot,
   which reliably mirrors browser-authored writes in this single-relay E2E environment) and
   independently re-verifies its `greetingSignature`/`greetingLocale`/`greetingAuthorPub`
   against the compiled `TECHSUPPORT_DM_TRUST_ANCHORS` — proving the stored record, not just the
   rendered DOM, is authentic.
4. **Idempotency:** clears storage and re-opens the app as the same user. Exactly one greeting
   record still exists, with the same text and signature, and it still verifies — the
   deterministic `support_welcome_<userId>` message id makes a repeat write a no-op overwrite of
   the same soul rather than a duplicate.

> **Why this matters:** this is the positive-path proof for K2's central claim — a signed
> template can render a genuinely personalized, authentic greeting with zero server storage and
> zero network transmission of per-user data. `04-support-greeting-tamper-suppressed.spec.ts` is
> the matching negative-path proof (a bad signature must suppress silently, never render).

---

**Helpers used:** `clearGunForStage1Spec`, `gotoWebApp`, `waitForTabActive`,
`verifyTechSupportGreeting` (imported directly from `src/shared/techsupport-greeting`, not through
the browser bundle), `ensureWindowFitsViewport`, `attachE2eBrowserTabLabel`.
