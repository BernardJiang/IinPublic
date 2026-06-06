# IinPublic TODO

Last updated: 2026-06-06

This file is the short, execution-oriented plan.
- Completed work: `docs/completed.md`
- Detailed backlog inventory: `docs/TODO-backlog-inventory.md`
- **Authoritative product + P2P design:** `docs/specs/iinpublic-technical-specification.md` (§19.13, §19.14, REQ-P2P-09–29)
- Supporting detail: `docs/roadmap/p2p-node-network.md`

## Open items

### P3 — Challenge Plugin Framework: zone-B config storage (FR-CPF-04)

The framework is implemented and wired into routes. The per-chatroom plugin configuration storage in zone-B Gun paths is not yet implemented.

- [ ] Store per-chatroom plugin configuration in zone-B (`~{ownerPub}/private/chatroom-config/<chatroomId>/challengePlugins`) so owners can enable/disable plugins without server restart
- [ ] Add `WebChatroomService.setChallengeConfig(chatroomId, pluginIds)` that writes to zone-B and reads it back for the `resolveChallengeGate` hook
- [ ] Unit test: round-trip serialize/deserialize plugin config from Gun zone-B path

### Phase D — DHT Bootstrap implementation (§19.12)

Design doc written (`docs/roadmap/phase-d-dht-bootstrap.md`). Implementation not started.

- [ ] Create `src/shared/dht-bootstrap.ts` with `DhtBootstrapClient` interface and `BootstrapPeer` / `UserPeerRecord` types (see design doc §4.2)
- [ ] Create `src/server/services/bootstrap-store.ts`: in-memory LRU peer store with 5-min TTL
- [ ] Create `src/server/routes/bootstrap-routes.ts`: `GET /bootstrap/peers`, `POST /bootstrap/announce`, `GET /bootstrap/lookup/:userId`
- [ ] Create `src/web/services/web-bootstrap-client.ts`: client backed by hub `/bootstrap/*` endpoints
- [ ] Web client: try hub `/api/peers` first; fall back to `/bootstrap/peers` if hub unreachable
- [ ] Unit + integration tests for announcement validation, TTL eviction, and lookup

## Hub migration track (§19.12)

| Phase | Status |
|-------|--------|
| A Dual-mode mesh + signaling | Partial |
| B Client-authoritative talks | Shipped — see `docs/completed.md` |
| C Relay-only hub (no app `radata/`) | Shipped — see `docs/completed.md` |
| D DHT bootstrap | Design done — see `docs/roadmap/phase-d-dht-bootstrap.md`; implementation pending |
| E Pair-private ownership graph | Shipped — see `docs/completed.md` |

## Run commands

```bash
npm run dev:p0-talks          # P0 mesh delivery (shipped)
npm run test:e2e:p0-talks     # P0 E2E only
npm run dev:relay-only        # Relay-only hub (RELAY_ONLY_HUB=1)
npm run test:e2e:parallel     # Full E2E suite in direct mode
npm run test:e2e:star         # Star-gun relay regression
```

## Working Rule

- Move completed TODO items to `docs/completed.md`.
- Keep this file short and action-oriented.
- Keep SRS audit snapshots tied to code evidence and verification commands.
