# Test: Friend-Circle Block Signal — Threshold-Gated Warning

covers: SPEC-3.8 <!-- shares the block-relationship area with 21a; refine by hand -->

**Features tested:** Opt-in friend-circle block signal fan-out and threshold-gated aggregation (src/shared/block-signal.ts)

---

## What this test does (in plain English):

1. **Alice and Victor are bootstrapped** and both enter the Global chatroom (establishes presence for epub resolution).
2. **Alice adds Victor as a known contact.**
3. **Alice blocks a synthetic target identity** and fans out a real, SEA-encrypted block signal to her contacts (Victor).
4. **Victor's mailbox poll drains and decrypts** the signal, recording it against the target identity — proven by polling his local `receivedBlockSignals` tally, which reaches `1`.
5. **Two more signals are seeded directly** on Victor's own device (the same on-device store the real receive path writes to), bringing the tally to `3` — the configured threshold.
6. **Victor's browser is reloaded**, and the tally is confirmed to still read `3` — proving it persisted via the same SEA-private round trip as `knownPeople`/`blockedUserIds`, not just an in-memory value.
7. **"Block is a status" phase**: Alice shares a *different* block scoped to the `coworker` group, while Victor is still only labeled `friend`. He does not qualify yet, so the immediate fan-out reaches nobody, and his tally for this second target confirms `0`.
8. **Alice relabels Victor to include `coworker`** through the real UI event path (`saveKnownPerson` → `addKnownPerson` → `resendSharedBlockSignalsToNewContact`) — the exact "a contact is later invited into a group I already shared a block with" case.
9. **Victor's mailbox poll picks up the retroactive signal**, confirmed by his tally for the coworker-scoped target reaching `1` — proving a share persists as a status and reaches a contact who qualifies *after* the original share, not just the ones who qualified at that moment.

## Verifications:

- ✅ A real block + opt-in fan-out encrypts and posts a mailbox envelope using the blocker's actual keypair.
- ✅ The recipient's mailbox drain loop decrypts it with their own keypair and records exactly one signal.
- ✅ The tally is per-target-identity and accumulates correctly toward the threshold.
- ✅ The tally survives a browser restart (SEA-private persistence, not just in-memory state).
- ✅ A contact who does not yet qualify for a shared group scope receives nothing at share time.
- ✅ Relabeling that contact into the matching group, through the real save-contact event path, retroactively delivers the share — the "status, not a one-time notification" contract.

## Scope note

This test proves the real cross-browser send/receive/decrypt round trip for one signal (the
part unit tests structurally cannot cover) and the persistence contract. It does not spin up
three additional browser contexts to produce three independent real signals — the
aggregation/threshold math itself (dedup, per-target independence, the exact threshold
boundary) is exhaustively covered by `src/test/unit/block-signal.test.ts`, so a second and
third real send/receive round trip would add browser-orchestration cost without adding
coverage. It also does not open a peer-detail view to check the rendered `⚠` warning text —
that would require the synthetic target identity to be a real logged-in user with a public
profile to open a detail view against; the DOM rendering itself (`contactBlockWarningHtml` in
`user-detail-view.ts`) is a straightforward template read of the same `receivedBlockSignals`
data this test already verifies end-to-end.
