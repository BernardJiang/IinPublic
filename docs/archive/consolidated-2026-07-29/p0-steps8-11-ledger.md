# P0 Steps 8–11 — Unified Local Talk Ledger (design note)

> Status: design only. Implementation handed to Sonnet (steps 9–11 are one Opus-designed,
> Sonnet-implemented session per TODO §19). Order: **8 → (7 deletes server guards) → 9 → 10 → 11.**
> Authoritative design of record: spec §23.6 (per-talk response inbox / broadcast suppression),
> §20.7 (TALK_RETRACTED), §19.13, REQ-LEDGER-04 (versioning), REQ-LEDGER-15 (retraction),
> REQ-LEDGER-16 (mutual exchange suppression). TODO P0 steps 8–11.

Steps 8–11 share one ordering/versioning machinery and **must be built on one record**, so the inbox
written in step 8 carries the fields steps 9–11 need with **no migration**. This note designs that
record (the *talk-outcome ledger*) once, then maps each step's TODO checkbox onto it.

## 0. Substrate verified in code (do not rebuild)

- `P2PMeshTalkResponsePayload` (`src/shared/p2p-mesh-protocol.ts` L34) already carries `responseId`
  = `CIDv1({talkId, responderId, responseContentJson})`, `version:number`, `respondedAt:string`,
  `submittedAt`, and is unicast to `recipientUserId: authorId`. **Inert at v1 today; steps 9–11 activate.**
- `recordLocalTalkExchange` (`app.ts` L1504) writes `localStorage.localTalkExchanges`, keyed
  `${peerId}::${talkId}`, and already stores `{ responseId, version, respondedAt }` via its `meta` arg
  (L1510–1531). Author-side ingest (`handleMeshTalkResponse`, L1107) and responder-side
  (`submitTalkResponsePairDirect`, ~L2075) both call it.
- `LocalTalkExchange` type (`src/web/services/local-peer-derivation.ts`) already declares the R-2
  forward-compat fields. Contacts/peer/match% derive from it (step 5).
- Author-qualified keying `talkId::authorId` is end-to-end (step 1 R-a): mesh body cache, delivery
  dedup, response routing. **Two authors of identical content share `talkId`** — every retraction,
  outcome record, and exchanged entry below MUST be author-qualified.
- `identityKey` = `qa_<hash>` content hash over a talk's normalized questions/answers
  (`buildTalkIdentityKey`, `cid.ts` L276); incoming clusters carry `cluster.identityKey`.
- An existing `WebLedgerService` (`src/web/services/web-ledger-service.ts`) is the **Phase E append-only
  signed feed** (`InteractionKind` enum, Gun `ledger/<userId>/*`, delta-sync). It is the *audit log*,
  not the per-peer outcome state these steps need. **Decision: this note's ledger is a separate
  derived projection** (see §1); it *consumes* `TALK_ANSWERED`/`TALK_RETRACTED` events but is the fast
  local read path for suppression. We do **not** reuse the signed-feed store as the working set.

### Server guards step 8 replaces (so step 7 can delete them)

| Server artifact (`src/server/`) | Replaced by (client-side) |
|---|---|
| `talkResponsesMap: Map<talkId, TalkResponse[]>` (`index.ts` L52) — "who answered whom" | `outcomes[]` rows in the unified ledger (§1) |
| `SymmetricTalkEdgeRateLimiter` (`services/symmetric-talk-edge-rate-limit.ts`), one `cooldownMs` timestamp per user, `CONFIG.SYMMETRIC_TALK_EDGE_COOLDOWN_MS` (default `0`) | client per-edge cooldown (§ Step 8.3) |
| `DailyWeeklyTalkEdgeQuotaRateLimiter` (`services/daily-weekly-talk-edge-quota-rate-limit.ts`), `CONFIG.RATE_LIMITS.TALK_SEND_DAILY=10` / `TALK_SEND_WEEKLY=50`, UTC day / UTC-Monday week buckets | client per-edge daily/weekly quota (§ Step 8.3) |
| `peer-routes.ts` consumers of `talkResponsesMap` (match counts, relationship stats) | already replaced by `local-peer-derivation.ts` (step 5); peer-routes deleted in step 7 |

