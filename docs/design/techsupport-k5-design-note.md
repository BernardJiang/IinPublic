# K5 Design Note — TechSupport DM Q&A: ignore talks, answer questions

Implementation guide for TODO.md **K5** (the requirement, data model, and work list in TODO.md are
authoritative; this note turns them into concrete edits). Companion to
`docs/design/techsupport-k1-design-note.md`, `-k2-design-note.md`, `-k3-design-note.md`, and
`docs/design/techsupport-bootstrap-contract.md` (amended here — see §Contract amendments).

Audience: the implementing (Sonnet-tier) engineer. Every item gives **Where** (file +
function/line), **What changes**, and **Risks/gotchas**. Landing order is first because several
items are only safe in sequence.

**What already shipped (do not rebuild):**
- **Talk exclusion** — `acceptsIncomingTalks()` (`src/shared/techsupport.ts:176`) checked at the top
  of `shouldAcceptIncomingTalkAsync` (`app.ts:1279`). TechSupport never receives a talk, so it can
  never produce a response/match/ignore. TODO.md work-item 1 is done bar a contract line.
- **The pure FAQ module** — `src/shared/techsupport-faq.ts` (20 unit tests). Exposes
  `normalizeSupportQuestion`, `supportQuestionKey`, `isAnswerableSupportQuestion`,
  `lookupSupportAnswer(question, faq) → { status: 'known'|'new'|'unanswerable', ... }`,
  `buildSupportFaqEntry`, `upsertSupportFaqEntry`, `supportAutoAnswerMessageId(userMsgId)`,
  `supportHumanAnswerMessageId(questionKey)`. Types `SupportFaqEntry` and `SupportInboxEntry`
  are defined there. **K5 is wiring this into the live app — not rewriting it.** Note the key gap:
  `SupportFaqEntry` carries **no signature field**; the signed-bundle wrapper (§Item 1) adds it.

The locked pieces this note builds on (do **not** re-litigate):
- **K2** — signed, offline-renderable authorship: a compiled per-locale `.signed.json`, verified
  against `TECHSUPPORT_DM_TRUST_ANCHORS` **before** rendering; personalization (`{name}`) happens
  only after verify; failure ⇒ silent suppress. The greeting is written to the receiver's local Gun
  via `putMessageRecord` (local-only), **not** `sendMessage`. K5's auto-answer and ack reuse this
  exact pattern.
- **K3** — a real TechSupport client: `npm run dev:techsupport` boots the normal web client with the
  canonical DM SEA pair loaded into `localStorage[iinpublic_techsupport_keypair_v1]`, `auth()`s with
  it, adopts `TECHSUPPORT_ROOT_USER_ID` as `currentUserId`, and shows the "TechSupport (root)" badge
  (`ui-manager.ts:1753`). **This is the only session that can sign as TechSupport at runtime** — it
  holds the DM private half. The support-inbox view (§Item 4) and the answer→sign→publish action
  (§Item 5) run inside this session.

---

## The single most important reconciliation (read first)

TODO.md K5's data model says the **pending inbox lives on the TechSupport device, not the relay**,
that a miss is **delivered as an ordinary P2P DM** waiting in **the existing offline mailbox**, and
the tests demand *"assert against the TechSupport device's local state, **not** a server snapshot —
the relay must hold no support data."*

**This contradicts the support channel as it exists today.** The support conversation currently
rides `TechSupportConversationTransport` (`src/web/services/techsupport-conversation-transport.ts`),
which is deliberately **server-durable** (spec §19.7, contract line 29): `sendMessage` does
`buildAndPersistMessage` (local Gun) **then** `POST /api/support/messages/:conversationId`, and
`subscribeToMessages` polls `GET /api/support/messages/:conversationId`. So today every support DM is
mirrored on the relay — exactly what K5's inbox invariant forbids.

**Decision K5-A (recommended, this note adopts it): split the two legs.**
- **User-visible support thread** (the conversation both parties see) — leave on
  `TechSupportConversationTransport` unchanged. It is the durable record of the exchange and the
  greeting/auto-answer/ack all render into it locally. This keeps K2/K3 and the existing E2E green.
