# IinPublic TODO

Last updated: 2026-06-08

This file is the short, execution-oriented plan. The detailed acceptance inventory and the
statistics / spec-gap follow-ups are consolidated into the appendices at the bottom of this file.
- Completed work: `docs/completed.md`
- **Authoritative product + P2P design:** `docs/specs/iinpublic-technical-specifications.md` (§19.13, §19.14, REQ-P2P-09–29; mesh talk delivery design §23; Phase D DHT §24; find-similar §22)
- Detailed acceptance inventory: see "Appendix A — Detailed backlog inventory" below.

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

Design written in spec §24 (Phase D — DHT Bootstrap Design). Implementation not started.

- [ ] Create `src/shared/dht-bootstrap.ts` with `DhtBootstrapClient` interface and `BootstrapPeer` / `UserPeerRecord` types (see spec §24.2)
- [ ] Create `src/server/services/bootstrap-store.ts`: in-memory LRU peer store with 5-min TTL
- [ ] Create `src/server/routes/bootstrap-routes.ts`: `GET /bootstrap/peers`, `POST /bootstrap/announce`, `GET /bootstrap/lookup/:userId`
- [ ] Create `src/web/services/web-bootstrap-client.ts`: client backed by hub `/bootstrap/*` endpoints
- [ ] Web client: try hub `/api/peers` first; fall back to `/bootstrap/peers` if hub unreachable
- [ ] Unit + integration tests for announcement validation, TTL eviction, and lookup

### P2 — Scalable "Find Similar People" by matched tags (REQ-SIM-01–08)

Generalize the 10×20 find-similar scenario to arbitrary N users × Mᵢ weighted tags, scalable toward
N ≈ 100k reachable users. **Design of record:** spec §22 (Scalable "Find Similar People" by Matched Tags).

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

---

## Appendix A — Detailed backlog inventory

> Consolidated 2026-06-08 from `docs/TODO-backlog-inventory.md` (archived). This is the detailed D6 acceptance inventory; the action-ordered queue is the "Open items" section above. Move shipped outcomes to `docs/completed.md`.

### Chatrooms
- Finish custom/business room detail metadata: description, capacity, headline, owner, created date, active members, lifetime visits, and unique visitors.
- Make broadcast recipient preview explain language, distance, type, content, age, block, expiration, reputation/quota, and TechSupport/support-only exclusions.
- Verify Global/region/home/travel/return-home paths, member ordering, pre-match `Stranger` state, and permanent TechSupport anchor behavior.

### Contacts
- Ensure ordinary answerers/matches start as `Stranger`/unassigned until explicit relationship selection.
- Ensure all relationship labels filter/search/sort/save/reload correctly.
- Add high-volume responder ranking from D5 (matched-talk count, match rate, relationship, recency, weighted relevance) with stable tie-breaking and TechSupport exclusion.
- Complete profile presentation parity: headshot, localized/shared languages, shared interests (when present), talk history, public credit/privacy, block status, channel/transport health.

### Talks
- Complete D4 exhaustive creation/branch/response matrix for tag/flow/survey/route.
- Add language edit preservation and creator/recipient state transitions.
- Add recipient + filtered-count diagnostics by rejection reason and clearer IN/OUT/copied/answered status boundaries.
- Add talk ranking visibility (matches/replies/match-rate/latest/weighted) with visible aggregate counts.
- Keep survey aggregate/report/export distinct from matching conversations.
- Verify route context hashes do not incorrectly reuse answers across branches/languages.

### Me
- Align profile editing parity with Settings (headshot/languages/interests/privacy).
- Complete Preferences modes (temporary, permanent, suppressed, manual, auto, conditional) with clear branch/context explanations.
- Add per-answer ownership controls (language, export/delete/sync semantics, support-message exclusion).
- Add scalable reply review mode with responder/talk/date/outcome/relationship filters and durable sort/group behavior.

### Settings
- Finish D2-D3 localization/filter behavior with clear validation/persistence/reset/hidden-count preview.
- Expand storage/transport diagnostics for TechSupport root/support state, room visit counts, localization/filter state, talk language defaults, SEA custody, relay leak checks, local storage, and P2P flags (without secrets).

### Conversation, Peer Detail, Hidden Surfaces
- Add support-channel vs normal-channel transport status, fallback reasons, privacy verification, translation consent behavior, and history/search controls.
- Keep contextual statistics design (no standalone Statistics tab) consistent with per-survey analytics dialog.