Step 7 removes the maps and both limiter services + their `resetForTesting` calls (`index.ts` L335–336)
and the `CONFIG.RATE_LIMITS` / `SYMMETRIC_TALK_EDGE_COOLDOWN_MS` server reads. Step 8 must land the
client equivalents **first** so deletion does not open an unbounded-rebroadcast hole.

---

## 1. Cross-cutting: the unified local ledger store

**One store serves steps 8–11.** Three overlapping stores (author outcomes, exchanged set,
cooldown counters) would drift; collapse them.

**Name / location.** `TalkLedgerStore`, persisted to **`localStorage` key `talkLedger`** (single JSON
doc; same tier as `localTalkExchanges`/`myConversations`, survives reload, no Gun replication, no
server read). *Rationale for localStorage over local Gun user-space:* the working set is read on every
broadcast (hot path), is private-by-construction (never leaves the device except as already-encrypted
`talk-response` frames), and needs synchronous reads at recipient-selection time. Local Gun user-space
is reserved for the signed `WebLedgerService` audit feed.

**Schema (one doc, three indexed sections):**

```ts
// src/shared/talk-ledger.ts  (shared types + pure ordering fns; unit-testable, no DOM)
type TalkLedgerDoc = {
  version: 1;
  // (A) AUTHOR outcomes — step 8 inbox; "who answered MY talk and how"
  //     key: `${responderId}::${talkId}::${authorId}`  (authorId === self here)
  outcomes: Record<string, OutcomeEntry>;
  // (B) EXCHANGED set — step 11; symmetric pair-identity record, BOTH roles
  //     key: `${peerId}::${identityKey}`
  exchanged: Record<string, ExchangedEntry>;
  // (C) EDGE counters — step 8.3 cooldown/quota; key: `${peerId}` (outbound only)
  edges: Record<string, EdgeCounter>;
  // (D) RETRACTED — step 10 tombstones; key: `${talkId}::${authorId}`
  retracted: Record<string, { retractedAt: number }>;
};

type Outcome = 'matched' | 'ignored' | 'no-reply';      // spec §23.6 wording
type OutcomeEntry = {
  responderId: string; talkId: string; authorId: string;
  identityKey: string;                  // links outcome → exchanged/suppression (step 11)
  outcome: Outcome;
  version: number;                      // responder's response version (REQ-LEDGER-04)
  responseId: string;                   // CIDv1 of the winning response
  respondedAt: string;                  // ISO; last-writer tiebreak after version
  updatedAt: string;                    // local ingest time
};
type ExchangedEntry = {
  peerId: string; identityKey: string;
  outcome: Outcome; version: number;
  role: 'author' | 'responder';         // who sent the identity; both sides still write an entry
  lastExchangedAt: string;
};
type EdgeCounter = {
  lastSendAt: number;                   // ms epoch — cooldown basis
  dayBucketStartMs: number; sentToday: number;
  weekBucketStartMs: number; sentThisWeek: number;
};
```

**Relation (A ⊂/↔ B).** Per the TODO's "author-side outcomes ⊂ exchanged set?" — they are **not** a
strict subset but **co-written**: an author outcome (A) is always accompanied by an exchanged entry (B)
for the same `(responderId→peerId, identityKey)`; the **responder** side has a (B) entry with no (A)
entry (it answered, it is not the author). So B ⊇ {A projected to identity} ∪ {responder-side exchanges}.
**Keep them as separate sections of one doc** (different key shapes: A is per-`talkId`, B is
per-`identityKey`), written together in one transaction. One store, role-annotated — exactly the TODO's
ask. The `identityKey` on each OutcomeEntry is the join column.

