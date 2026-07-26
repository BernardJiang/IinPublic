# K2 Design Note — Signed greeting without server storage

Implementation guide for TODO.md **K2** (decisions K2-1, K2-2, K2-3 are locked; this note turns
them into concrete edits). Companion to `docs/design/techsupport-k1-design-note.md` and
`docs/design/techsupport-bootstrap-contract.md`, which must be amended as part of this work (see
§Contract amendments at the end).

Audience: the implementing (Sonnet-tier) engineer. Every item below gives **Where** (file +
function/line), **What changes**, and **Risks/gotchas**. Landing order is first because several
items are only safe in sequence.

The locked decisions this note builds on (do not re-litigate):
- **K2-1** greeting artifact is **hybrid** — a compiled signed template renders immediately
  (offline, zero server storage); a real DM follows later when the TechSupport *device* is online.
  The follow-up half is a K3 concern and needs **no new K2 code** — see §"The K2-1 follow-up half".
- **K2-2** the rendered greeting is a **real message, persisted in the receiver's own local Gun**
  (not a UI header).
- **K2-3** signature-verification failure ⇒ **suppress silently** — render no greeting, no error
  toast, and never a fabricated/impersonated message.

---

## Recommended implementation order

The governing constraint: item 2 deletes the browser compose path that currently produces the only
greeting, and item 1 is what replaces it. Land the plumbing before the deletion, and land the tests
last so they aren't re-edited as behaviour settles.

1. **Shared module + signed artifact + signing script first** (foundation for item 1). Add
   `src/shared/techsupport-greeting.ts` (sign/verify/render, mirroring `system-announcements.ts`),
   `scripts/sign-techsupport-greeting.js`, and the committed
   `src/shared/techsupport-greeting.signed.json`. Pure additions, no behaviour change, `tsc`/unit
   verifiable in isolation (add a unit test that the committed blob verifies against
   `TECHSUPPORT_DM_TRUST_ANCHORS`). This is the **verify-round-trip gate** that de-risks item 1.
2. **Item 1 — client renders the signed greeting** (`ensureSupportBootstrapForCurrentUser`
   rewrite + verify-on-render in `formatConversationMessage`). Additive alongside the still-present
   old string until item 2 removes it, but land them together in one commit since item 1 changes the
   stored `text` shape the old regex in `formatConversationMessage` keys on.
3. **Item 2 — delete the compose path + `supportState` gate.** Only after item 1 renders/persists a
   verified greeting. A client that can't verify now shows nothing (K2-3), which is correct.
4. **Item 3 — rework the E2E integrity guard** (`duplicateSupportGreeting` +
   `assertStageSnapshotIntegrity`). Do this alongside item 2 so a staged run stays green.
5. **Items 5 + 6 (tests) + `01-login` rework last.** The `01-login` spec (checklist §"test rework")
   currently red-greens on the *server* snapshot count; it must move to a browser-local + signature
   assertion, and only makes sense once items 1–3 are in.

**Single biggest risk (read first):** because **K2-3 makes every verification failure silent**, any
mismatch between the *build-time signed payload* and the *run-time verify payload* — a stray
whitespace, a differently-normalized Chinese template (full-width vs half-width punctuation in the
中文 string), a canonical-serialization key-order or `undefined`-stripping difference, or a locale
key mismatch — ships as **"no greeting ever renders, for everyone, with no error anywhere."** The
old path was loud (it wrote a message unconditionally); the new one fails closed and quiet. Mitigate
by (a) making the signing script and the client verify import the **exact same** template constant
and the **exact same** `greetingSigningPayload()` from `src/shared/techsupport-greeting.ts` (never a
re-typed copy), and (b) landing item 1's unit test **first** — a test that the committed
`.signed.json` verifies and a test that a rendered greeting is non-empty for both `en` and `zh` — so
the silent-suppression bug cannot merge undetected.

---

## Item 1 — Client renders & persists the pre-signed, per-locale greeting

**Where**
- `src/web/app/app.ts` — `ensureSupportBootstrapForCurrentUser()` (line 2367). The hardcoded
  English greeting string is built at **2390–2391**; the local conversation record is written raw to
  Gun at **2399–2415**; `addNewConversation` at **2416**; the notification toast at **2430–2432**;
  the network `sendMessage(convId, TECHSUPPORT_ROOT_USER_ID, welcome, { messageId:
  support_welcome_<userId>, isFromChatbot: true })` at **2437–2446**.
