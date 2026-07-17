# stage1/71 — Linked devices page

covers: SPEC-19.14, SPEC-3.2  <!-- auto-seeded; refine by hand -->

Covers TODO item **I** (redesign §10.4, catalog T10).

Single device: Settings › Linked devices opens with an empty state; the
Link-a-device dialog shows a pairing code + live countdown; the Enter-code dialog
rejects invalid and expired codes with an inline error and accepts a valid code
(adding a row); Unlink removes the row via a confirm dialog. The cross-device
attestation exchange is covered by `cross-platform/x3` (nightly).