**Size bounds / eviction.** Cap `outcomes` + `exchanged` at **5 000 entries each** (LRU by
`updatedAt`/`lastExchangedAt`). `edges` is bounded by distinct peers (≈ roster size). `retracted`
tombstones are tiny and **never evicted** (a resurrected match is worse than an unbounded-but-small
set; cap 20 000, then LRU). On overflow, evict oldest; a re-exchange simply re-creates the entry
(correctness is monotone — losing a suppression entry costs one redundant send, not a bug). Eviction is
a pure function in `talk-ledger.ts` so it is unit-tested.

### Event types & ordering rules (one table for all four steps)

| Inbound signal | Carrier | Writes | Ordering rule (accept iff) |
|---|---|---|---|
| **TALK_ANSWERED (v1)** | `talk-response` frame | A.outcome, B.exchanged | no prior entry, or `version > prior.version`, or `version == prior.version && respondedAt > prior.respondedAt` (CIDv1 `responseId` dedups exact replay) |
| **TALK_ANSWERED supersession (step 9)** | `talk-response` frame, higher `version` | A.outcome (replace, keep prior in audit feed), re-run `checkIfMatch` | **last-writer-by-version**; stale/replay (`version ≤ prior`) **rejected** |
| **TALK_RETRACTED (step 10)** | new `talk-retracted` frame | D.retracted, clear A+B for that `talkId::authorId` | always accept; record `max(retractedAt)`; **retraction wins** all races |
| **edge send (step 8.3)** | local broadcast | C.edges | gate: cooldown elapsed AND under day/week quota |

**Global ordering invariant (the one rule):** *version-then-timestamp, and retraction beats both.*
- Two TALK_ANSWERED for the same `(responderId,talkId,authorId)`: higher `version` wins; tie → later
  `respondedAt`; tie → keep existing (idempotent).
- A TALK_ANSWERED with `respondedAt < retracted[talkId::authorId].retractedAt` is **discarded**
  (REQ-LEDGER-15: an in-flight change cannot resurrect a retracted match).
- A TALK_RETRACTED always supersedes any outcome regardless of timestamps (hard teardown).

These three comparisons live in `talk-ledger.ts` as `compareResponse(a,b)`,
`isStaleAgainstRetraction(answer, retraction)`, and `applyEvent(doc, event)` — **pure, no DOM, no Gun**,
so the entire ordering logic is unit-tested in `src/test/unit/` without browsers.

---

## 2. STEP 8 — sender-side state

### 8.1 Author per-talk response inbox

**Store:** section (A) `outcomes` of the unified doc — *not* a new store, and *promoted from*
`localTalkExchanges` rather than duplicating it. `localTalkExchanges` remains the **contacts/UI
projection** (step 5 reads it); `talkLedger.outcomes` is the **authoritative outcome state** for
suppression. Write both in `recordLocalTalkExchange` (already the single choke point — extend it to also
`applyEvent` into the ledger). Key: `${responderId}::${talkId}::${authorId}` (author-qualified per §0).
Outcome vocabulary maps the existing `'match'|'mismatch'|'ignore'` to spec §23.6
`'matched'|'ignored'|'no-reply'`: `match→matched`, `mismatch|ignore→ignored`, absence of any response →
synthesized `'no-reply'` lazily at read time (no row written until a response or an explicit
no-reply timeout; v1: treat "no row" as no-reply).

`version`/`respondedAt`/`responseId` come straight from the response payload (already plumbed, §0).

### 8.2 Sender-side broadcast suppression

At broadcast recipient selection (`app.ts` `broadcastTalk` handler L2990, and the per-talk
`mesh.broadcastTalk` call L1809), before adding a recipient for a given talk:

- Compute the talk's **identity granularity** per §11.1 (per-tag identityKey for tag talks; whole-talk
  identityKey otherwise).
