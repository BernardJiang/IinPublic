# IinPublic TODO

Last updated: 2026-06-06

This file is the short, execution-oriented plan.
- Completed work: `docs/completed.md`
- Detailed backlog inventory: `docs/TODO-backlog-inventory.md`
- **Authoritative product + P2P design:** `docs/specs/iinpublic-technical-specification.md` (§19.13, §19.14, REQ-P2P-09–29)
- Supporting detail: `docs/roadmap/p2p-node-network.md`

## Open items from SRS v4.5 (2026-06-06)

### P2 — Community Ownership Model (FR-CR-12)

Implement the four-level community ownership model for user-defined chatrooms. Currently chatrooms have no ownership hierarchy.

- [ ] Add `CommunityRole` type: `'owner' | 'moderator' | 'member' | 'guest'` to `src/shared/types.ts`
- [ ] Add `chatroomRoles/<chatroomId>/<userId>` Gun path; write on room creation (creator = owner) and on role change
- [ ] Add `PUT /api/chatrooms/:id/roles/:userId` route; enforce that only owners may promote/demote moderators, only owners/moderators may change members/guests
- [ ] Enforce role gates in talk delivery (`talk-delivery-routes.ts`): guests blocked from broadcasting by default
- [ ] Add role-check helper to `src/shared/chatroom-hierarchy.ts`; cover with unit tests

### P2 — Content-Addressed Community IDs (FR-CR-11)

Chatrooms created today use opaque string IDs. New user-defined rooms should derive their ID from their root object so the address is self-certifying and survives hub downtime.

- [ ] Implement `deriveCommunityId(ownerPub: string, label: string): string` in `src/shared/chatroom-hierarchy.ts` using `CIDv1(dag-json, sha2-256)` via `multiformats` (already a dependency from ledger work)
- [ ] Apply to new room creation in `WebChatroomService` and server `chatroom-routes.ts`; existing rooms keep their legacy IDs during migration
- [ ] Add unit test: same inputs always produce the same ID; different inputs never collide

### P3 — Challenge Plugin Framework (FR-CPF-01–05)

New pluggable pre-action validation layer. No implementation exists yet.

- [ ] Define `ChallengePlugin` interface in `src/shared/challenge-plugins.ts`: `evaluate(action: ChallengeAction, context: ChallengeContext): { allowed: boolean; reason?: string }`
- [ ] Define `ChallengeAction` union: `'join-community' | 'broadcast-talk' | 'submit-answer' | 'cast-vote'`
- [ ] Implement `ChallengeGate.evaluate(plugins, action, context)` with AND-semantics (all must pass); configurable OR mode per gate
- [ ] Ship built-in plugins: `RequireVerifiedIdentity`, `RequireTrustScore(threshold)`, `RequireInvitation`, `RequirePreviousInteraction`
- [ ] Wire `join-community` and `broadcast-talk` gates into delivery routes; return 403 with `reason` on denial (FR-CPF-05)
- [ ] Store per-chatroom plugin configuration in zone-B (`~{ownerPub}/private/chatroom-config/<chatroomId>/challengePlugins`)
- [ ] Unit tests: AND gate, OR gate, graceful denial response, plugin extensibility

### P3 — Connection Establishment Priority Verification (§4.4)

The spec now explicitly requires ordered connection attempts: local network → direct IP → NAT hole punch → relay. The WebRTC/ICE stack handles this via ICE candidate ordering, but it should be verified and documented.

- [ ] Audit `p2p-webrtc-session.ts`: confirm ICE candidate priority order matches spec (host → srflx → relay); add comment referencing §4.4
- [ ] Add integration test asserting that a relay candidate is only selected when direct candidates fail

### Phase D — DHT Bootstrap (§19.12, now fully specified)

Phase D has a detailed peer discovery flow in the spec. Design work can begin.

- [ ] Write `docs/roadmap/phase-d-dht-bootstrap.md` with implementation plan: bootstrap service API, DHT library evaluation (libp2p vs. custom), `UserID → network address` lookup interface, and migration path from hub-mediated discovery
- [ ] Evaluate `libp2p` and Kademlia as candidates per §16 item 12; document decision in the design doc before writing code

## Hub migration track (§19.12)

| Phase | Status |
|-------|--------|
| A Dual-mode mesh + signaling | Partial |
| B Client-authoritative talks | Shipped — see `docs/completed.md` |
| C Relay-only hub (no app `radata/`) | Shipped — see `docs/completed.md` |
| D DHT bootstrap | **Not started** — design doc required first (see Phase D item above) |
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
