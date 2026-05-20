# IinPublic TODO

Last updated: 2026-05-14

This is the forward backlog for the current repository. Completed feature ledgers belong in
[Project Status](reports/PROJECT_STATUS.md) or the [Spec Gap Matrix](roadmap/spec-gap-matrix.md),
not in TODO.

Authoritative product scope lives in
[docs/specs/iinpublic-technical-specification.md](specs/iinpublic-technical-specification.md).

## Current Focus

Continue the P2P roadmap:
[P2P Node Network Roadmap](roadmap/p2p-node-network.md).

## P7 — Data Ownership and Migration

- [ ] Add "Delete this device's local data" and "Request/delete server-held data" flows.
- [ ] Add migration logic that moves eligible server-persisted private data to local/encrypted user-owned storage.
- [ ] Add relay-only TTLs for discovery, signaling, presence, and room membership paths.
- [ ] Add telemetry-free diagnostics that let users see whether a message used direct P2P, relay fallback, or star-server mode.
- [ ] Update the technical specification once the transport and storage boundaries are implemented.

## Working Rule

- Remove completed TODOs instead of keeping stale checked-off work.
- Link each future item to the technical specification or a focused roadmap doc.
- Archive old snapshots under `docs/archive/` when they stop representing the current repo.