- **Inbox delivery** (question → TechSupport device) — do **not** treat the server support store as
  the inbox. Deliver a dedicated, encrypted **inbox envelope** to TechSupport over the existing
  offline mailbox (`postConversationMessageToMailbox`'s sibling — §Item 3), and have the TechSupport
  device build its pending-inbox entry from that envelope into **its own local Gun**. The inbox is
  read from TechSupport-local Gun, never from a server route. This is what makes the K5 tests'
  "assert against the device's local state, relay holds no support data" literally true for the
  inbox, without ripping out the §19.7 durable thread.

The honest alternative (migrate the whole support channel to direct-p2p + mailbox and retire the
server support store) is larger, touches §19.7, and re-reds the K2/K3 specs. Defer it; K5-A is the
minimal path that satisfies the K5 tests. Record the split in the contract.

---

## FAQ bundle distribution: what actually exists vs. what TODO.md's prose assumes

TODO.md's data model says the FAQ bundle is *"published over the existing libp2p/IPFS path (spec
§25); relay stores at most the CID pointer."* **Investigated — that path does not exist for bundles
today.** What is real:
- `src/web/services/web-content-node-service.ts` is a Helia/libp2p **blockstore for media
  attachments** (`IpfsAttachment`, talk attachment pin/publish). It addresses file bytes by CID and
  serves them peer-to-peer. It is **not** a signed-document publish/subscribe mechanism, and nothing
  routes a FAQ bundle through it.
- Spec §25 ("libp2p Transport Migration & IPFS Content Layer") and
  `docs/design/S3-native-libp2p-shell.md` are explicitly **"Design (no code yet)."** The
  "existing libp2p/IPFS path" for arbitrary signed documents is **aspirational for a later phase.**

**Therefore v1 (Decision K5-B, this note adopts it): a signed, Gun-graph-mirrored FAQ bundle,
content-addressed by CID for forward-compatibility, but distributed over Gun today — not libp2p.**
Concretely:
- The bundle is a signed JSON document (§Item 1) published by the TechSupport **device** (which holds
  the DM key) to a **public Gun path** `techsupport-faq/bundle`. Clients subscribe to that path,
  verify the signature against `TECHSUPPORT_DM_TRUST_ANCHORS`, and cache the verified bundle in
  `localStorage[iinpublic_techsupport_faq_bundle_v1]`. Auto-answer runs **locally** from the cache,
  so known questions work while the TechSupport device is away (the cache is the whole point).
- Compute a `bundleCid` (via `computeCIDv1` from `src/shared/cid.ts`) and store it alongside the
  bundle. This is the "relay stores at most the CID pointer" gesture, honestly reduced: today the
  relay mirrors the whole signed bundle over Gun (it is public, immutable-per-version, and
  signature-verified, so relay custody leaks nothing and cannot forge). When the real §25 document
  layer lands, swap the *distribution* (publish the signed bundle to IPFS, put only `bundleCid` on
  Gun) with **no change to the sign/verify/cache/lookup code** — that is why we content-address now.
- **Say this plainly in the contract:** v1 distributes the FAQ bundle over a public Gun path signed
  by the DM key; libp2p/IPFS distribution is a §25-gated follow-up, not a K5 dependency.

Per-key granularity note: TODO.md's individual FAQ soul is `techsupport-faq/<key>`. Keep that as the
**per-entry** read model (the human-answer test asserts `techsupport-faq/<key>` holds the pair after
promotion) **and** publish the whole signed bundle at `techsupport-faq/bundle` for atomic cache +
signature. Write both from the publish action (§Item 5): `techsupport-faq/<key>` for the per-key
assertion, `techsupport-faq/bundle` for the cacheable signed document.

---

## Recommended implementation order

Governing constraint: the hit/miss branch (Item 2) replaces the blanket `sendTechSupportAutoReply`,
and it depends on the signed-bundle module (Item 1) for the answer signature and on the ack template
(also Item 1) for the miss reply. The inbox view (Item 4) and publish action (Item 5) are only
exercisable from a `dev:techsupport` session, so land the delivery (Item 3) first so there is
something for the inbox to show. Tests last.

1. **Item 1 — signed-bundle + ack module + strings.** `src/shared/techsupport-faq-bundle.ts`
   (sign/verify/cache over `techsupport-faq.ts`), the compiled `techsupport-support-ack.signed.json`
   (per-locale ack, mirrors the greeting artifact), `scripts/sign-techsupport-support-ack.js`, and
   the two `ui-translations.ts` strings. Pure/compiled additions, `tsc`+unit verifiable in isolation.
   Land the "committed ack blob verifies against the DM anchors" unit test here (the K2 verify-round-
   trip-gate discipline).
2. **Item 2 — hit/miss branch** replacing `sendTechSupportAutoReply` on the asker's client. Uses the
   cached bundle from Item 1 for the hit, the signed ack for the miss, and calls Item 3's delivery on
   the miss. Land with Item 3 in one commit (the miss path needs the delivery to exist).
