# Test: TechSupport — Tampered Greeting Suppressed, Never Rendered

covers: docs/TODO.md K2 item 6 (decision K2-3)

**File:** 04-support-greeting-tamper-suppressed.spec.ts
**Features tested:** a stored greeting record whose text was altered after signing (signature
metadata left untouched) is silently dropped at render time — never shown, never partially shown,
and never surfaced as an error/warning toast.

---

## What this test does (in plain English):

1. **Login:** one ordinary user logs in and receives the real, genuinely-signed greeting (K2's
   normal path) — this establishes a known-good baseline record to tamper with.
2. **Open the conversation:** confirms the real greeting is visible in the thread first.
3. **Tamper:** overwrites the same deterministic Gun soul (`support_welcome_<userId>`) with
   altered `text` (an appended "click here" phishing-style snippet) while leaving
   `greetingSignature`/`greetingLocale`/`greetingAuthorPub` exactly as they were on the genuine
   record. This is the attack vector that a naive "just check the signature" implementation
   would miss — the signature still cryptographically matches the *original* template, but the
   *stored displayed text* no longer matches what that verified template renders to.
4. **Re-render:** reopens the conversation (the same action a real re-click or fresh load would
   trigger), forcing a fresh pass through the render-time verification.
5. **Assert suppression:** the tampered snippet never appears anywhere in the thread — and
   neither does the original valid text, because the same soul was overwritten and the whole
   record now fails the render-time check.
6. **Assert silence:** no new `.notification` toast appears because of the failed verification
   (K2-3 is silent suppression, not an error surface).

> **Why this matters:** this is the negative-path proof that closes the gap a signature-only
> check would leave open. `03-support-greeting-signed.spec.ts` proves the positive path.

---

**Helpers used:** `clearGunForStage1Spec`, `gotoWebApp`, `waitForTabActive`,
`app.conversationService.upsertMessageRecord` (called via `page.evaluate`, the same
local-only-write primitive `ensureSupportBootstrapForCurrentUser` uses).