- `src/web/ui/ui-manager.ts` — `formatConversationMessage()` (line **4812–4816**) currently
  re-localizes by regex-matching the literal English welcome; `formatSupportWelcome()` (**4639**).
- `src/web/services/gun-message-store.ts` — `putMessageRecord()` (**237–267**) is the low-level
  **local-only** message-persistence primitive (raw Gun put, arbitrary `senderId`, no transport
  send). Record shape at **239–250**. This is the primitive to reuse — see below.
- `src/shared/techsupport-greeting.ts` — **new** (see §Signed-greeting module).
- `src/shared/techsupport.ts` — reuse `TECHSUPPORT_DM_TRUST_ANCHORS` (line 35),
  `isTrustedTechSupportDmPub()` (49), `currentTechSupportDmPub()` (54). The greeting is signed with
  the **DM key**, not the announcement key — the split already exists in the current code, verified.

**What changes**

Rewrite the body of `ensureSupportBootstrapForCurrentUser()` so the greeting is produced from the
compiled signed template instead of a fabricated string:

1. Keep the local **conversation-record** writes (2399–2415) and `addNewConversation` (2416) — the
   support *contact* must still appear regardless of greeting outcome (same reasoning as the current
   comment at 2395–2398). Contact creation is orthogonal to the greeting and is not gated on
   verification.
2. Select the locale entry from the committed bundle matching the active UI language (the app
   already distinguishes `en` / `zh`; fall back to `en`). Call
   `verifyTechSupportGreeting(entry, TECHSUPPORT_DM_TRUST_ANCHORS)` from the new shared module.
   - **On failure → return without writing any greeting message** (K2-3: silent suppress). The
     contact row from step 1 still stands; only the greeting message is withheld.
3. On success, render: `const rendered = renderGreeting(entry.template, currentUser.stageName)` —
   `entry.template` is the literal signed text containing the `{name}` placeholder; substitution
   happens **only after** verification.
