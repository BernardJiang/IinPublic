# IinPublic TODO

Last updated: 2026-05-28

This file is the short, execution-oriented plan.
- Completed work: `docs/completed.md`
- Detailed backlog inventory: `docs/TODO-backlog-inventory.md`
- Product scope: `docs/specs/iinpublic-technical-specification.md`
- P2P roadmap: `docs/roadmap/p2p-node-network.md`

## Current Focus

No active P2P phase is pending in this TODO. Current focus is app-detail completion (D2-D6).

## Next Action Items (Ordered)

1. **D5/D6 completion follow-through**
   - Extend ranking/triage behavior to remaining tab-specific acceptance items.
   - Close remaining cross-tab consistency checks listed in the backlog inventory.

## Phase Status Snapshot

### Phase D2 - Full UI Localization
- **Shipped:** Chinese traversal + navigation/settings durability (`test:e2e:phase-d2`); status-bar user/match count localized; broadcast modal and chatroom create modal edge spec (`00z`).
- **Remaining:** none — D2 closed.

### Phase D3 - Incoming Talk Filters and Talk Behavior
- **Shipped:** multi-user intake filter suite, talk behavior proofs (`00m`-`00p`, `00t`), CJK grammar bypass, broadcast preamble localization, location-pending warning, dirty-word CJK detection.
- **Remaining:** none — D3 closed.

### Phase D4 - Exhaustive Talk Lifecycle and Matching Matrix
- **Shipped:** `00u`, `00w`, `00z`, `00aa`, `00ab`, `00ac`, `talk-lifecycle-e2e.ts` (`test:e2e:phase-d4`).
- **Remaining:** creator edit/state-preservation checks (OUT/IN/Contacts/Me consistency after edit+rebroadcast).

### Phase D5 - High-Volume Reply Triage and Ranking
- **Shipped (partial):** 10x10 browser matrix + scripts (`test:e2e:phase-d5`).
- **Remaining:** full ranking/filter parity and acceptance closure across Talks/Contacts/Me.

### Phase D6 - Tab-by-Tab Completion Sweep
- **Shipped (partial):** tab-sweep + nav/settings/localization bundle (`test:e2e:phase-d6`).
- **Remaining:** unresolved per-tab acceptance items in the backlog inventory.

## Phase E — Interaction Ledger Bootstrap

> Prerequisite for Phases F and G. Can proceed in parallel with D-series app-detail work.
> Spec: §3.11 REQ-LEDGER-01–14, §14 Phase 4, §20 Interaction Ledger deep-dive.

5. **Canonical serialization utility** (`src/shared/cid.ts`)
   - Implement `canonicalSerialize(obj)`: deterministic key-sorted JSON, no undefined/null fields.
   - Implement `computeCIDv1(obj)`: dag-json codec, sha2-256, via `multiformats` npm package.
   - Unit-test: same object always produces the same CID; field order in source doesn't matter.

6. **`InteractionEvent` type** (`src/shared/types.ts`)
   - Add `InteractionKind` enum: `TALK_CREATED | TALK_BROADCAST | TALK_RECEIVED | TALK_ANSWERED | TALK_SUPERSEDED | TALK_WITHDRAWN | MATCH_CREATED | CONVERSATION_MSG`.
   - Add `InteractionEvent` interface: `id` (CIDv1), `seq`, `prev`, `kind`, `pubkey`, `timestamp`, `content`, `sig`.
   - Add `LedgerState` type (map of userId → highest seq) for delta-sync handshake.

7. **`LedgerService`** (`src/web/services/WebLedgerService.ts` + server mirror)
   - `appendEvent(kind, content)`: compute CIDv1 id, set prev, increment seq, SEA-sign, write to `ledger/<userId>/events/<seq>`.
   - `verifyEvent(event)`: verify CIDv1 id matches content, prev chain integrity, and SEA sig.
   - `getState()`: return map of `{ userId → seq }` for all feeds this peer holds.
   - Write ledger indexes: `index/talkId/<id>`, `index/responseId/<id>`, `index/withdrawn/<talkId>`.
   - Dual-write: continue writing to existing legacy Gun paths (REQ-LEDGER-10 migration compat).

8. **CIDv1 `questionId` per question** (`src/shared/types.ts`, `src/web/services/WebTalkService.ts`)
   - On talk creation/edit, compute `question.id = CIDv1({ text, type, options })` for each question.
   - Exclude routing fields (`next`, match-flag) from the hash so routing-only edits don't break cache.

