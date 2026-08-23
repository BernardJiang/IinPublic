# stage2/74 — Device handoff transfer (§J)

covers: docs/TODO.md item J, spec §11.2/§11.3

Two isolated browser installations first establish a real mutual `LINK_IDENTITY` link,
exactly like `stage2-two-user/73-identity-link-mutual.spec.ts`. Device A then seeds one
verifiable piece of local data and drives the real Sync-before-erase flow: build the
handoff archive, encrypt it to device B's published epub, publish the signed envelope on
the shared graph, and start waiting for B's signed acknowledgement.

Device B independently opens its own Identity & devices page, discovers the archive
addressed to its own pub (never a general "who sent me something" scan — only ever
checked against pubs it already knows it is linked to), decrypts and verifies it, and
explicitly presses Import. Only that explicit action merges anything into B's local
data and publishes the signed ack A is waiting on.

Back on device A, the Sync-progress dialog observes B's ack and enables Done — proving
spec §11.3's safety invariant end to end with a real second device, not just the
`stage2-two-user/72-sync-before-erase.spec.ts` negative-path proof (an unreachable fake
device, where the send correctly fails and Done correctly never enables).

## What this test does (in plain English)

1. Two browsers, A and B, each with their own SEA identity.
2. Complete the standard mutual identity-link flow (code, approve, both rows show
   "Linked").
3. A seeds `localStorage.myTalks` with one marker talk — the same key the handoff
   archive builder reads from.
4. A opens Erase this device → "Save to ⟨device⟩ first" → the Sync-progress dialog
   shows all 6 categories collected (the real encrypted send has already happened by
   this point).
5. B opens Identity & devices and sees a "Data available to import" card, clicks
   Import.
6. Assert B's own `localStorage.myTalks` now contains the marker talk A seeded —
   proving real data crossed the wire, not just the mechanism firing.
7. Back on A, assert Done becomes enabled (B's ack observed) and that Erase itself
   stays gated by the type-`ERASE` confirmation, same as every other erase flow.
