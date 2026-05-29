# IinPublic TODO

Last updated: 2026-05-28

This file is the short, execution-oriented plan.
- Completed work: `docs/completed.md`
- Detailed backlog inventory: `docs/TODO-backlog-inventory.md`
- Product scope: `docs/specs/iinpublic-technical-specification.md`
- P2P roadmap: `docs/roadmap/p2p-node-network.md`

## Current Focus

All planned phases (D-series through Phase G) are complete. No outstanding action items.

## Next Action Items (Ordered)

_None — all backlog items shipped. See `docs/completed.md` for evidence._

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
- **Shipped:** CIDv1 utility (`src/shared/cid.ts`), `InteractionEvent` type + `InteractionKind` enum, `WebLedgerService` (append/verify/indexes/delta-sync), CIDv1 questionId per question, per-question chatbot cache (`byQuestion/<cidKey>`), ledger event hooks wired into all interaction flows.
- **Remaining:** none — Phase E closed.

## Phase F — Delta Sync and Talk Versioning
- **Shipped:** LEDGER_STATE handshake + O(Δ) delta sync, TALK_SUPERSEDED + TALK_WITHDRAWN events and grace window, chatbot differential answering UI (REQ-CHATBOT-01–04).
- **Remaining:** none — Phase F closed.

## Phase G — Ledger as Sole Source of Truth
- **Shipped:** CIDv1 for all entity IDs (talk-content-id.ts retired), legacy Gun dual-writes removed (isAnswered tracked in-memory), conversation sub-DAG with `prevSeen` field (REQ-LEDGER-08).
- **Remaining:** none — Phase G closed.

## Working Rule

- Move completed TODO items to `docs/completed.md`.
- Keep this file short and action-oriented.
- Keep long-form acceptance inventory in `docs/TODO-backlog-inventory.md`.
