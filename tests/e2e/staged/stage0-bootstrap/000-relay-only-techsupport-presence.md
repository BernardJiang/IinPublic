# Test: Stage 0 — Relay-Only TechSupport Presence, No Browser

covers: docs/TODO.md K1 item 6

**File:** 000-relay-only-techsupport-presence.spec.ts
**Features tested:** the server's own boot/reset seed (`ChatroomManager.seedTechSupportGlobalMembership`, called from `publishPublicBootstrap`) is sufficient, on its own, to produce a valid built-in TechSupport presence — with no browser ever created and no test-harness baseline seed involved.

---

## What this test does (in plain English):

Runs first in the stage0-bootstrap pipeline (filename sorts before `aaa-...`), before any browser
mints a TechSupport user. It resets the Gun database with `seedTechSupportRoot: false`, which
skips the test harness's own full-profile seed (`seedTechSupportRootBaseline`) — so anything found
afterward can only have come from the relay's own boot/reset code path.

1. **Reset:** `resetToStage0Empty()` clears the Gun graph and explicitly opts out of the harness's
   baseline seed.
2. **No browser:** the whole test talks to the server directly over HTTP
   (`GET /api/test/export-snapshot`) — there is no `IinPublicApp`, no login, no page.
3. **Identity check:** `public/techsupport-identity` is present and signed (`pub`, `epub`,
   `signature` all populated).
4. **Presence check:** exactly one `chatrooms/global/users/<TECHSUPPORT_ROOT_USER_ID>` row exists,
   active and stamped with the canonical stage name.
5. **"Bytes, not a database":** there is no `users/<TECHSUPPORT_ROOT_USER_ID>` full user record, no
   `conversations/*` souls, and no `support_welcome_*` greeting — the relay carries only the
   identity record and one member row, nothing else.
6. **Aggregate check:** `public/room-member-counts/global` eventually reads `{ count: 1 }` (polled,
   since the publish is a fire-and-forget best-effort write on the server).

> **Why this matters:** this is the test that actually exercises K1's central claim — "built-in"
> means built into the client and the relay's own boot sequence, not something a browser has to
> create. If a future change reintroduces a dependency on a browser bootstrap, this test fails
> before any stage1+ spec would even notice (they all load a baseline that already contains
> TechSupport, which would mask the regression).

---

**Helpers used:** `isStagePipeline`, `resetToStage0Empty`, `gunBaseURL`, raw `fetch` against
`/api/test/export-snapshot`.
