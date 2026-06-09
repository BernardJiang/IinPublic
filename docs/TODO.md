# IinPublic TODO

Last updated: 2026-06-07

This file is the short, execution-oriented plan.
- Completed work: `docs/completed.md`
- Detailed backlog inventory: `docs/TODO-backlog-inventory.md`
- **Authoritative product + P2P design:** `docs/specs/iinpublic-technical-specification.md` (§19.13, §19.14, REQ-P2P-09–29)
- Supporting detail: `docs/roadmap/p2p-node-network.md`
- Source design sketch: `docs/p2p-mesh-talk-delivery-plan.md`

## Open items

### P0 — Mesh talk delivery (`P2P_MESH_TALKS`)

Goal: move talk delivery off the star/server data path. The hub remains rendezvous, presence, signaling, STUN/TURN config, and encrypted TTL mailbox fallback only.

#### 1. Mesh transport foundation

- [ ] Test: three browser peers can gossip `mesh-ping` across a sparse room overlay without `talks/*` or `peerTalkOffers/*` Gun writes

#### 2. Mesh broadcast announcements

- [ ] Test: find-similar broadcast reaches eligible receivers over mesh

#### 3. Body pull and receiver-side intake

- [ ] Test: language/distance/content/adult/cutoff intake specs pass with receiver-side filtering

#### 4. Responses, matches, and conversations over mesh

- [ ] Keep offline author fallback routed through encrypted mailbox only
- [ ] Test: responses produce matches/conversations without server response endpoints or pair Gun subscriptions

#### 5. Local-only contacts and history

- [ ] Make contacts view derive peers only from local conversations, talk exchanges, and known people
- [ ] Remove client dependencies on `/api/users/:id/peers`, `/relationship`, `/talk-history`, and `/replies`
- [ ] Test: contacts, peer detail, match percentage, replies, and history render from local stores only

#### 6. Encrypted offline mailbox

- [ ] Add TTL mailbox endpoints for ciphertext-only envelopes
- [ ] Drain mailbox on connect and delete drained envelopes
- [ ] Route offline `talk-body`, `talk-response`, and receipts through mailbox fallback
- [ ] Test: offline peer receives queued encrypted talk response after reconnect; expired envelopes are dropped

#### 7. Delete star talk delivery

- [ ] Remove `talk-delivery-routes` and server talk maps (`incomingTalksMap`, `talkResponsesMap`, `conversationsMap`)
- [ ] Remove `peer-routes` and server-derived talk stats routes
- [ ] Stop Gun relay use for `talks/*`, `peerTalkOffers/*`, `incomingTalksByUser/*`, `chatrooms/*/announcements`, `chatrooms/*/talks`, and conversation messages
- [ ] Remove `P0_DIRECT_TALK_DELIVERY` / star branches and `usesDirectTalkDelivery` forks
- [ ] Flip mesh talks on by default
- [ ] Test: full direct-mode E2E suite passes with no star talk endpoints

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

### P2 — Scalable "Find Similar People" by matched tags (REQ-SIM-01–08)

Generalize the 10×20 find-similar scenario to arbitrary N users × Mᵢ weighted tags, scalable toward
N ≈ 100k reachable users. **Design of record:** `docs/specs/similar-people-scalable-srs.md`.

#### 1. Generalize correctness (P1)

- [ ] Add weighted `matchScore(viewer, other, combine)` to `src/shared/` next to `checkIfMatch` (single source of truth)
- [ ] Add `user-tags/<id>` tag **map** (`tag -> weight`, default 1) with `version` + content `hash` (reuse `talk-content-id.ts`)
- [ ] Replace hardcoded 10×20 logic; parametrize the E2E to arbitrary N / Mᵢ
- [ ] Test: N users each with Mᵢ tags rank all others by matched-tag score (unweighted = `combine = () => 1`)

#### 2. Dropout-tolerant exchange (Scenario 1, REQ-SIM-04)

- [ ] Model exchange as publish + independent local read (no pairwise barrier / completion gate)
- [ ] Test: a peer dropping out mid-exchange does not block any other pairwise score

#### 3. Incremental tag mutation + weighting (Scenarios 2 & 3, REQ-SIM-05/06)

- [ ] Publish **deltas** (`{version, changed:{tag: weight|null}}`), O(1) `hash` change-detect, skip if unchanged
- [ ] Incrementally patch the single affected pairwise score (O(|delta|)); recompute only the mutated user's row
- [ ] Tag weighting end to end via the same delta path; pick + document the combine policy (asymmetry)
- [ ] Test: one user mutates tags → exactly one publish; all peers' rankings update without full re-exchange

#### 4. Scale to ~100k (P3, REQ-SIM-NFR-01/02/05)

- [ ] Inverted `tag-index/<tag> : Set<userId>`; candidate set = union over viewer's tags (only ≥1-shared-tag users scored)
- [ ] Bounded top-K heap retrieval (no full-population sort); hot-tag capping / min-shared-tags threshold
- [ ] Locality scoping (chatroom/region/proximity) to bound effective N per query
- [ ] Decide weight visibility vs. "their standard" sort (public weights = client-side; private = server-computed)
- [ ] Test: top-K ranking over a 100k-scale population stays within latency budget and never goes O(N²)

#### 5. Generic retrieve→sort→display pipeline (P4, REQ-SIM-07)

- [ ] `SortStrategy` registry (`id`, `label`, `key`, `dir`): matched-tags, distance (blurred), their-standard (`matchScore` args swapped)
- [ ] `rankPeople(viewer, candidates, sortId, filters)` — materialize candidates once, re-sort in memory
- [ ] Wire `sortStrategies` + `activeSortId` through `ContactsViewDeps` (3 call sites in `ui-manager.ts`); UI dropdown built from registry
- [ ] Test: same candidate set re-sorts by matched-tags / distance / their-standard with no extra reads

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
