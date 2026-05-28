# IinPublic TODO

Last updated: 2026-05-27

This file is the short, execution-oriented plan.
- Completed work: `docs/completed.md`
- Detailed backlog inventory: `docs/TODO-backlog-inventory.md`
- Product scope: `docs/specs/iinpublic-technical-specification.md`
- P2P roadmap: `docs/roadmap/p2p-node-network.md`

## Current Focus

No active P2P phase is pending in this TODO. Current focus is app-detail completion (D2-D6).

## Next Action Items (Ordered)

1. **D4 remaining lifecycle matrix**
   - Add survey/route lifecycle specs (branch outcomes + context-path ownership in Me).
   - Add intake-filtered peer case in multi-responder matrix.
   - Add creator edit/state-preservation checks (OUT/IN/Contacts/Me consistency).
2. **D2 localization hardening**
   - Audit edge notifications, modals, and support-only flows for unexpected English fallback.
3. **D3 filter diagnostics hardening**
   - Improve language-aware grammar/dirty-word policy.
   - Expose `intake_dirty_words` in filtered-count diagnostics.
   - Stabilize distance preamble copy when receiver location is not yet synced.
4. **D5/D6 completion follow-through**
   - Extend ranking/triage behavior to remaining tab-specific acceptance items.
   - Close remaining cross-tab consistency checks listed in the backlog inventory.

## Phase Status Snapshot

### Phase D2 - Full UI Localization
- **Shipped:** Chinese traversal and navigation/settings durability proofs (`test:e2e:phase-d2`).
- **Remaining:** edge-surface fallback audit and language-specific grammar/dirty-word behavior.

### Phase D3 - Incoming Talk Filters and Talk Behavior
- **Shipped:** multi-user intake filter suite and talk behavior proofs (`00m`-`00p`, `00t`).
- **Remaining:** richer dirty-word/grammar policy, visible dirty-word diagnostics, distance preamble timing polish.

### Phase D4 - Exhaustive Talk Lifecycle and Matching Matrix
- **Shipped (partial):** `00u`, `00w`, `00z`, `talk-lifecycle-e2e.ts` (`test:e2e:phase-d4`).
- **Remaining:** survey/route branches, intake-filtered responder in matrix, full creator-edit lifecycle checks.

### Phase D5 - High-Volume Reply Triage and Ranking
- **Shipped (partial):** 10x10 browser matrix + scripts (`test:e2e:phase-d5`).
- **Remaining:** full ranking/filter parity and acceptance closure across Talks/Contacts/Me.

### Phase D6 - Tab-by-Tab Completion Sweep
- **Shipped (partial):** tab-sweep + nav/settings/localization bundle (`test:e2e:phase-d6`).
- **Remaining:** unresolved per-tab acceptance items in the backlog inventory.

## Working Rule

- Move completed TODO items to `docs/completed.md`.
- Keep this file short and action-oriented.
- Keep long-form acceptance inventory in `docs/TODO-backlog-inventory.md`.