3. **Item 3 — inbox delivery + TechSupport-device ingest.** The mailbox inbox envelope
   (`postSupportQuestionToMailbox`) and the TechSupport-side drain→`techsupport-inbox/*` local write.
4. **Item 4 — support-inbox view**, gated on `currentUserId === TECHSUPPORT_ROOT_USER_ID`. Read-only
   list of pending entries first; the answer control is Item 5.
5. **Item 5 — answer inline + publish/promote-to-FAQ** (one action): sign the entry with the live DM
   pair, write `techsupport-faq/<key>` + republish `techsupport-faq/bundle`, deliver the signed
   answer to the asker, flip the inbox entry to `answered`. Includes the **question-text edit-before-
   promote** affordance (privacy — §Item 8).
6. **Tests** (Item 6) last.

**Single biggest risk (read first):** the auto-answer text must be **byte-identical** to what was
signed, or verify-on-render silently drops it (K2-3 fail-closed) and the asker sees nothing. Two
traps: (a) the **auto-answer prefix** ("Auto-answer:") must be a **render-time UI decoration** (like
the existing `conversationBotAnswered` badge), **never concatenated into the signed `answer` text** —
sign the bare answer, decorate on render, exactly as K2 substitutes `{name}` only after verify; (b)
the signing payload builder must be imported from `techsupport-faq-bundle.ts` by **both** the
publish action and the verify path (never a re-typed copy), so a canonical-serialization drift can't
ship as "answers never render for anyone."

---

## Item 1 — Signed FAQ-bundle module, compiled ack template, and the two strings

### 1a. `src/shared/techsupport-faq-bundle.ts` (new) — signs/verifies the dynamic bundle

Unlike the K2 greeting (static, compiled, signed once by a build script), the FAQ bundle **grows at
runtime** as the operator answers questions, so it is signed **live by the TechSupport device**
(which holds the DM pair via K3), not by a build script. Mirror the sign/verify convention of
`src/shared/system-announcements.ts` / `techsupport-greeting.ts` exactly (`SEA.sign`/`SEA.verify`
over `canonicalSerialize(...)`, trust-anchor check via `isTrustedTechSupportDmPub`).

```ts
import { canonicalSerialize, computeCIDv1 } from './cid';
import SEA from 'gun/sea';
import { isTrustedTechSupportDmPub, currentTechSupportDmPub } from './techsupport';
import type { SupportFaqEntry } from './techsupport-faq';

export interface SignedFaqBundle {
  version: number;
  entries: SupportFaqEntry[];   // { questionKey, canonicalQuestion, answer, answeredAt }
  authorPub: string;
  bundleCid: string;            // computeCIDv1 of the canonical unsigned bundle (forward-compat, K5-B)
  signature: string;
}
export type UnsignedFaqBundle = Omit<SignedFaqBundle, 'signature'>;

export function faqBundleSigningPayload(b: UnsignedFaqBundle): string {
  return canonicalSerialize({ kind: 'techsupport-faq-bundle', version: b.version,
    entries: b.entries, authorPub: b.authorPub, bundleCid: b.bundleCid });
}

/** Runtime, TechSupport-device only (holds the DM pair). Signs the current bundle for publish. */
export async function signFaqBundle(entries: SupportFaqEntry[], pair): Promise<SignedFaqBundle>

/** Any client. Verifies author ∈ DM anchors + signature recovers the canonical payload; null on fail. */
export async function verifyFaqBundle(value: unknown): Promise<SignedFaqBundle | null>
```

`verifyFaqBundle` mirrors `verifyTechSupportGreeting`: shape check, `isTrustedTechSupportDmPub
(authorPub)`, recompute `bundleCid` and confirm it matches (rejects a tampered entries list even if
otherwise validly signed), then `SEA.verify` and compare the recovered payload. Return the verified
bundle or `null` — never throw (silent-suppress).

**Why the whole bundle is signed, not per-entry:** the asker's own client auto-answers, and it must
attach a valid TechSupport signature to the rendered message despite not holding the key — identical
to the K2 greeting problem. It solves it the same way: the **signature travels with the cached
data.** The asker renders `entry.answer` and stamps the message with the bundle's `authorPub` +
`signature` + the `questionKey`, then verify-on-render re-checks the cached bundle. (Per-entry
signatures are also viable but the single-bundle signature is fewer moving parts and matches the
"cache the bundle" wording; keep the whole verified bundle in the message's provenance by
re-verifying the cached bundle at render, keyed on `questionKey`.)