### TechSupport root network role
Scope: FR-CR-1 / FR-CR-2 and P2P identity/signaling/direct-message boundaries. Core: canonical singleton root identity; bootstrap enforcement + reserved-name anti-impersonation; global-room non-empty anchor guarantees; idempotent greeting + support-channel establishment per ordinary user; direct transport preference with encrypted relay fallback; user-visible support-channel health metadata; support contact UX guardrails (mute vs ordinary block); privacy/safety constraints (no private key/message leakage via diagnostics/storage). Verification: first-run bootstrap checks; multi-user/reconnect/idempotency; cross-tab consistency; parallel stage behavior and stage snapshot integrity.

### E2E stage pipeline inventory
- Consolidate single-user coverage into TechSupport Stage 0 baseline where applicable.
- Keep later stages loading a canonical TechSupport baseline before adding ordinary users.
- Audit broadcast and member-count assertions so TechSupport presence does not cause false failures.
- Require tests to declare whether TechSupport participates / is ignored / is excluded.
- Preserve parallel worker isolation while still seeding TechSupport before ordinary users.

### Legacy baseline notes (condensed)
- D2/D3/D4/D5/D6 all have shipped partial proofs and scripts; remaining work is acceptance closure, not greenfield.
- Localization coverage is broad but still needs edge-path fallback audit.
- Intake controls are broadly covered but still need richer dirty-word diagnostics and distance preamble polish.
- Lifecycle and triage work are materially advanced but not fully exhaustive across all branches/tabs.

## Appendix B — Statistics expansion backlog

> Consolidated 2026-06-08 from `docs/roadmap/statistics-expansion.md` (archived). Baseline stats are shipped (see `docs/completed.md`); the items below are forward analytics work. Verification requirements: `docs/testing/testplan.md` Appendix E.

**Design decisions already made:** normalized response events are append-only + Gun-mirrored; in-memory indices are derived caches; broadcast tag counters are server trend buckets; quota counters remain server-cache state. No precise locations in stats (regions use blurred/chatroom ids); small cohorts masked at < 3 responses; exports keep masking on. Shared schemas/aggregators live in `src/shared/talk-stats.ts`. Raw stats events retained as Gun-mirrored append-only records; compaction/user-pruning is a production policy follow-up.

- **Survey analytics:** cross-question correlation; completion/skip rates by question; time-to-answer; segment filters (region/time bucket/talk type/responder cohort) under privacy thresholds; original vs follow-up survey comparison.
- **Talk analytics:** unified creator dashboard (tags/flows/routes/surveys); match/ignore/response/completion rates across types; time series with day/week/month controls; per-question answer-distribution drilldown.
- **Broadcast & tag analytics:** reach vs response rate; tag demand trends by region/time bucket; targeting effectiveness (tags → eligible → delivered → responses → matches); distance-cap effectiveness and local-vs-traveller split.
- **Chatroom & location analytics:** room activity over time; broadcast volume/response/match rate by room; region-level trends without precise location; travel-mode participation and remote-room effectiveness.
- **Peer & reputation analytics:** relationship history summaries; reputation trend inputs (ratings/blocks/age-votes/capacity impact); visibility-aware reputation sections respecting privacy settings.

## Appendix C — Residual P2P transport & spec-gap follow-ups

> Consolidated 2026-06-08 from `docs/TODO-direct-p2p.md`, `docs/roadmap/spec-gap-matrix.md`, and `docs/reports/PROJECT_STATUS.md` (all archived). The direct-P2P transport stack shipped (see `docs/completed.md`); only the items below remain open.

- [ ] Run the full parallel E2E suite gate before release: `npm run test:e2e:parallel` (`PW_WORKERS=20`, 10 min/test).
- [ ] Reputation/credit section visibility allowlists (FR-UM-7) and deeper FR-UM profile-surface audit.
- [ ] Broader moderation UX and any future centralized reporting/appeal model (FR-BF / FR-SP).
- [ ] Production-durability review of in-memory stats indices, quota counters, and rate-limit counters if persistence requirements tighten (currently in-memory derived state).
- [ ] Statistics/visualization product polish on top of the shipped dashboard and endpoints.
- [ ] Android: maintenance-only until the web/server loop is fully stable.

**Known runtime risks to watch (from project status):** Gun replication timing still affects the incoming-talk auto-reply path (`POST /api/talks/:id/received` needs the answer template replicated before the new talk arrives); the `talkCompleted` handler's Gun direct-write fallback preserves data but skips match/conversation creation when the server is unreachable.
