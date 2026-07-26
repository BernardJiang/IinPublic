# Test: TechSupport-Mode Boot Authenticates With the Canonical DM Key

covers: docs/TODO.md K3 item 5

**File:** 05-techsupport-mode-signed-dm.spec.ts
**Features tested:** booting the normal web client in TechSupport mode (K3) authenticates with the
canonical DM keypair — not a freshly generated device pair — and a message it sends is visible to
the receiver together with a published identity key that is a trusted DM anchor.

---

## What this test does (in plain English):

1. **Ordinary user boots first** (stage1 convention: one ordinary user, plus the TechSupport
   device as infrastructure under test — TechSupport is the built-in bootstrap presence, not a
   graded "second user"). Its support conversation with TechSupport already exists from the K2
   greeting bootstrap.
2. **A second browser boots in TechSupport mode**, mirroring exactly what
   `scripts/dev-techsupport-login.js` does for a real operator: inject the root id and the
   canonical DM pair into `localStorage` before navigation.
3. **Core assertion:** the app's `gunService.getStoredPair().pub` is the canonical
   `TECHSUPPORT_PUB` — proving `ensureKeypairAndAuth()`'s K3 branch loaded the real key rather
   than generating a random one (the pre-K3 behavior).
4. **Identity publish:** the TechSupport user record's `pub` becomes `TECHSUPPORT_PUB` (published
   by the normal `initializeUser()` flow, since the E2E baseline seed leaves it unset) — this is
   the receiver-visible proof that the operating identity really is the canonical one.
5. **TechSupport sends a DM** to the user's support conversation via the real
   `conversationService.sendMessage()` path (never a client-fabricated record).
6. **Receiver sees it:** the message renders in the support thread, and the claimed author's
   published key (`isTrustedTechSupportDmPub`) is a trusted DM anchor.

> **Honest scope note:** per-message cryptographic signing for ad hoc operator DMs (beyond the K2
> greeting template) is not built yet — that would be a K5/future concern. What this test proves
> is the concrete, already-built guarantee: the *operator's authenticated identity* is the
> canonical key, not a random device pair, which is exactly what K3's checklist item asks for.

---

**Helpers used:** `clearGunForStage1Spec`, `gotoWebApp`, `expectCurrentUserIsTechSupportRoot`,
`isTrustedTechSupportDmPub` (imported directly from `src/shared/techsupport`), `waitForTabActive`.
