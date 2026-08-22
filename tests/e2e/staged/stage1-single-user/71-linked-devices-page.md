# stage1/71 — Identity & devices page

covers: SPEC-19.14, SPEC-3.2  <!-- auto-seeded; refine by hand -->

Covers TODO item **I** (redesign §10.4, catalog T10).

Single device: Settings › Identity & devices shows the current SEA identity, local protection
status, renameable local device metadata, and an empty linked-device state; the
protection card can set a no-reset local identity password, requires the warning acknowledgement,
clears live key/auth references at the unload boundary, locks on reload or **Lock now**, rejects a
wrong password, changes the password only after the current password succeeds, and preserves the
SEA public identity throughout. The browser proof also checks that plaintext passwords do not
remain in localStorage, IndexedDB custody, DOM text, console output, or request URLs/bodies. The
set and startup-unlock dialogs are keyboard-dismissal/focus tested as applicable and have no
horizontal overflow at 320 px. Removal requires the current password and an explicit storage-risk
acknowledgement, verifies the v1 downgrade before deleting v2, then reloads automatically without a
password while preserving the same SEA public identity. The
Link-a-device flow shows the public-correlation warning, then a real QR of the same manual pairing
code + live countdown. The Enter-code dialog offers capability-gated camera scanning with typed
fallback, previews the peer fingerprint/privacy warning, rejects invalid and expired codes inline,
and accepts a valid code,
publishing a one-sided signed attestation and adding a **Waiting for approval**
row; Unlink publishes a signed revocation and retains a non-actionable **Removed** historical row.
Mutual confirmation remains
covered by `cross-platform/x3` (nightly).
