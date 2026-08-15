# Test: Merkle-Checkpoint Pruning End to End (Ledger + Messages)

covers: docs/design/section-s-merkle-checkpoint-pruning-design-note.md (TODO.md §S, Item 7)

**File:** 30-ledger-message-pruning-e2e.spec.ts
**Features tested:** Interaction-ledger checkpoint creation + pruning, a lagging peer catching up via delta-sync after a prune, message checkpoint creation, message history still rendering after heavy send/checkpoint activity — all against real browsers and a real Gun server, not unit-level fakes.

---

## What this test does (in plain English):

1. **Setup:** Two browsers — Tom and Jerry — match on a talk exactly like 09-messaging.spec.ts, then establish a direct-p2p conversation.

2. **Ledger flood:** Tom's ledger is driven past `LEDGER_CHECKPOINT_INTERVAL`/`LEDGER_RETENTION_WINDOW` via a direct service call (`appendLedgerEventsForE2e`, an E2E-only hook on `IinPublicApp`) so a real checkpoint-then-prune cycle fires. The spec runs these constants at a small, env-overridden scale (`IINPUBLIC_E2E_LEDGER_CHECKPOINT_INTERVAL=5`, `IINPUBLIC_E2E_LEDGER_RETENTION_WINDOW=25` — see the env vars section below) rather than the real production values (100/500): each real Gun round trip in this environment takes seconds, not milliseconds, so driving 600+ of them sequentially in one browser session would make the spec impractically slow. Unset, the constants fall back to the real production defaults.

3. **Assert the prune actually happened:** Tom's very first ledger event (seq 1) is confirmed gone from Gun (`isLedgerRawEventPresentForE2e`), and the most recent fully-written checkpoint is read back and independently re-verified via the service's own `verifyEvent` (not a re-implementation).

4. **Lagging-peer delta-sync:** Jerry never received Tom's flood of ledger events (nothing proactively re-syncs between two already-connected peers absent a reconnect). Tom then actively pushes a delta-sync to Jerry (`pushLedgerSyncToPeerForE2e`), and the test polls Jerry's own ledger state until it reaches Tom's real head — proving Jerry received either raw events (for the retained tail) or the substituted checkpoint (for the pruned range) and correctly advanced, rather than the pruned range being silently dropped (the regression Item 3 was built to prevent). Jerry's own already-running inbox subscription (established once at app boot, never torn down) picks this up live — no page reload needed.

5. **Message flood:** Messages are sent from Tom to Jerry via another direct-call hook (`sendConversationMessagesForE2e`), crossing the (also env-overridden) `MESSAGE_CHECKPOINT_INTERVAL`/`MESSAGE_RETENTION_WINDOW`.

6. **Assert message checkpoint, pruning, and rendering:** A full Gun graph snapshot (`/api/test/export-snapshot`) confirms a checkpoint node exists, the oldest fill message is gone, and the latest fill message still holds real ciphertext. The live conversation UI on Tom's page is checked to confirm the most recent message still renders.

> **Why this matters:** Items 1-4 of the merkle-checkpoint pruning design were unit-tested against fakes (in-memory Gun for the ledger, a hand-written fake Gun-chain for messages — a real bare in-memory `Gun()` instance was found unreliable for fresh nested `.get()` chains under Jest, a limitation of that test config, not production code). This spec is the first time the actual checkpoint/prune/delta-sync code runs against a real Gun server and real browsers end to end — and it found four real, previously-invisible bugs in the process (all fixed; see the design note's own Item 7 "Done" note for the full list): the ledger was completely inert in every E2E run since Phase E (a `DISABLE_HMR` gate), ledger event deletion never actually deleted anything (two separate causes), `getEventBySeq` silently broke every CID/signature verification it ever did (a date-coercion quirk), and the ledger's delta-sync inbox was permanently undiscoverable by any receiving peer (a flat-key-vs-nested-chain graph mismatch).

## 2026-08-14 reliability fix; browser verification pending

The message implementation now serializes and coalesces checkpoint passes, waits for Gun mutation acknowledgements before advancing durable counters, and treats checkpoint/prune counts as absolute even after old wires disappear from the local list. A rapid-backlog unit regression proves continued checkpointing and multiple prune boundaries. The durable oldest-message assertion above has been restored. The combined browser scenario still needs a green run: on 2026-08-14 it stopped first at its ledger sequence-1 deletion assertion, before reaching the message section.

---

**Env vars this spec sets when run:** `IINPUBLIC_E2E_ENABLE_LEDGER=1` (the ledger is otherwise inert under `DISABLE_HMR=true`, which every standard `test:e2e` script sets), `IINPUBLIC_E2E_LEDGER_CHECKPOINT_INTERVAL=5`, `IINPUBLIC_E2E_LEDGER_RETENTION_WINDOW=25`, `IINPUBLIC_E2E_MESSAGE_CHECKPOINT_INTERVAL=5`, `IINPUBLIC_E2E_MESSAGE_RETENTION_WINDOW=10`. Example:
```
IINPUBLIC_E2E_ENABLE_LEDGER=1 \
IINPUBLIC_E2E_LEDGER_CHECKPOINT_INTERVAL=5 \
IINPUBLIC_E2E_LEDGER_RETENTION_WINDOW=25 \
IINPUBLIC_E2E_MESSAGE_CHECKPOINT_INTERVAL=5 \
IINPUBLIC_E2E_MESSAGE_RETENTION_WINDOW=10 \
npx playwright test tests/e2e/staged/stage2-two-user/30-ledger-message-pruning-e2e.spec.ts
```

**Helpers used:** `clearGunForStage2Spec`, `injectIdbClear`, `afterLoad`, `afterSync`, `afterNav`, `afterAction`, `openIncomingTalkModal`, `waitForResponseModalClosed`, `clickBroadcastUntilBulkAck`, `waitForBroadcastableTalkIds`, `waitForDistinctGunPeersExcludingSelf`, `prepareDirectP2PConversation`. New E2E-only hooks on `IinPublicApp` (app.ts): `appendLedgerEventsForE2e`, `getLedgerStateForE2e`, `isLedgerRawEventPresentForE2e`, `getLedgerCheckpointVerifiedForE2e`, `pushLedgerSyncToPeerForE2e`, `sendConversationMessagesForE2e`.