- **Skip recipient `r` for identity `k`** iff `talkLedger.exchanged[`${r}::${k}`]` exists at the current
  `version` (REQ-LEDGER-16) **or** an outcome row exists for `(r, this talk's identity)`. This is
  per-identity, **not** per-`talkId`-blob — aligning with step 11 *now* so step 11 adds no rework.
- A multi-tag talk still delivers its *other*, not-yet-exchanged tags to `r` (spec §23.6).

The suppression predicate is the same function step 11 uses (`shouldSuppress(doc, peerId, identityKey,
currentVersion)`); step 8 ships it, step 11 only adds the per-tag fan-out caller. **This is the key
"align with step 11 now" decision.**

### 8.3 Client per-edge cooldown + quota (replaces server limiters)

Section (C) `edges`, keyed by **outbound peer** `peerId`. Each side enforces **its own outbound** edges
— there is no shared counter and no server. **Symmetry semantics:** the old server limiter touched
*both* endpoints of an edge on one send (symmetric "send OR receive" cooldown). Without a server we
cannot debit a peer's counter, so we **redefine the edge as the local user's outbound stance toward a
peer**: each user independently rate-limits how often *they* (re)broadcast to a given peer. This is
strictly safe — it can only *under*-send relative to the old symmetric rule, never over-send — and
matches the spirit (a pair cannot be spammed because both directions are independently throttled).
Document this as an intentional semantic narrowing.

**Constants (mirror server defaults exactly):**
- Cooldown: `SYMMETRIC_TALK_EDGE_COOLDOWN_MS` (default `0` ⇒ off in prod today; E2E `0`). Keep the
  same default so behavior is unchanged; expose as a client constant in `talk-ledger.ts`.
- Daily quota: `10` (`TALK_SEND_DAILY`); weekly: `50` (`TALK_SEND_WEEKLY`). UTC day boundary; UTC-Monday
  week bucket (port `getUtcDayStartMs`/`getUtcWeekStartMs` logic verbatim into the pure module).
- E2E in-memory parity: the server set both to `Number.MAX_SAFE_INTEGER` under `E2E_GUN_MEMORY_ONLY`.
  Client mirror: a `talkLedgerQuotaUnlimited` flag (set when the e2e flag is on) so high-fanout specs
  (find-similar 9/9) are not throttled.

Gate order at send: `applyEdgeGate(doc, peerId, now)` → `{ ok, rejectedBy }`; on `ok`, debit counters +
set `lastSendAt`. Pure fn → unit-tested; no Gun, no server `consumeEdgeQuotas` call remains.

### Step 8 "done"
Author outcomes + exchanged + edge counters persist in `talkLedger`; rebroadcast of a talk identity to a
recorded responder is suppressed; per-edge cooldown/quota enforced client-side; **no client code path
calls the server limiters or `talkResponsesMap`**. Scaffolding steps 9–11 need that step 8 MUST land:
the `version`/`respondedAt`/`identityKey`/`role` fields on every entry, and the `applyEvent` /
`shouldSuppress` / `compareResponse` pure fns (even if 9–11 are not yet wired). Then step 7 deletes the
server guards.

---

## 3. STEP 9 — versioning & change-of-mind (REQ-LEDGER-04)

### 9.1 Responder side: monotonic version + propagate to all original senders

On answer change, responder bumps `version = prior + 1` for `(talkId, responderId)`, computes a new
`responseId` (new CIDv1 — content changed), sets `respondedAt = now`, emits a new `TALK_ANSWERED` that
**supersedes** the prior (old kept in the `WebLedgerService` audit feed; new wins in `talkLedger`).

**The responder must reach *every* original sender of that identity, not just the latest.** This
requires the responder to track *who sent them each identity*. **Record:** reuse section (B) `exchanged`
with `role:'responder'` — every received `talk-announce`/`talk-body` for identity `k` from author `a`
writes/updates `exchanged[`${a}::${k}`]`. On change-of-mind, the responder enumerates all
`exchanged[*::k]` with `role:'responder'` (i.e. every author who sent `k`) and re-`sendTalkResponse` the
superseded payload to each. **This is step 11's exchanged set doing double duty** — step 8 already
populates it, so step 9 adds only the enumeration. Offline senders → encrypted TTL mailbox (step 6
path, `recipientUserId: authorId`), drained on their reconnect.

