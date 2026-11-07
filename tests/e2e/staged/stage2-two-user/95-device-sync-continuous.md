# 95-device-sync-continuous

covers: SPEC-11.2, SPEC-31.3

The "Enable sync" handshake on two already-linked devices (linked exactly as in
`73-identity-link-mutual.spec.ts` — real code/approval UI, mutual signed attestation), then a real
`preferences` (talk intake filters) change on one device arriving on the other over a live Gun
round trip. First live-transport E2E coverage for the WP5 device-sync protocol
(shared/device-sync-*.ts); the orchestration itself was already unit-proven.