9. **Per-question chatbot answer cache** (`src/web/services/WebTalkService.ts`, Gun path)
   - Switch chatbot cache writes from `talkAnswerTemplateByUser/<userId>/<talkIdentityKey>` to `talkAnswerTemplateByUser/<userId>/byQuestion/<questionId>`.
   - On every talk submission, write `answerCache[q.id] = answer` for all answered questions (REQ-CHATBOT-05 cache write-back).
   - Keep legacy path writes in parallel during Phase E for backward compatibility.

10. **Hook new events into existing flows**
    - Talk create → emit `TALK_CREATED`.
    - Talk broadcast → emit `TALK_BROADCAST`.
    - Talk received → emit `TALK_RECEIVED`.
    - Talk answered → emit `TALK_ANSWERED` with new `responseId = CIDv1({ talkId, responderId, responseContentJson })`.
    - Match created → emit `MATCH_CREATED`.
    - Conversation message sent → emit `CONVERSATION_MSG` with `messageId = CIDv1({ conversationId, senderPubkey, content, seq })`.
    - Exit criteria: existing E2E suite passes; ledger paths populated alongside legacy paths.

## Phase F — Delta Sync and Talk Versioning

> Requires Phase E complete.
> Spec: §3.11 REQ-LEDGER-06, §3.4 REQ-CHATBOT-01–04, §20.4–20.7.

11. **`LEDGER_STATE` handshake on peer connect**
    - On WebRTC peer connect, exchange `LEDGER_STATE` (map of userId → highest seq held).
    - Each peer sends the other only events with `seq` greater than what the other declared (O(Δ) transfer).
    - Peers without ledger support fall back silently to full Gun sync.

12. **`TALK_SUPERSEDED` event**
    - When a user edits and rebroadcasts a talk, emit `TALK_SUPERSEDED { oldTalkId, newTalkId }` into the ledger.
    - Receiver UI: group old and new talk versions in the inbox when TALK_SUPERSEDED is received.

13. **`TALK_WITHDRAWN` event + grace window**
    - Emit `TALK_WITHDRAWN { talkId }` when a user wants to stop delivery.
    - Peers receiving this event in a delta cease routing the talk to unseen recipients.
    - After configurable grace window (default 24h, `TALK_WITHDRAWN_GRACE_MS` env var), demote match notifications from active to archival (NFR-LEDGER-01).
    - Standard post-edit workflow: `TALK_CREATED(T2)` → `TALK_SUPERSEDED(T1→T2)` → `TALK_WITHDRAWN(T1)`.

14. **Chatbot differential answering UI** (`src/web/ui/talk-response-dialog.ts`)
    - On incoming talk, classify each question: look up `answerCache[q.id]` (by `questionId`).
    - Auto-filled questions: show answer grayed out, overridable. Needs-input questions: show active input.
    - If all questions auto-filled: show review screen before submit — no silent auto-submit (REQ-CHATBOT-02).
    - On TALK_SUPERSEDED: pre-seed cache for T2 from T1 answers before running differential (REQ-CHATBOT-03).
    - If T1 was previously auto-submitted without review: always force review step for T2 (REQ-CHATBOT-04).
    - Show contextual prompt copy: *"[Sender] updated this talk. Your previous answers are pre-filled — please review and answer any new questions."*

## Phase G — Ledger as Sole Source of Truth

> Requires Phase F complete and all clients updated.
> Spec: §3.3 Phase G, §6.6, §14 Phase 4.

15. **CIDv1 for all entity IDs** (`src/shared/talk-content-id.ts` → `src/shared/cid.ts`)
    - Replace `computeTalkIdFromTalkData` / `buildTalkIdentityKey` (local SHA-256) with `computeCIDv1`.
    - `talkId`, `responseId`, `messageId`, `questionId`, and event `id` all use CIDv1.
    - Deprecate and remove `src/shared/talk-content-id.ts`.
    - Update all call sites; run full E2E suite.

16. **Remove legacy Gun path dual-writes**
    - Stop writing to `incomingTalksByUser/<userId>/<identityKey>` (replaced by `ledger/.../index/talkId`).
    - Stop writing to `talkAnswerTemplateByUser/<userId>/<talkIdentityKey>` (replaced by `byQuestion/<questionId>`).
    - Server-side `incomingTalksMap` in-memory Map → replaced by ledger index reads on the peer mesh.
    - Verify no legacy path receives new writes; confirm existing E2E suite passes on ledger-only paths.

17. **Conversation sub-DAG** (`src/web/services/WebConversationService.ts`)
    - Add `prevSeen` field to `ConversationMessage`: the `messageId` of the last message the sender has observed from the other party.
    - Two-writer DAG structure enables causal ordering and offline merge without a central sequencer (REQ-LEDGER-08).

## Working Rule

- Move completed TODO items to `docs/completed.md`.
- Keep this file short and action-oriented.
- Keep long-form acceptance inventory in `docs/TODO-backlog-inventory.md`.
