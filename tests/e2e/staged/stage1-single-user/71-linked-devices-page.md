# stage1/71 — Identity & devices page

covers: SPEC-19.14, SPEC-3.2  <!-- auto-seeded; refine by hand -->

Covers TODO item **I** (redesign §10.4, catalog T10).

Single device: Settings › Identity & devices shows the current SEA identity, local protection
status, renameable local device metadata, and an empty linked-device state; the
Link-a-device flow shows the public-correlation warning, then a real QR of the same manual pairing
code + live countdown. The Enter-code dialog offers capability-gated camera scanning with typed
fallback, previews the peer fingerprint/privacy warning, rejects invalid and expired codes inline,
and accepts a valid code,
publishing a one-sided signed attestation and adding a **Waiting for approval**
row; Unlink removes the row via a confirm dialog. Mutual confirmation remains
covered by `cross-platform/x3` (nightly).
