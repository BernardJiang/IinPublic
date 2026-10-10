# Test: Stage 0 — Relay-Only Contacts-Only TechSupport, No Browser

covers: docs/TODO.md OPEN-40 TechSupport Contacts-only migration

**File:** 000-relay-only-techsupport-presence.spec.ts
**Features tested:** relay boot/reset publishes the signed TechSupport identity while creating no
room member, headcount, conversation, greeting, or full support-user database.

---

## What this test does (in plain English):

Runs before any browser opens and inspects only the keyless relay's boot/reset output.

1. **Reset:** `resetToStage0Empty()` clears the Gun graph and explicitly opts out of the harness's
   baseline seed.
2. **No browser:** the whole test talks to the server directly over HTTP
   (`GET /api/test/export-snapshot`) — there is no `IinPublicApp`, no login, no page.
3. **Identity check:** `public/techsupport-identity` is present and signed (`pub`, `epub`,
   `signature` all populated).
4. **Absence check:** Global's members API is empty and the graph contains no active TechSupport
   row under any room.
5. **"Bytes, not a database":** there is no `users/<TECHSUPPORT_ROOT_USER_ID>` full user record, no
   `conversations/*` souls, and no `support_welcome_*` greeting — the relay carries only the
   signed identity record, nothing else.

> **Why this matters:** “built-in Contact” must not silently become “permanent room participant.”
> This catches any future relay seed or roster-floor regression before normal users start.

---

**Helpers used:** `isStagePipeline`, `resetToStage0Empty`, `gunBaseURL`, raw `fetch` against
`/api/test/export-snapshot`.
