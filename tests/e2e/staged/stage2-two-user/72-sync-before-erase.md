# stage2/72 — Sync before erase

covers: SPEC-19.14  <!-- auto-seeded; refine by hand -->

Covers TODO item **J** (redesign §11.2).

With a linked personal device recorded, the Erase dialog offers "Save to ⟨device⟩
first" → the Sync-progress dialog reports per-category progress and enables Done
on completion; erase stays gated by the type-`ERASE` input. The cross-device
receiver-merge + revocation visibility is covered by `cross-platform/x7`.