### 9.2 Sender ingest: last-writer-by-version

`handleMeshTalkResponse` (author side) is extended: before recording, `applyEvent(doc, TALK_ANSWERED)`:
- **Reject** if `version ≤ outcomes[key].version` (stale/replay) — return early, no UI churn.
- **Reject** if `respondedAt < retracted[talkId::authorId].retractedAt` (step 10 wins).
- Else replace `outcomes[key]`, re-run shared `checkIfMatch(talkData, decryptedAnswers)` (the single
  source of truth — never duplicated):
  - **ignore→match:** create conversation (existing `createConversation` path, deterministic id ⇒
    idempotent), `setMemberMatched`, emit `MATCH_CREATED`.
  - **match→ignore:** mark the existing conversation **ended** (see §4 status; reuse `'withdrawn'` or a
    new `'ended'`—**decision:** use `status:'ignored'` already in the enum to mean "match retracted by
    answer change", distinct from step-10 `'withdrawn'`; both render read-only).
- UI surfacing: notification + a durable status line carrying the **change timestamp**:
  *"Jerry changed their answer · `respondedAt` — now a match"* (mirror to `#status-bar-text` /
  conversation-list item so E2E asserts durably, per CLAUDE.md).

### Step 9 "done"
A higher-`version` answer reaches all original senders, flips the local outcome, and creates/ends the
conversation accordingly; stale/out-of-order (`version ≤ prior`) updates are rejected. Step 8 must have
shipped the `exchanged` `role` field and the `version` comparison fn so no record migration is needed.

---

## 4. STEP 10 — retraction (REQ-LEDGER-15, §20.7)

### 10.1 New frame kind `talk-retracted`

`P2PMeshMessageKind` has **no spare reserved retraction kind** (verified: `mesh-ping | mesh-pong |
talk-announce | talk-body-request | talk-body | talk-response | ack`). **Decision: add a new kind
`'talk-retracted'`** to the union + a `P2PMeshTalkRetractedPayload = { talkId, authorId, retractedAt:number }`.
Author-qualified (`talkId` + `authorId`) is mandatory — content-addressed `talkId` is shared across
authors, so a bare-`talkId` retraction would tear down *another* author's identical-content talk
(§0). The `ack` kind stays reserved (step 6/9 receipts).

**Routing:** retraction is a **gossip flood** (no `recipientUserId`) — every holder must learn it, and the
author does not track the full holder set. Reuse the step-1 flood path (`rememberAndFanout`, TTL 8,
seen-set dedup, signature verify). For **offline** holders, also write the ciphertext envelope to the
**mailbox** (step 6) keyed per known responder from section (A)/(B) (the author *does* know its
responders), so a peer offline at retraction time gets it on reconnect drain. Belt-and-suspenders:
flood reaches online holders the author never directly answered; mailbox guarantees the responders the
author has outcome rows for.

### 10.2 Author side (on delete / tag-uncheck)

Emit `TALK_RETRACTED` into `WebLedgerService` (audit) **and** broadcast the `talk-retracted` frame.
Locally `applyEvent`: write `retracted[talkId::authorId] = { retractedAt }`, **drop** the talk from the
broadcast set and clear its `outcomes`/`exchanged` entries (so it is never re-announced or re-evaluated;
TODO §10 bullet 5). Hook: extend the existing `withdrawTalk` UI event handler (`app.ts` L3152) — but
**retraction is a distinct action** from withdraw: `withdrawTalk` stays soft (TALK_WITHDRAWN); add a
`retractTalk` event for delete/uncheck. (Do not overload withdraw — spec §20.7 keeps them distinct.)

### 10.3 Responder side (Jerry & Bob)

On ingest of `talk-retracted` for `talkId::authorId`:
1. Write `retracted[talkId::authorId]` locally (the **dead-inbox tombstone**).
2. **Notice with timestamp:** *"Tom removed this talk — the match is gone · `retractedAt`"* (durable
   surface).
3. Conversation teardown: set `status:'withdrawn'` on the conversation derived from `talkId`,
   **read-only both sides**, keep the immutable match record flagged retracted. → **requires adding
   `'withdrawn'` to the `Conversation.status` union** (`src/shared/types.ts` L295 is
   `'active'|'matched'|'ignored'|'expired'`; add `'withdrawn'`). The author side ends its mirror copy
   the same way when it retracts.
4. **Suppress future TALK_ANSWERED for that `talkId`:** the change-of-mind sender (step 9.1) checks
   `retracted[talkId::authorId]` before enumerating senders and **skips the retracted author** (dead
   inbox). So Jerry/Bob never re-bother Tom.

### 10.4 Last-writer ordering
`retractedAt` is authoritative: an inbound `TALK_ANSWERED` with `respondedAt < retractedAt` is discarded
(retraction wins); a retraction always overrides an outcome regardless of version. Encoded in
`isStaleAgainstRetraction` (§1).

### Step 10 "done"
Both responders get the timestamped "match gone" notice, the conversation moves to `'withdrawn'`
read-only on both sides, the author drops the talk from broadcast + outcome records, and a subsequent
answer change is **not** delivered to the retracting author. Step 8 must have keyed `retracted` and
outcomes by `talkId::authorId` so retraction is author-scoped without migration.

---

## 5. STEP 11 — mutual exchange suppression (REQ-LEDGER-16)

### 11.1 Identity granularity (the one new derivation)

`buildTalkIdentityKey` hashes the **whole talk**. REQ-LEDGER-16 requires **per-tag** identity (Tom's
`tennis` ≠ Tom's `chess` even in one talk). **Decision:** add `buildTagIdentityKeys(talk)` in
`talk-content-id.ts`/`cid.ts` returning, for a **tag** talk, one `identityKey` per tag (hash the single
tag's normalized text+options); for flow/route/survey, the single whole-talk `identityKey` (these have
no independent atoms). This is the **only new content-id work** and is shared/unit-testable. All step
8/11 suppression keys on these per-identity keys.

### 11.2 Exchanged set (already section B)

Written on **both** sides of an exchange (step 8 already does this co-write): author writes `exchanged`
on receiving a response; responder writes `exchanged` on sending one. `{ outcome, version,
lastExchangedAt, role }`. After Tom→Jerry(`tennis`)+answer, both hold `tennis` as exchanged with the
other.

### 11.3 Broadcast-time per-identity exclusion

Same `shouldSuppress` predicate from step 8.2, now called **per tag**: when Jerry broadcasts a talk
containing `tennis`+`chess` to Tom, exclude `tennis` (in `exchanged[Tom::tennis]` at current version),
deliver `chess`. Implemented by splitting the announce recipient set per `identityKey` derived in 11.1.

### 11.4 Re-open / clear
- **Content change** ⇒ new `identityKey` ⇒ no exchanged entry ⇒ delivered once (then re-recorded).
- **Stance change** ⇒ routed as the step-9 `TALK_ANSWERED` delta to original senders, **not** a fresh
  broadcast (so the version on `exchanged` bumps; suppression at the *new* version still holds).
- **TALK_RETRACTED** ⇒ `applyEvent` clears `exchanged[*::k]` for that identity (step 10 co-clears).

### Step 11 "done"
Tom receives `chess` only (never a second `tennis`); after Jerry edits the tag options (new identity),
`tennis'` is delivered to Tom exactly once. **No new store** — it reuses section B and the step-8
predicate; only `buildTagIdentityKeys` + per-tag fan-out are new.

---

## 6. Frame & file plan

**`src/shared/p2p-mesh-protocol.ts`:** add `'talk-retracted'` to `P2PMeshMessageKind`;
add `P2PMeshTalkRetractedPayload` + type guard; include it in `P2PMeshFramePayload`. `talk-response`
already carries versioned updates (no change). The signing payload (`p2pMeshFrameSigningPayload`)
already covers all fields generically.

**`src/shared/talk-ledger.ts` (NEW — the heart):** `TalkLedgerDoc` + entry types; pure fns
`applyEvent`, `compareResponse`, `isStaleAgainstRetraction`, `shouldSuppress`, `applyEdgeGate`,
`evictLedger`, UTC bucket helpers. **No DOM, no Gun** → fully unit-tested in `src/test/unit/`.

**`src/shared/cid.ts`:** add `buildTagIdentityKeys(talk): string[]` (11.1).

**`src/web/services/web-talk-ledger-store.ts` (NEW, thin):** localStorage read/write wrapper around
`TalkLedgerDoc` (load/save/transaction); delegates all logic to `talk-ledger.ts`.

**`src/web/app/app.ts` wiring points:**
- `recordLocalTalkExchange` (L1504): also `applyEvent` author outcome + co-write exchanged.
- `handleMeshTalkResponse` (L1107): version-gate ingest, re-run `checkIfMatch`, create/end conversation
  (steps 9, 10.4).
- `submitTalkResponsePairDirect` (~L2075): bump `version`, enumerate original senders on change (9.1),
  skip retracted authors (10.3.4).
- `broadcastTalk` handlers (L1809, L2990): per-identity recipient exclusion (8.2 / 11.3) + edge gate (8.3).
- New `retractTalk` UI event handler beside `withdrawTalk` (L3152): emit TALK_RETRACTED + flood frame +
  mailbox fanout + local teardown (10.2).
- New `onTalkRetracted` handler (responder side): notice, conversation→`'withdrawn'`, tombstone (10.3).

**`src/web/services/peer-mesh-service.ts` additions:** `sendTalkRetraction(payload)` (flood, mirrors
`sendPing` shape, no `recipientUserId`); `onTalkRetracted?` option fired from `handleLocalFrame` for
`kind==='talk-retracted'` after signature verify + seen-set dedup.

**`src/shared/types.ts`:** `Conversation.status` += `'withdrawn'` (L295).

**`WebLedgerService`:** add `TALK_RETRACTED` to `InteractionKind` (audit-feed parity with spec §20.7) +
its index `ledger/<userId>/index/retracted/<talkId>` (spec L445).

---

## 7. E2E test plan (maps every TODO `Test:` checkbox)

Specs under `tests/e2e/talks-matching/`, three browsers each (Tom, Jerry, Bob via
`launchThreeBrowsers`), durable assertions (`#status-bar-text`, `.conversation-list-item`,
`waitForTabActive`), debt allowances (`talks/*` ≤1 creation node, `/api/stats/*` tolerated), ASI-safe
`collect(root.map().once)` pattern for Gun-empty assertions.

| Spec file | TODO checkbox | Asserts |
|---|---|---|
| `06-sender-suppression.spec.ts` | §8 Test | Jerry ignores Tom's `tennis`; Tom rebroadcasts → Jerry's incoming cluster count does **not** grow; Jerry never re-prompted (prior ignore auto-applied). Assert `talkLedger.outcomes` row + no second announce. |
| `07-change-of-mind.spec.ts` | §9 Test (both) | (ignore→match) Jerry switches to match; Tom **and** a second sender Bob (same `tennis` identity) get the newer-timestamp update → Tom↔Jerry `.conversation-list-item` appears. (match→ignore) reverse propagates; an older-`version` replay is rejected (no state change). |
| `08-retraction.spec.ts` | §10 Test | Jerry matched + Bob ignored Tom's `tennis`; Tom unchecks → both show timestamped "match gone"; Tom↔Jerry conversation `status:'withdrawn'` read-only both sides; a subsequent Jerry/Bob answer change is **not** delivered to Tom (dead inbox). |
| `09-exchange-suppression.spec.ts` | §11 Test | Tom→Jerry(`tennis`), Jerry answers; Jerry broadcasts `tennis`+`chess` → Tom receives `chess` only, never a 2nd `tennis`; Jerry edits tag options (new identity) → `tennis'` delivered to Tom once. |

Each spec also re-asserts the step-4 invariants (no `POST /api/talks/:id/response`, no per-pair Gun
subscription) so the deleted server guards (step 7) cannot regress. `08`/`09` gate on
`connectedNeighborCount === neighbors.size` before broadcast to keep mesh delivery deterministic.

---

## 8. Implementation order (for Sonnet) & migration flags

1. **Step 8** — `talk-ledger.ts` (pure) + store wrapper + `recordLocalTalkExchange`/broadcast wiring +
   edge gate. **Land all forward-compat fields and pure fns now** (`version`, `respondedAt`,
   `identityKey`, `role`, `applyEvent`, `shouldSuppress`, `compareResponse`, `isStaleAgainstRetraction`),
   even though 9–11 don't call them yet — this is the "no migration" guarantee.
2. **Step 7** (separate Sonnet/Haiku task) — delete `talkResponsesMap`, both limiter services, their
   config reads + `resetForTesting`. Safe only after step 8 lands.
3. **Step 9** — activate version-gate ingest + change-of-mind fan-out (uses step-8 `exchanged` + pure fns).
4. **Step 10** — `talk-retracted` frame + flood/mailbox + teardown + `Conversation.status:'withdrawn'`.
5. **Step 11** — `buildTagIdentityKeys` + per-tag fan-out (uses step-8 `shouldSuppress`).

**Things step 8 MUST scaffold to avoid later migration:** entry keys author-qualified
(`talkId::authorId`) and identity-qualified (`identityKey` on every outcome); `role` on exchanged
entries; the `retracted` section keyed `talkId::authorId`; the four pure ordering fns. None of these can
be retrofitted without rewriting stored docs.

---

## 9. Risks & open questions (≤6, each with a default)

- **R-a: Per-tag identity vs whole-talk `identityKey`.** Existing keying is whole-talk; REQ-LEDGER-16
  needs per-tag. *Default:* add `buildTagIdentityKeys` (11.1) — per-tag for tag talks only, whole-talk
  otherwise; flow/route have no independent atoms.
- **R-b: Symmetric edge limiter has no server to debit the peer.** *Default:* redefine as **local
  outbound** throttle (§8.3) — strictly under-sends vs the old symmetric rule, never over-sends. Keep
  default cooldown `0` (prod parity).
- **R-c: Two stores (`localTalkExchanges` for UI, `talkLedger` for state) could drift.** *Default:*
  write both inside the single `recordLocalTalkExchange` choke point; `localTalkExchanges` is a pure
  projection of `talkLedger.outcomes` (could be derived later, but co-writing now is lower-risk).
- **R-d: Retraction flood may miss a holder behind a partitioned overlay.** *Default:* flood **plus**
  mailbox fanout to known responders (author has outcome rows) — guarantees the responders that matter;
  unknown lurkers who never answered are not match-relevant.
- **R-e: `match→ignore` end-status overlaps step-10 `'withdrawn'`.** *Default:* use existing
  `status:'ignored'` for change-of-mind teardown, `'withdrawn'` for hard retraction — both read-only,
  distinct provenance for the UI.
- **R-f: localStorage size under 5k+5k entries.** *Default:* LRU eviction in `talk-ledger.ts` (pure,
  tested); losing an entry costs one redundant send, never a correctness bug, so aggressive eviction is
  safe. Revisit local-Gun-user-space backing only if quota pressure appears in scale tests.
