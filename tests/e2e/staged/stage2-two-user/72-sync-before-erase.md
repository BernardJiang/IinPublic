# stage2/72 — Sync before erase

covers: SPEC-19.14  <!-- auto-seeded; refine by hand -->

Covers TODO item **J** (redesign §11.2).

With a linked personal device recorded, the Erase dialog offers "Save to ⟨device⟩
first" → the Sync-progress dialog builds the local archive and reports per-category
progress. The seeded linked device is a fake pub with no real identity behind it, so
the real encrypted send correctly fails (no epub to encrypt to) — this proves spec
§11.3's safety invariant: "erase stays disabled until the archive is acknowledged by
the receiving device" holds even when a send genuinely cannot succeed, rather than the
local archive-build step alone silently unlocking erase. The real two-device
send → ack → import round trip (a genuine receiver acknowledging and importing) is
`stage2-two-user/74-device-handoff-transfer.spec.ts`.