Add a tiny cache helper here or in a web service (see Item 2):
`readCachedFaqBundle(): SupportFaqEntry[]` / `writeCachedFaqBundle(SignedFaqBundle)` over
`localStorage[iinpublic_techsupport_faq_bundle_v1]`, only ever writing a bundle that `verifyFaqBundle`
accepted.

### 1b. Compiled, pre-signed acknowledgement template (mirrors the greeting artifact exactly)

The miss-path ack ("this is a new question, a human will get back to you") is **static text
attributed to TechSupport**, so invariant 4 requires it be signed — and it must render offline (the
device may be away). This is the greeting problem again, so reuse the greeting machinery verbatim:

- **New compiled artifact** `src/shared/techsupport-support-ack.signed.json` — same shape as
  `techsupport-greeting.signed.json`: `{ version, acks: [{ locale, template, authorPub, signature }] }`.
- Put the templates and sign/verify/render in `techsupport-greeting.ts` (extend it — it already owns
  `TECHSUPPORT_GREETING_TEMPLATES` and `verifyTechSupportGreeting`) **or** a parallel
  `techsupport-support-ack.ts`. Prefer extending `techsupport-greeting.ts`: add
  `TECHSUPPORT_SUPPORT_ACK_TEMPLATES`, `signSupportAck`, `verifySupportAck`, reusing
  `isTrustedTechSupportDmPub` and the same canonical payload style. The ack may include `{name}` —
  substitute only after verify.
- **New signing script** `scripts/sign-techsupport-support-ack.js` + `npm run sign:techsupport-ack`,
  modelled line-for-line on `scripts/sign-techsupport-greeting.js` (reads `TECHSUPPORT_SEA_PAIR_JSON`,
  asserts `pair.pub === currentTechSupportDmPub()`, writes the committed blob). Re-run only on copy
  or key change.

### 1c. The two `ui-translations.ts` strings (replace the blanket `supportReply`)

`ui-translations.ts:422` currently has the single blanket `supportReply` used by
`ui-manager.formatSupportReply` (4652). TODO.md wants it replaced by a hit/miss pair. Add, EN + 中文:

```
supportAutoAnswerPrefix: 'Auto-answer',            // 中文: '自动回答'
supportNewQuestionAck: "Thanks, {name}. This is a new question — a human will get back to you here.",
// 中文: '谢谢你，{name}。这是一个新问题，我们的人工客服会在这里回复你。'
```

The `supportAutoAnswerPrefix` is the **render decoration** for a hit (a badge/label beside the
verified answer, like `conversationBotAnswered` at 414); it is **not** part of the signed answer.
The `supportNewQuestionAck` string is the *compiled ack template text* (§1b) — keep the
`ui-translations` copy and the `.signed.json` template byte-identical, guarded by a unit test that
`ui-translations.supportNewQuestionAck === TECHSUPPORT_SUPPORT_ACK_TEMPLATES.en` (the same
anti-drift discipline K2 applied to the greeting). Delete the old `supportReply` and
`formatSupportReply` once §Item 2 stops calling it.

---

## Item 2 — Hit/miss branch on the asker's client (replaces `sendTechSupportAutoReply`)

**Where**
- `src/web/app/app.ts:4820-4821` — the send handler: after the user's `sendMessage` on a support
  conversation, `if (conversation?.supportChannel || otherUserId === TECHSUPPORT_ROOT_USER_ID) await
  this.sendTechSupportAutoReply(...)`. This is the hook. Crucially, **this already runs on the
  asker's own client**, so "the ordinary user's own client runs lookup locally" is a small change,
  not new plumbing.
- `src/web/app/app.ts:2455-2470` — `sendTechSupportAutoReply` (delete/replace).
- `src/web/services/gun-message-store.ts:245` — `putMessageRecord` (the local-only write K2 used).
- `src/web/services/web-conversation-service.ts:346` — `upsertMessageRecord` delegating to it.

**What changes** — replace `sendTechSupportAutoReply(conversationId, userMessageId)` with
`handleSupportQuestion(conversationId, userMessageId, questionText)`:

1. Guard as today: `if (!this.currentUser || isTechSupportUser(this.currentUser)) return;` (the
   TechSupport device does not auto-answer its own thread).
2. `const faq = this.readCachedFaqBundle();` (verified cache from Item 1).
   `const result = lookupSupportAnswer(questionText, faq);`
3. **`result.status === 'unanswerable'`** (emoji/whitespace, no question) → do nothing. No answer,
   no inbox entry (the pure module already special-cases this).