4. Persist `rendered` as a **real message on the receiver's local Gun** (K2-2) at the existing soul
   `conversations/${conversationId}/messages/support_welcome_${userId}` with a record shaped like
   `putMessageRecord`'s (239–250) plus two new fields so it is re-verifiable at render time:
   ```
   { id: `support_welcome_${userId}`, senderId: TECHSUPPORT_ROOT_USER_ID,
     text: rendered, timestamp: now, channel: 'public', transport,
     greetingLocale: entry.locale, greetingSignature: entry.signature }
   ```
   Do **not** call `conversationService.sendMessage(...)` — that path attempts a WebRTC/transport
   *notify to a peer* and re-derives authorship from the sending device. The greeting is authored by
   TechSupport, generated locally, and **not transmitted** (checklist item 1). Write it locally via
   the message store's `putMessageRecord` (expose a thin `WebConversationService.persistLocalMessage
   (conversationId, record)` delegating to the store, rather than duplicating the record shape in
   `app.ts`). The deterministic id keeps the write idempotent — re-open ⇒ exactly one soul.
5. Keep the notification toast (2430–2432) but source its text from the same rendered/verified
   greeting (or skip it on verification failure so a suppressed greeting produces no toast either).
6. **Verify-on-render** (defends a *stored* tampered record — the item-6 test): in
   `formatConversationMessage()` (ui-manager 4812), when the message is the support greeting
   (support channel + id `support_welcome_*`, carrying `greetingSignature`/`greetingLocale`),
   re-verify it against the compiled template for that locale + `TECHSUPPORT_DM_TRUST_ANCHORS`
   before returning display text; on failure, **drop the message from the rendered list** (return a
   sentinel the caller filters, or filter upstream where the message list is assembled). This
   replaces the current brittle regex re-localization (4814) with an authenticity check.

**Risks / gotchas**
- **`isFromChatbot` semantics.** The old greeting set `isFromChatbot: true` (2444). The signed
  greeting is a genuine TechSupport-authored message, not an automated FAQ answer — drop the chatbot
  marker for the greeting (the chatbot icon belongs to K5 auto-answers). Flag: confirm the
  conversation renderer doesn't rely on `isFromChatbot` to route support messages; grep shows the
  marker is optional throughout the record shape, so this is safe.
- **Verify-on-render performance.** Only the single greeting soul needs the check, gated on the id
  prefix — do not verify every message. Keep it a one-message special case.
- **Locale drift.** The UI language can change after the greeting is written. Verify-on-render must
  key off the stored `greetingLocale`, not the *current* UI language, or a language switch would
  make a valid greeting fail verification and vanish.
- The `formatConversationMessage` regex at 4814 (`/^Welcome to IinPublic, (.+)\. TechSupport.../`)
  must be **removed**, not left as a fallback — it would re-localize (and thus alter) the verified
  text, breaking the render-time signature check.

## The K2-1 follow-up half (confirmed: no new K2 code)

K2-1 is hybrid: signed template now, real DM later "when the device is online." Confirmed against
the transport code that the follow-up half needs **no K2 work**:
- Ordinary post-match DMs flow through `DirectP2PConversationTransport.sendMessage`
  (`src/web/services/direct-p2p-conversation-transport.ts:286`): write to local Gun via
  `gunStore.buildAndPersistMessage` (authoritative), then WebRTC notify/sync to the peer
  (CLAUDE.md §"Direct P2P conversation transport"). The support channel rides
  `TechSupportConversationTransport` (`techsupport-conversation-transport.ts:80`), same
  `buildAndPersistMessage` primitive.
- Once **K3** lands and the TechSupport *device* runs as a real client authenticated with the DM
  keypair (`gun.user().auth(pair)`), TechSupport authoring a support DM is simply that client
  calling the same `sendMessage` machinery — the message is signed by being written under
  TechSupport's authenticated Gun user and delivered over the existing transport (offline mailbox on
  reconnect if away). No new code in K2. This note only implements the compiled-template half; the
  live-DM half is a K3/K5 capability that reuses machinery that already exists today.

---

## Signed-greeting module, artifact, and signing script (new — no analog exists)

### `src/shared/techsupport-greeting.ts` (new)

Mirror `src/shared/system-announcements.ts` exactly (that file is the established sign/verify
convention — `createSystemAnnouncement` at 80–92 signs, `isRenderableSystemAnnouncement` at 94–114
verifies, both via `SEA.sign`/`SEA.verify` over `canonicalSerialize(...)`).

- Canonical templates as the **single source of truth** (retire the `ui-translations.ts`
  duplication for the greeting; see risk below):
  ```
  export const TECHSUPPORT_GREETING_TEMPLATES = {
    en: 'Welcome to IinPublic, {name}. TechSupport is here if you need help.',
    zh: '欢迎来到 IinPublic，{name}。如需帮助，TechSupport 随时为你服务。',
  } as const;
  export type GreetingLocale = keyof typeof TECHSUPPORT_GREETING_TEMPLATES;
  ```
  These are byte-identical to `ui-translations.ts:422` (`supportWelcome`, EN) and `:1311` (ZH).
- Payload + sign + verify (import `canonicalSerialize` from `./cid`, `SEA` from `gun/sea`,
  `isTrustedTechSupportDmPub` from `./techsupport`):
  ```
  export interface SignedGreeting { locale: GreetingLocale; template: string; authorPub: string; signature: string; }
  export function greetingSigningPayload(g: Omit<SignedGreeting,'signature'>): string {
    return canonicalSerialize({ kind: 'techsupport-greeting', locale: g.locale, template: g.template, authorPub: g.authorPub });
  }
  export async function signGreeting(locale, pair): Promise<SignedGreeting>   // build-time (script)
  export async function verifyTechSupportGreeting(g: unknown, anchors: readonly string[]): Promise<SignedGreeting | null>
  export function renderGreeting(template: string, name: string): string      // template.replace('{name}', name)
  ```
  `verifyTechSupportGreeting` must: check `authorPub` ∈ `anchors` (compiled trust root, **not**
  relay-served — TODO.md tension #1); check `template === TECHSUPPORT_GREETING_TEMPLATES[locale]`
  (the client trusts its **own** compiled template, so a swapped template in the blob is rejected);
  then `SEA.verify(signature, authorPub)` and compare the recovered payload to
  `greetingSigningPayload(...)` exactly as `isRenderableSystemAnnouncement` does at 112–113.

### `src/shared/techsupport-greeting.signed.json` (new, committed)

`resolveJsonModule` is enabled (`tsconfig.json:27`), so the web bundle imports this directly. Shape:
```
{ "version": 1,
  "greetings": [
    { "locale": "en", "template": "Welcome to IinPublic, {name}. TechSupport is here if you need help.",
      "authorPub": "<DM pub>", "signature": "<SEA sig>" },
    { "locale": "zh", "template": "欢迎来到 IinPublic，{name}。如需帮助，TechSupport 随时为你服务。",
      "authorPub": "<DM pub>", "signature": "<SEA sig>" } ] }
