# IinPublic TODO

Last updated: 2026-05-28

This file is the short, execution-oriented plan.
- Completed work: `docs/completed.md`
- Detailed backlog inventory: `docs/TODO-backlog-inventory.md`
- Product scope: `docs/specs/iinpublic-technical-specification.md`
- P2P roadmap: `docs/roadmap/p2p-node-network.md`

## Current Focus

D-series app-detail phases (D2–D6) are complete. Current focus is Phase E: Interaction Ledger Bootstrap.

## Next Action Items (Ordered)


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
- **Shipped:** 10x10 browser matrix (`00v`), group-by (responder/talk/day) spec (`00ad`), date-range filter, sort-by-talk-replies, sort persistence — all in `test:e2e:phase-d5`.
- **Remaining:** none — D5 closed.

### Phase D6 - Tab-by-Tab Completion Sweep
- **Shipped:** tab-sweep + nav/settings/localization bundle; contacts stranger-default and save-relationship spec (`00ae`) — all in `test:e2e:phase-d6`.
- **Remaining:** none — D6 closed.

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

## Phase F — Delta Sync and Talk Versioning

> Requires Phase E complete.
> Spec: §3.11 REQ-LEDGER-06, §3.4 REQ-CHATBOT-01–04, §20.4–20.7.

## Phase G — Ledger as Sole Source of Truth

> Requires Phase F complete and all clients updated.
> Spec: §3.3 Phase G, §6.6, §14 Phase 4.

17. **Conversation sub-DAG** (`src/web/services/WebConversationService.ts`)
    - Add `prevSeen` field to `ConversationMessage`: the `messageId` of the last message the sender has observed from the other party.
    - Two-writer DAG structure enables causal ordering and offline merge without a central sequencer (REQ-LEDGER-08).

## Working Rule

- Move completed TODO items to `docs/completed.md`.
- Keep this file short and action-oriented.
- Keep long-form acceptance inventory in `docs/TODO-backlog-inventory.md`.