4. **`result.status === 'known'`** (HIT) → render a signed auto-answer **locally**, exactly like the
   K2 greeting (authored-by-TechSupport, not transmitted). Reuse `upsertMessageRecord` with a
   deterministic id `supportAutoAnswerMessageId(userMessageId)`:
   ```
   { id: supportAutoAnswerMessageId(userMessageId), senderId: TECHSUPPORT_ROOT_USER_ID,
     text: result.entry.answer, timestamp: now, channel: 'public', transport, isFromChatbot: true,
     faqQuestionKey: result.questionKey, faqAuthorPub: <cachedBundle.authorPub>,
     faqSignature: <cachedBundle.signature> }
   ```
   Then `uiManager.updateConversationMessage(...)`. **Do not** `sendMessage` — the answer is authored
   locally from a signed cache and works offline (TODO.md: "known questions work even while
   TechSupport's device is away").
5. **`result.status === 'new'`** (MISS) → (a) render the signed **ack** locally via `upsertMessageRecord`
   (verify the compiled ack against the DM anchors first, K2-3 suppress on failure; substitute
   `{name}` after verify; id `support_ack_${userMessageId}`), and (b) **deliver the question to the
   TechSupport device** via §Item 3's `postSupportQuestionToMailbox(...)`.

**Verify-on-render** (defends a tampered *stored* auto-answer, and re-checks the offline cache): in
`ui-manager.formatConversationMessage` (the same place K2 verifies `support_welcome_*`), when a
message carries `faqSignature`/`faqQuestionKey`, re-verify: reconstruct the entry from the cached
bundle by `questionKey`, confirm `entry.answer === message.text`, and `verifyFaqBundle`(cache)
holds and its `authorPub` is a DM anchor; on failure **drop the message** (return the sentinel K2's
verify-on-render uses). Apply the `supportAutoAnswerPrefix` decoration around the verified text
(never inside it).

**Risks/gotchas**
- The `questionText` must be the raw user message. It is available at the call site as `data.message`
  (app.ts:4798) — thread it into `handleSupportQuestion` rather than re-reading Gun.
- Idempotency: deterministic ids mean a replayed send overwrites the same soul — required so a
  reconnect/re-render doesn't double-answer.
- A cache miss because the bundle hasn't synced yet is correctly a `new` result — the asker gets the
  ack and the question is queued; when the operator later answers, the same question becomes a hit.
  Do not block on a bundle fetch in the send path.

---

## Item 3 — Inbox delivery to the TechSupport device (mailbox) + device-side ingest

Per Decision K5-A, the question reaches TechSupport as an **encrypted mailbox envelope**, and the
inbox lives in **TechSupport's own local Gun** — never a server route.

**Where**
- `src/web/app/app.ts:1792` — `postConversationMessageToMailbox` (the model to copy: resolve the
  recipient's `epub`, encrypt with `mailbox.encryptForRecipient`, `postEnvelope`).
- `src/web/app/app.ts:1703-1730` — the mailbox drain dispatch (`kind === 'conversation-message-v1'`
  → `ingestConversationMessageFromMailbox`). Add a new `kind`.
- `src/web/services/web-mailbox-client.ts` — envelope post/encrypt.

**What changes**
1. **New envelope kind** `support-question-v1`:
   ```
   type MailboxSupportQuestionPayload = { kind: 'support-question-v1';
     questionKey: string; question: string; askedBy: string; conversationId: string; askedAt: string };
   ```
2. **New sender** `postSupportQuestionToMailbox(entry: SupportInboxEntry)` — mirror
   `postConversationMessageToMailbox`, but `recipientUserId = TECHSUPPORT_ROOT_USER_ID`, resolve
   TechSupport's `epub` from the verified `public/techsupport-identity` record (`app.ts:854/877` —
   the identity blob carries `epub`; encrypt to it), envelope id
   `mbx_support_${questionKey}_${askedBy}` (deterministic ⇒ idempotent; a repeat ask overwrites, not
   duplicates). Called from Item 2's miss path. Because it goes through the mailbox, an **offline**
   TechSupport device receives it on reconnect drain — TODO.md's "waits in the existing offline
   mailbox and lands on reconnect."
3. **Device-side ingest** `ingestSupportQuestionFromMailbox(payload)` — runs on the drain dispatch,
   but only when `this.currentUser?.id === TECHSUPPORT_ROOT_USER_ID` (an ordinary user must never
   materialize someone else's inbox). Build a `SupportInboxEntry { questionKey, question, askedBy,
   conversationId, askedAt, status: 'pending' }` and write it to **TechSupport-local Gun** at
   `techsupport-inbox/${questionKey}` (idempotent by key; a duplicate ask does not create a second
   pending row — TODO.md's "exactly one pending entry"). Do **not** POST anywhere.

**Risks/gotchas**
- The relay must hold no support data: the mailbox envelope is **encrypted to TechSupport's epub**,
  so while it transits the mailbox server it is opaque ciphertext, and once drained it is deleted
  from the mailbox and lives only in TechSupport-local Gun. Confirm the mailbox client deletes the
  envelope on successful drain (it does for `conversation-message-v1`).
- `techsupport-inbox/*` is written under the TechSupport session's Gun; it is **not** a `public/`
  path, so it does not replicate as an authority record. The K5 test asserts against this local
  state via `page.evaluate`, matching TODO.md's "not a server snapshot."
- Do not deliver the inbox envelope from the TechSupport device to itself; the miss path is only ever
  taken by an ordinary asker (`isTechSupportUser` guard in Item 2).

---

## Item 4 — Support-inbox view (visible only to the TechSupport root session) `[Opus]`

**Where**
- `src/web/ui/ui-manager.ts:1753` — `isTechSupportRoot = user.id === TECHSUPPORT_ROOT_USER_ID`
  already exists (it gates the "TechSupport (root)" badge). Reuse this exact predicate to gate the
  inbox. (`currentUserId` is set at `adoptSessionUser`, `ui-manager.ts:1736`.)
- `src/web/ui/ui-manager.ts` — the Me/Settings render composition (`renderSettingsView`, called at
  1769) is the natural host; the inbox is an operator tool, not a per-user surface.

**What changes**
- Add a **new section inside the Me tab**, rendered **only when `isTechSupportRoot`** — do not add a
  fourth top-level tab for everyone (it would be dead UI for every ordinary user and needs no
  runtime gating if it is a conditional section). Title e.g. "Support inbox".
- New view module `src/web/ui/support-inbox-view.ts` (follow the `answers-view.ts` /
  `conversations-view.ts` deps-object pattern): `renderSupportInbox(deps)` where deps supplies
  `listPendingQuestions(): SupportInboxEntry[]` (read `techsupport-inbox/*` from local Gun, filter
  `status === 'pending'`), plus the `answerQuestion` callback (Item 5). Each row shows the raw
  `question` and `askedAt`; the answer control is Item 5.
- Wire it via the same event-driven pattern (`emit('answerSupportQuestion', { questionKey, ... })`
  from the view, handled in `app.ts`). Subscribe to `techsupport-inbox/*` so newly-drained questions
  appear live.

**Risks/gotchas**
- Gate on the **id**, not on dev-mode — a production operator device (real key file) must see it too,
  consistent with the K3 badge decision.
- The inbox reads local Gun only; render an empty state, not an error, when the device just booted
  and hasn't drained.

---

## Item 5 — Answer inline: sign, publish + promote to FAQ, deliver, mark answered (one action)

Runs only in the `dev:techsupport` session (holds the DM pair). One button per pending row does all
four steps atomically.

**Where**
- `app.ts` — new handler for `answerSupportQuestion`. Uses `this.gunService.getStoredPair()` (the
  canonical DM pair, guaranteed by K3's boot) to sign.
- `src/shared/techsupport-faq.ts` — `buildSupportFaqEntry`, `upsertSupportFaqEntry`,
  `supportHumanAnswerMessageId` (already built).
- `src/shared/techsupport-faq-bundle.ts` — `signFaqBundle` (Item 1).

**What changes** — `handleAnswerSupportQuestion({ questionKey, question, answer, conversationId,
askedBy })`:
1. **Build + promote the FAQ entry:** `const entry = buildSupportFaqEntry({ question, answer });`
   `const nextEntries = upsertSupportFaqEntry(currentEntries, entry);`
   `const signed = await signFaqBundle(nextEntries, pair);`
2. **Publish** (Decision K5-B): write the per-key soul `techsupport-faq/${questionKey}` = the entry
   (satisfies the test's `techsupport-faq/<key>` assertion) **and** `techsupport-faq/bundle` = the
   signed bundle (the cacheable, signature-verified document every client subscribes to). Both are
   `public/`-style reads; the signature is the authority, so relay custody is safe.
3. **Deliver the answer to the asker:** `sendMessage(conversationId, TECHSUPPORT_ROOT_USER_ID, answer,
   { otherUserId: askedBy, messageId: supportHumanAnswerMessageId(questionKey), isFromChatbot:false })`
   over the support transport (the operator device is online and authenticated, so this is a genuine
   signed-by-authorship DM — the K2 §"K2-1 follow-up half" mechanism). The asker's client, on
   receiving it and then re-asking the same question, gets a **hit** from the now-updated cached
   bundle (no new inbox entry, no duplicate FAQ row — `upsertSupportFaqEntry` replaces by key).
4. **Flip the inbox entry** `techsupport-inbox/${questionKey}.status = 'answered'` in local Gun.

**Open-question resolution — `answeredBy` (TODO.md Open question).** Recommendation (this note makes
the call, per the K3 precedent of deciding rather than dangling): **record the operator internally,
display as TechSupport.** Add `answeredBy?: string` to the local `SupportInboxEntry` write (the
operator's device identity / a machine id), kept in **TechSupport-local Gun only** for an audit
trail; it is **never** placed in the published `SupportFaqEntry` or the delivered message, both of
which are authored as `TECHSUPPORT_ROOT_USER_ID`. Rationale: the user's trust anchor is "TechSupport,"
not a named human; but an operator team needs to know who answered what. Local-only `answeredBy`
gives the audit trail without leaking operator identity to users or the public bundle.

**v1 edit/retire scope (TODO.md work-item "decide whether a developer can edit or retire").**
Recommendation: **v1 supports add and edit-by-re-answer (overwrite), not retire.** `upsertSupportFaqEntry`
already replaces the entry for a `questionKey`, so re-answering an existing question edits it for
free — expose that (the inbox/answer control can answer a question that already has an entry, which
overwrites). **Retire/delete is out of v1** (it needs a tombstone in the signed bundle so caches drop
it, not just a Gun delete — Gun has no true delete; a naive delete leaves stale caches auto-answering).
Record this decision in TODO.md K5.

**Risks/gotchas**
- `signFaqBundle` must run on the device that holds the pair; `getStoredPair().pub` must equal a DM
  anchor (K3 guarantees this or refuses to boot). Guard and surface a clear error if somehow absent.
- Sign the **bare** answer into the entry; the auto-answer prefix is render-only (Item 2 risk note).

---

## Item 6 — Tests (map 1:1 to TODO.md K5 "Tests")

All specs get a companion `.md` and assert via hard signals (support `.conversation-list-item`,
rendered messages, local-Gun snapshots via `page.evaluate`), never toasts. Placement is `stage1`
(one ordinary user + the TechSupport device) except the cross-user one (`stage2`).

1. **`stage1` — talk exclusion.** User broadcasts all four talk types to Global; TechSupport's IN
   index stays empty, no response/match, Global headcount stays 2. (Largely exercises the already-
   shipped `acceptsIncomingTalks`; this is the regression guard.)
2. **`stage1` — new question → ack + one pending entry.** Ordinary user DMs a brand-new question;
   asserts the ack renders in the support thread, and (in a `dev:techsupport` context) exactly one
   `techsupport-inbox/*` pending entry exists in **TechSupport-local Gun** (`page.evaluate`), not a
   server route.
3. **`stage1` — offline delivery.** Ask a new question with the TechSupport context **not running**;
   start it; the question drains from the mailbox and appears in the inbox.
4. **`stage1` — offline auto-answer.** With TechSupport stopped, a **known** question (bundle already
   cached) is auto-answered locally; the signed auto-answer renders and verifies.
5. **`stage1` — operator answers.** `dev:techsupport` context sees the pending question, answers it;
   the asker's support thread receives the answer, the inbox entry flips to `answered`, and
   `techsupport-faq/<key>` holds the pair.
6. **`stage1` — re-ask is a hit.** Same user re-asks; auto-answered, **no** new inbox entry, **no**
   duplicate FAQ row.
7. **`stage2` — different user, no operator.** A second ordinary user asks the same question and is
   auto-answered from the synced bundle with zero developer involvement.

**Test infra note:** the `dev:techsupport` browser context is built by extending
`tests/e2e/helpers/super-user-techsupport-shared.ts` (injects the root id + DM pair via
`addInitScript`, per K3's Item 5). Reuse it for every context that must *be* TechSupport.

---

## Item 8 (TODO.md "Privacy note") — edit the question before promoting

TODO.md: *"never promote a question containing the asker's personal detail verbatim into the public
FAQ."* The pure module keys the FAQ entry on `buildSupportFaqEntry({ question, answer })`, i.e. the
**question text becomes the public `canonicalQuestion`.** So the operator **must** be able to edit the
question text — not only the answer — before it is signed and published.

**This note's design gives them exactly that:** the Item 5 answer control exposes **two** editable
fields — the **question** (pre-filled with the raw asked text) and the **answer** — and
`buildSupportFaqEntry` is called with the **edited** question. Concretely, keep the *inbox lookup key*
(`SupportInboxEntry.questionKey`, derived from the original asked text) for the miss→answer→flip
bookkeeping, but derive the **published** entry from the operator-edited question, so the public
`canonicalQuestion` and its `questionKey` are the sanitized general form. Add a one-line UI warning in
the answer control ("This question text will be public — remove any personal detail before
publishing."), per TODO.md's "add this as a rule in the answering UI."

Caveat to surface: because the published `questionKey` is derived from the **edited** question, an
identical **future** asker is auto-answered only if their raw question normalizes to the edited
general form. If the operator rewrites the question substantially, the original asker's *re-ask* of
their literal phrasing may miss. That is an acceptable v1 cost of exact-match-only (TODO.md scopes
fuzzy matching out); note it so nobody treats a "re-ask after a heavy edit missed" as a bug.

---

## Contract amendments (`docs/design/techsupport-bootstrap-contract.md`)

- **Invariants — talk exclusion:** add TODO.md work-item 1's still-pending line — *"TechSupport is
  never a talk recipient: `acceptsIncomingTalks(id)` (`src/shared/techsupport.ts`) is a hard rule on
  the canonical root id, checked at the top of `shouldAcceptIncomingTalkAsync`, so TechSupport can
  never produce a response, match, or ignore. It is not a `TalkIntakeFilters` entry (those are
  user-editable and could filter it back in)."*
- **Invariants — support Q&A (new):** *"Answered questions are auto-answered **locally** on the
  asker's own device from a cached, DM-key-signed FAQ bundle (`techsupport-faq/bundle`), verified
  against `TECHSUPPORT_DM_TRUST_ANCHORS` before render — so known questions work while the TechSupport
  device is offline. A new question renders a compiled, pre-signed acknowledgement and is delivered to
  the **TechSupport device** as an encrypted offline-mailbox envelope; the pending inbox
  (`techsupport-inbox/*`) lives in **TechSupport-local Gun**, never on the relay. The operator (a
  `dev:techsupport` session holding the DM pair) answers inline: signs the updated bundle, publishes
  `techsupport-faq/<key>` + `techsupport-faq/bundle`, delivers the answer, and flips the entry to
  answered."*
- **Decision K5-A (support-channel split):** record that the **user-visible** support thread stays on
  the server-durable `TechSupportConversationTransport` (§19.7) while the **inbox delivery** rides the
  offline mailbox so the relay holds no inbox data; a full migration of the support channel off the
  server store is a deferred follow-up.
- **Decision K5-B (FAQ distribution):** record that v1 distributes the signed FAQ bundle over a public
  Gun path (`techsupport-faq/bundle`), content-addressed by `bundleCid` for forward-compat;
  libp2p/IPFS distribution (spec §25) is a later-phase swap of the distribution layer only, **not** a
  K5 dependency — the current codebase has no signed-document libp2p publish path (only the media-
  attachment blockstore in `web-content-node-service.ts`).
- **Decision `answeredBy`:** record internally (TechSupport-local audit trail), display/author as
  TechSupport; never in the public bundle or delivered message.
- **Decision edit/retire:** v1 supports add + edit-by-overwrite (`upsertSupportFaqEntry`); retire/
  delete is out of scope (needs a signed tombstone so caches drop the entry — Gun has no true delete).
- **Current Enforcement:** add `src/shared/techsupport-faq.ts` (pure lookup, shipped),
  `src/shared/techsupport-faq-bundle.ts` (sign/verify/cache), the compiled
  `techsupport-support-ack.signed.json` + `scripts/sign-techsupport-support-ack.js`
  (`npm run sign:techsupport-ack`), and note the hit/miss branch in `app.ts` replaced
  `sendTechSupportAutoReply`/`supportReply`.
- **Verification:** add the seven K5 specs (talk-exclusion, new-question ack + one pending, offline
  delivery, offline auto-answer, operator-answer + promote, re-ask hit, `stage2` cross-user).
- **Honest cost:** changing the ack copy or rotating the DM key re-runs `sign:techsupport-ack` and
  ships a new client build (compiled ack + anchors); the FAQ bundle itself is signed live by the
  operator device, so answering questions needs no rebuild.
