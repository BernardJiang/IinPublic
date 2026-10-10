# Test: Merkle-Checkpoint Pruning End to End (Ledger + Messages)

covers: docs/design/section-s-merkle-checkpoint-pruning-design-note.md (TODO.md §S, Item 7)

**File:** 30-ledger-message-pruning-e2e.spec.ts
**Features tested:** Local encrypted interaction-ledger checkpoint creation + pruning, a lagging peer catching up through direct DataChannel delta-sync after a prune, local message checkpoint creation, hub non-retention, and message history still rendering after heavy activity.

---

## What this test does (in plain English):

1. **Setup:** Two browsers — Tom and Jerry — match on a talk exactly like 09-messaging.spec.ts, then establish a direct-p2p conversation.

2. **Ledger flood:** Tom's ledger is driven past `LEDGER_CHECKPOINT_INTERVAL`/`LEDGER_RETENTION_WINDOW` via a direct service call (`appendLedgerEventsForE2e`, an E2E-only hook on `IinPublicApp`) so a real checkpoint-then-prune cycle fires. The spec runs these constants at a small, env-overridden scale (`IINPUBLIC_E2E_LEDGER_CHECKPOINT_INTERVAL=5`, `IINPUBLIC_E2E_LEDGER_RETENTION_WINDOW=25` — see the env vars section below) rather than the real production values (100/500): each real Gun round trip in this environment takes seconds, not milliseconds, so driving 600+ of them sequentially in one browser session would make the spec impractically slow. Unset, the constants fall back to the real production defaults.

3. **Assert the prune actually happened:** Tom's very first ledger event (seq 1) is confirmed gone from local encrypted Gun (`isLedgerRawEventPresentForE2e`), and the newest checkpoint is independently re-verified via the service's own `verifyEvent`.

4. **Lagging-peer delta-sync:** Tom sends a sync request over the existing matched-conversation DataChannel. Jerry returns its current ledger state; Tom replies with checkpoint substitutions plus the retained signed tail in bounded `ledger-events` frames. Jerry persists and verifies them before later frames are handled. No Gun inbox or third device participates.

5. **Message flood:** Messages are sent from Tom to Jerry via another direct-call hook (`sendConversationMessagesForE2e`), crossing the (also env-overridden) `MESSAGE_CHECKPOINT_INTERVAL`/`MESSAGE_RETENTION_WINDOW`.

6. **Assert message checkpoint, pruning, and rendering:** Tom's private envelope confirms a checkpoint, a pruned prefix, and an encrypted retained tail. The hub snapshot contains no pair-message or ledger bodies. The live UI still renders the newest message.

> **Why this matters:** Unit tests prove the local repository and ledger policy in isolation; this browser scenario proves the complete boundary: encrypted endpoint persistence, direct signed synchronization, checkpoint substitution after pruning, and absence of message/ledger bodies on the relay. It also guards the direction of an explicit re-sync: the requester asks for the peer's state, then returns the delta the peer is missing.

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