```
`authorPub` must equal `currentTechSupportDmPub()` (today = `TECHSUPPORT_PUB`). Commit the file; the
client imports it, never fetches it from the relay.

### `scripts/sign-techsupport-greeting.js` (new, one-off build/dev step)

Model on `scripts/dev-techsupport-bootstrap.js` (plain Node, `require('gun/sea')`, requires the
compiled `dist/.../techsupport-greeting.js` for the exact templates + payload builder — same
`DIST_GRAPH_MODULE` auto-`build:server` pattern at dev-bootstrap.js:17–35, so the script and the
client can never sign/verify divergent payloads).

- **Reads:** `TECHSUPPORT_SEA_PAIR_JSON` from env (present in `.env.local`; confirmed — the script
  does `JSON.parse(process.env.TECHSUPPORT_SEA_PAIR_JSON)` to get the DM signing pair, exactly like
  `configuredPair()` in `techsupport-announcement-service.ts:13–22`). It must assert
  `pair.pub === currentTechSupportDmPub()` before signing and refuse otherwise (no silent
  wrong-key signing).
- **Does:** for each locale, `signGreeting(locale, pair)` → collect into the bundle object.
- **Outputs / commits:** writes `src/shared/techsupport-greeting.signed.json` (pretty-printed). The
  file is committed to the repo; re-run only when the greeting copy or the DM key changes (this is
  the "must re-sign to change the greeting copy" cost recorded honestly in TODO.md:191). Add an
  `npm run sign:techsupport-greeting` script entry and document it in `.env.local` notes.

**Risk:** `ui-translations.ts:422/1311` (`supportWelcome`) is now a **second copy** of the template.
Either (a) have `formatSupportWelcome()` (ui-manager 4639) render from
`TECHSUPPORT_GREETING_TEMPLATES` and delete the two `supportWelcome` translation entries, or (b)
keep them but add a unit test asserting `ui-translations.supportWelcome === TECHSUPPORT_GREETING_
TEMPLATES.en` (and `.zh`) so they cannot drift and silently break verification. Prefer (a).

---

## Item 2 — Delete the browser compose path + the `supportState` localStorage gate

**Where**
- `src/web/app/app.ts` — `ensureSupportBootstrapForCurrentUser()` (2367): the `supportState`
  read/gate at **2371–2386** (localStorage key `'iinpublic_support_channels'`), the fabricated
  string at **2390–2391**, the `supportState[userId] = {...}` write-back at **2425–2426**, and the
  network `sendMessage` at **2437–2446**.
- `src/web/ui/ui-manager.ts` — the `formatConversationMessage` regex re-localization (4814).

**What changes**
- Remove the `supportState` localStorage read, the `greetedAt/conversationId` gate (2383–2386), and
  the write-back (2425–2426). Idempotency is now guaranteed structurally by the **deterministic
  message id** `support_welcome_<userId>` (a repeat put overwrites the same soul), so the
  localStorage gate is redundant — a client that cannot verify shows **no** greeting rather than a
  cached fabricated one (checklist item 2). Keep the in-memory `this.supportBootstrapChecked`
  guard (2368/2428) as a per-session no-op optimization; it is not persistence and does not
  fabricate.
- Remove the network `sendMessage(...)` greeting send (2437–2446) — replaced by the local
  `putMessageRecord` write in item 1. (Note: `sendTechSupportAutoReply` at 2452 also uses
  `sendMessage` as TechSupport; that is a **K5** concern — leave it alone in K2.)
- Delete the regex re-localization at 4814 (replaced by verify-on-render in item 1).

**Risks / gotchas**
- **Do not remove the contact-record writes** (2399–2416). Only the greeting *message* path is being
  deleted; the support contact must survive (a stuck user's only recourse — K6).
- Other readers of `'iinpublic_support_channels'`: grep before deleting the key. The gate is local to
  this method today, but confirm no other module reads `supportState` for e.g. "has been greeted"
  logic. If none, the key is fully retired.

---

## Item 3 — Rework the "one stored greeting" integrity assumption

**Where**
- `tests/e2e/helpers/techsupport-baseline.ts` — `duplicateSupportGreeting()` (**57–67**), regex
  `^conversations\/conv_support_[^/]+\/messages\/support_welcome_(.+)$`.
- `tests/e2e/helpers/e2e-stage-pipeline.ts` — `assertStageSnapshotIntegrity()` calls it at **70–73**
  (the TODO's "e2e-stage-pipeline.ts:95–103" reference has shifted here after K4's refactor).
- `src/test/unit/techsupport-baseline.test.ts` — `duplicateSupportGreeting` tests (**85–108**).

**What changes**

The old model asserted a **stored** greeting message existed and was unique per user in the *server*
snapshot. Under K2 the greeting is authored **client-side, into the receiver's local Gun, and not
transmitted** — so a stage snapshot (a *server* export) may legitimately contain **zero** greeting
souls, and its presence/absence is no longer an integrity signal.

- Keep `duplicateSupportGreeting` as-is in shape (the deterministic id still means a duplicate soul
  is a real bug) — the regex is still valid because item 1 writes to the same soul path. It already
  returns `null` when none exist, which is now the *expected* case for a fresh server snapshot, so
  `assertStageSnapshotIntegrity` (70–73) needs **no relaxation** to pass — it only fires on genuine
  duplicates.
- **Add** an authenticity assertion to satisfy "at most one rendered greeting per user, verified":
  a new `signedGreetingProblem(graph)` in `techsupport-baseline.ts` that, for any
  `support_welcome_*` soul present, asserts the record carries a `greetingSignature` +
  `greetingLocale` and that `verifyTechSupportGreeting({ locale, template:
  TEMPLATES[locale], authorPub: record.authorPub ?? currentTechSupportDmPub(), signature })`
  succeeds. Wire it into `assertStageSnapshotIntegrity` next to the duplicate check. This converts
  the guard from "count stored messages" to "any greeting that *is* present is unique and
  signature-valid" — exactly the new-model invariant.
- Update `src/test/unit/techsupport-baseline.test.ts`: the existing duplicate cases (85–104) stay;
  add a case that a stored greeting with a bad/missing signature is flagged by
  `signedGreetingProblem`, and that a graph with **no** greeting soul is *not* an error.

**Risks / gotchas**
- If Gun happens to replicate the receiver's local greeting write to the relay (ordinary P2P
  propagation), the soul *may* appear in a later server snapshot. That is acceptable — the
  authenticity check passes because it is a genuine signed greeting — but it means the guard must
  treat "greeting present in a snapshot" as *allowed-and-must-verify*, never *required* and never
  *forbidden*. Do not assert a fixed count.

---

## Item 4 (checklist §4) — greeting form: already decided (K2-2)

Locked: **real message, persisted in the receiver's local Gun** — not a rendered header. Item 1
implements exactly this (`putMessageRecord` into `conversations/.../messages/support_welcome_
<userId>`). Recorded here for completeness; no separate work.

---

## Item 5 — Test: `stage1` — clear storage, re-open ⇒ exactly one greeting, signature verifies

**Where**
- New spec `tests/e2e/staged/stage1-single-user/03-support-greeting-signed.spec.ts` + companion
  `.md`. Model structure on `01-login-single-user-headcount.spec.ts` (the clear-storage / re-open
  flow at 100–120 is directly reusable: `injectIdbClear`, `manualCleanup`, re-`gotoWebApp`).

**What changes (assertions)**

Drive one ordinary browser user, then clear storage (`injectIdbClear` + close) and re-open:
1. Exactly **one** greeting renders. Assert on the **browser-local** signal, not the server
   snapshot: the support conversation shows one message with the greeting text, and the local Gun
   soul `conversations/conv_support_<root>_<userId>/messages/support_welcome_<userId>` exists exactly
   once (read via `page.evaluate` over local Gun, or count `.conversation-list-item` /
   rendered messages in the support thread — a durable signal per CLAUDE.md).
2. The rendered text **contains the user's own stage name** and the localized greeting stem
   (`'Welcome to IinPublic'` for `en`), proving post-verify `{name}` substitution.
3. The stored record carries a `greetingSignature` that **verifies** against
   `TECHSUPPORT_DM_TRUST_ANCHORS` — assert via `page.evaluate` calling the bundled
   `verifyTechSupportGreeting`, or re-run verify in the test over the read-back record.
4. After clear-storage + re-open: still **exactly one** greeting soul (deterministic id ⇒
   idempotent), signature still verifies. This is the K2 replacement for `01-login`'s old
   re-login `.toBe(1)`.

**Risks / gotchas**
- Do **not** reuse `countSupportWelcomeMessages` (01-login:37–43) — it reads the *server*
  export-snapshot, which under K2 is no longer the authority for the greeting. Assert against the
  browser's local Gun / rendered DOM.

## Item 6 — Test: `stage1` — tampered signature ⇒ greeting suppressed, no impersonated message

**Where**
- New spec `tests/e2e/staged/stage1-single-user/04-support-greeting-tamper-suppressed.spec.ts` +
  `.md`.

**What changes (assertions)**

Simulate a tampered greeting reaching the client and assert silent suppression (K2-3):
1. Seed the support conversation with a greeting record whose `greetingSignature` is corrupted (or
   whose `text` was altered after signing) — write it into local Gun via `page.evaluate` before the
   conversation renders, or import a crafted snapshot.
2. Assert the support thread renders **no** greeting message (verify-on-render drops it) — the
   message list for the support conversation contains zero `support_welcome_*` messages on screen.
3. Assert **no error/warning toast** appears (silent suppression, not an error surface — contrast
   the identity path at app.ts:847 which *does* warn; the greeting deliberately does not).
4. Assert no **impersonated** message is rendered — nothing attributed to
   `TECHSUPPORT_ROOT_USER_ID` in that thread beyond what verifies.

**Risks / gotchas**
- Ensure the test corrupts *after* any client-side write, or the clean client would simply
  overwrite the tampered soul with a valid greeting (deterministic id). Corrupt the record and block
  the re-write, or assert specifically on the render-time drop of the injected bad record.

---

## `01-login-single-user-headcount.spec.ts` rework (required — K1 left this for K2)

K1's design note flagged that this spec still asserts the old browser-written greeting and that
deleting the old path would red it. Under K2 the following must change (K1 explicitly deferred it):

- **Remove** `countSupportWelcomeMessages()` (37–43) and its two `.toBe(1)` server-snapshot
  assertions (89–92, 117–120). The greeting is no longer a server fact.
- **Keep** the headcount assertions (94–97, 121–124) and the identity/stage-name assertions
  (82–86) unchanged — those are K1 invariants, untouched by K2.
- **Replace** the message-content assertions (87–88, currently `.toContain('Welcome to IinPublic')`
  and `.toContain(currentStageName)` read from `myConversations` `lastMessage`) with the same
  browser-local greeting check item 5 introduces: the support conversation's rendered greeting
  contains the stem + stage name, and its stored record's signature verifies. `readFirstUserSupport
  State` (14–35) can stay for `supportConversationCount === 1` (contact count), but the greeting text
  now comes from the verified record, not `lastMessage`.
- Net: `01-login` keeps proving "one support contact + headcount 2 across re-login"; the *greeting*
  correctness moves to spec 03 (item 5). Simplest split is to strip greeting-text assertions from
  `01-login` entirely and let 03 own them, leaving `01-login` a pure contact-count + headcount test.

---

## Contract amendments (`docs/design/techsupport-bootstrap-contract.md`)

K1 left the `support_welcome_<userId>` invariant untouched "pending K2." Now:

- **Lines 19–21** (Invariants): replace "one deterministic welcome message: `support_welcome_
  <userId>`. (Unchanged by K1 — this remains browser-written pending K2's signed, server-storage-
  free rework.)" with: *"Every ordinary user gets one support channel with TechSupport. The welcome
  greeting is rendered client-side from a **compiled, pre-signed, per-locale template**
  (`src/shared/techsupport-greeting.signed.json`, signed by the TechSupport **DM key**), verified
  against `TECHSUPPORT_DM_TRUST_ANCHORS` before rendering, then persisted as a real message in the
  **receiver's own local Gun** at the deterministic soul `support_welcome_<userId>`. Nothing per-user
  is authored or stored by the relay. A client that cannot verify the signature renders **no**
  greeting (never a fabricated one). Substitution of the user's stage name into the `{name}`
  placeholder happens only **after** signature verification."*
- Add to **Invariants**: the greeting satisfies invariant 4 ("every message attributed to
  TechSupport is signed by the TechSupport key and verified by the receiving client") — the browser
  no longer fabricates an unsigned message in TechSupport's name.
- **Current Enforcement**: add `src/shared/techsupport-greeting.ts` (sign/verify/render),
  `scripts/sign-techsupport-greeting.js` (build-time signing from `TECHSUPPORT_SEA_PAIR_JSON`), and
  note that `ensureSupportBootstrapForCurrentUser` (app.ts) now verifies-then-renders and no longer
  reads a `supportState` localStorage gate or calls `sendMessage` to author the greeting.
- **Verification**: add the two new specs (03 signed-greeting, 04 tamper-suppressed) and note
  `01-login` no longer asserts a server-stored greeting.
- Record the honest cost (mirror TODO.md:190–192): changing the greeting copy or rotating the DM key
  requires re-running the signing script and committing a new `.signed.json`.
