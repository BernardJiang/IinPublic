# IinPublic TODO

Last updated: 2026-06-12

This file is the short, execution-oriented plan. The detailed acceptance inventory and the
statistics / spec-gap follow-ups are consolidated into the appendices at the bottom of this file.
- Completed work: `docs/completed.md`
- **Authoritative product + P2P design:** `docs/specs/iinpublic-technical-specifications.md` (§19.13, §19.14, REQ-P2P-09–29; mesh talk delivery design §23; libp2p/IPFS §25 — supersedes Phase D §24; find-similar §22)
- Detailed acceptance inventory: see "Appendix A — Detailed backlog inventory" below.

## Model routing legend

Each item is tagged with the cheapest model that can do it reliably, to optimize token spend:

- **`[Opus]`** — distributed-correctness / ordering / architecture is the hard part; design mistakes cascade.
- **`[Sonnet]`** — standard implementation against an existing spec or pattern.
- **`[Haiku]`** — mechanical, fully specified work; running test suites; scaffolding from a written design.

Token-saving rules: for `[Opus]` items, have Opus write a short design note first, then hand implementation + tests to Sonnet. Do steps 9–11 in one Opus session (shared versioning/ordering machinery). `- [ ] Test:` items belong to whichever model implemented the step.

## Open items

### P1 — libp2p transport + IPFS content layer (SRS §25; supersedes Phase D §24)

**Design of record:** SRS §25 (merged 2026-06-10 from `docs/architecture/p2p-mesh-libp2p-analysis.md`).
One dependency (Helia) serves both: libp2p replaces the hand-rolled WebRTC connection layer and
hub-bound discovery; IPFS adds content-addressed file sharing with the matched-talk auto-share
link. App layers stay byte-identical: `P2PMeshFrame`, SEA crypto, gossip forwarding, TalkLedger,
Gun, mailbox. **Sequenced after P0 steps 9–11.**

#### L1. Helia/libp2p node bootstrap (REQ-IPFS-01, REQ-LIBP2P-07) `[Sonnet]`

- [x] Add Helia; lazy-init alongside SEA + Gun bootstrap; expose `node.libp2p`; record gzipped bundle delta; keep per-worker E2E port isolation
	- 2026-06-11 measurement after lazy split: `dist/web/bundle.js.gz = 214,582` bytes, async Helia chunk `dist/web/898.bundle.js.gz = 371,158` bytes
- [x] Test: app boots with node initialized on first content-layer use; no first-paint regression
	- Verified by `src/test/unit/web-content-node-service.test.ts` (lazy init semantics), `npm run test:type`, and `npm run build:web`

#### L2. Mesh stream handler over libp2p (REQ-LIBP2P-01/02/04) `[Opus design → Sonnet impl]` — transport swap behind `MeshSession`; connection-lifecycle correctness

- [x] Register `/iinpublic/mesh/1.0.0`; implement `MeshSession` over libp2p streams (frames/SEA/dedup/forwarding unchanged); SEA-signed `userId↔PeerID` binding records
- [x] Add connection-lifecycle failover wrapper: libp2p primary session with automatic WebRTC fallback (`createFallbackMeshSession`) and app wiring in mesh session factory
- [x] Test: spec-01/02/03 core invariants (ping, talk body delivery, talk response routing) pass over libp2p transport in unit coverage (`p2p-libp2p-mesh-invariants.test.ts`)
- [x] Test: NAT-blocked pair connectivity path validated via relay simulation in libp2p mesh-session adapter coverage (`p2p-libp2p-mesh-session.test.ts`)

#### L3. Hub-independent discovery (REQ-LIBP2P-03) `[Sonnet]`

- 2026-06-12 progress: added `P2PRoomDiscoveryService` (`src/web/services/p2p-room-discovery.ts`) with deterministic room rendezvous key derivation, `provide`/`findProviders` hooks, bootstrap-peer list parsing (`IINPUBLIC_P2P_BOOTSTRAP_PEERS`), and app wiring in mesh room sync (`meshDiscoveryDiagnostics` for E2E-visible state).
- 2026-06-12 progress: added E2E coverage `tests/e2e/talks-matching/06-mesh-ping-with-hub-api-down.spec.ts` validating mesh-ping/pong reachability after mid-session hub API loss simulation (`/api/presence/*`, `/api/chatrooms/*/members` blocked), including explicit overlay teardown (`leaveRoom`) and re-form (`joinRoom`) without hub API access.
- 2026-06-12 progress: `WebContentNodeService` now parses discovery config defaults from env (`IINPUBLIC_P2P_BOOTSTRAP_PEERS`, `IINPUBLIC_P2P_MDNS_ENABLED`, `IINPUBLIC_P2P_DHT_ENABLED`) and exposes `getDiscoveryConfig()` for app-level wiring.
- 2026-06-12 progress: `WebContentNodeService` now applies discovery toggles into Helia libp2p bootstrap (`libp2pDefaults()`), including custom bootstrap-peer list override, mDNS enable/disable handling, and DHT service toggle before `createHelia({ libp2p })`.
- 2026-06-12 progress: `PeerMeshService` reconciliation now accepts discovery fallback candidates (`getDiscoveryUserIds`) and still reconciles under sparse roster callbacks; app maps discovered provider peerIds to room userIds via libp2p binding records (`p2p-peer-bindings/<userId>`).
- 2026-06-12 progress: Playwright now supports opt-in p2p-node E2E mode via `E2E_P2P_NODE_ENABLED=1` (applies to both server and web dev process), and `npm run test:e2e:l3:node-discovery` validates the L3 hub-loss mesh reform spec in node-enabled mode.
- 2026-06-12 progress: added strict process-stop acceptance path `npm run test:e2e:l3:hub-stop` with test-only hub shutdown endpoint (`POST /api/test/shutdown-hub`) and E2E `07-mesh-ping-after-hub-stop.spec.ts` proving mesh neighbor survivability + ping reachability after hub process termination.
- [x] Kademlia DHT room rendezvous (`provide`/`findProviders` on room-key CID) + mDNS; Socket.IO roster stays as fast path; bootstrap-peer multiaddr list for cold start
- [x] Test: stop the hub mid-session → peers re-form the room overlay and mesh-ping reachability holds without hub interaction

#### L4. IPFS talk attachments (REQ-IPFS-02/03) `[Sonnet]`

- [ ] `ipfsAttachments` descriptor on talks (announce metadata + body payload; no new frame kinds; no bytes in Gun/mailbox)
- [ ] SEA-encrypt-before-add for private attachments; plaintext requires explicit per-attachment public opt-in; author pins locally
- [ ] Test: attachment descriptor round-trips announce→body→intake; ciphertext-only on IPFS for `enc:'sea-pair'`

#### L5. Matched-talk auto-share link (REQ-IPFS-04/05/06) `[Sonnet]`

- [ ] On match-created conversation, author auto-sends `ipfs://<cid>` message with pair-encrypted key; deterministic message id `CIDv1({conversationId, talkId::authorId, cid})` (idempotent both sides; offline → mailbox carries link+key only)
- [ ] Receiver fetch via bitswap + decrypt; `TALK_RETRACTED` unpins + marks links dead (best-effort, UI copy notes irrecallability)
- [ ] Test (E2E): Tom's talk carries an attachment; Jerry matches → share message appears exactly once in both views; Jerry fetches and decrypts; Bob (ignored) never receives the link; offline-Jerry receives link after mailbox drain

#### L6. Signaling deletion (REQ-LIBP2P-06) `[Haiku]` — mechanical once L2/L3 E2E-stable

- [ ] Delete `/api/p2p/signaling`, conversation-relay, discovery routes (+ dead client callers, tests prove 404); STUN/TURN config route when relay-only traversal is proven
- [ ] Test: full E2E suite green with signaling endpoints absent

### P2 — Context-aware "Me" tab answer list (FR-QA-14, UI-8, §13.7) `[Sonnet]` — data model + UI fully specified; backfill needs care

The "Me" tab shows the user's saved Q/A pairs. Flat for tag/survey, but **flow and route answers are
context-bearing** — the same question can have different answers under different preceding contexts, so
the list must show context and must not collapse distinct-context answers. Design: spec §13.7 + FR-QA-14.

- [x] Add display-only `contextLabel` (`"Q→A · Q→A"`) to `AnswerRecord`, written at answer-save time; `''` for tag/survey. `contextHash` stays the authoritative match key.
- [x] Render the "Me" list keyed by `(questionId, contextHash)`: flat rows for tag/survey; for flow/route show the `contextLabel` breadcrumb per row and never de-duplicate distinct-context answers.
- [x] Group rows by question with collapsible per-context sub-entries so a route question reached by many branches stays scannable; keep the per-row visibility lock (UI-5) and edit/history affordances.
- [x] Backfill/derive `contextLabel` for existing records from the retained talk definition where still available; tolerate missing source talks (show question + answer without the breadcrumb).
- [x] Test (flow): a 3-question flow yields three rows each showing its preceding `Q→A` context.
- [x] Test (route): the same question reached via two branches yields two rows with different `contextLabel`s and possibly different answers — not merged into one.
- [x] Test (durability): after the source talk is withdrawn/retracted, the "Me" rows still render from `contextLabel` (no blank/again-asked context).

### P3 — Challenge Plugin Framework: zone-B config storage (FR-CPF-04) `[Haiku]` — small Gun read/write + round-trip test; framework already wired

The framework is implemented and wired into routes, including per-chatroom plugin configuration storage in zone-B Gun paths.

- [x] Store per-chatroom plugin configuration in zone-B (`~{ownerPub}/private/chatroom-config/<chatroomId>/challengePlugins`) so owners can enable/disable plugins without server restart
- [x] Add `WebChatroomService.setChallengeConfig(chatroomId, pluginIds)` that writes to zone-B and reads it back for the `resolveChallengeGate` hook
- [x] Unit test: round-trip serialize/deserialize plugin config from Gun zone-B path

### ~~Phase D — DHT Bootstrap implementation (§19.12)~~ — SUPERSEDED 2026-06-10

Superseded by **P1 — libp2p transport + IPFS content layer** (SRS §25, item L3): libp2p's
built-in Kademlia DHT + mDNS replaces the custom bootstrap service. The §24 announce-validation
threat model (signature, replay window, TTL) carries over to the L2 binding records. Do not
implement the `/bootstrap/*` endpoints.

### P2 — Scalable "Find Similar People" by matched tags (REQ-SIM-01–08)

Generalize the 10×20 find-similar scenario to arbitrary N users × Mᵢ weighted tags, scalable toward
N ≈ 100k reachable users. **Design of record:** spec §22 (Scalable "Find Similar People" by Matched Tags).

#### 1. Generalize correctness (P1) `[Sonnet]` — generalizes existing `checkIfMatch` pattern

- [x] Add weighted `matchScore(viewer, other, combine)` to `src/shared/` next to `checkIfMatch` (single source of truth)
- [x] Add `user-tags/<id>` tag **map** (`tag -> weight`, default 1) with `version` + content `hash` (reuse `talk-content-id.ts`)
- [x] Replace hardcoded 10×20 logic; parametrize the E2E to arbitrary N / Mᵢ
- [x] Test: N users each with Mᵢ tags rank all others by matched-tag score (unweighted = `combine = () => 1`)

#### 2. Dropout-tolerant exchange (Scenario 1, REQ-SIM-04) `[Opus]` — removing pairwise barriers; concurrency reasoning

- [ ] Model exchange as publish + independent local read (no pairwise barrier / completion gate)
- [ ] Test: a peer dropping out mid-exchange does not block any other pairwise score

#### 3. Incremental tag mutation + weighting (Scenarios 2 & 3, REQ-SIM-05/06) `[Opus]` — O(|delta|) patching correctness + combine-policy decision

- [ ] Publish **deltas** (`{version, changed:{tag: weight|null}}`), O(1) `hash` change-detect, skip if unchanged
- [ ] Incrementally patch the single affected pairwise score (O(|delta|)); recompute only the mutated user's row
- [ ] Tag weighting end to end via the same delta path; pick + document the combine policy (asymmetry)
- [ ] Test: one user mutates tags → exactly one publish; all peers' rankings update without full re-exchange

#### 4. Scale to ~100k (P3, REQ-SIM-NFR-01/02/05) `[Opus]` — index/heap architecture, latency budgets, open design decisions

- [ ] Inverted `tag-index/<tag> : Set<userId>`; candidate set = union over viewer's tags (only ≥1-shared-tag users scored)
- [ ] Bounded top-K heap retrieval (no full-population sort); hot-tag capping / min-shared-tags threshold
- [ ] Locality scoping (chatroom/region/proximity) to bound effective N per query
- [ ] Decide weight visibility vs. "their standard" sort (public weights = client-side; private = server-computed)
- [ ] Test: top-K ranking over a 100k-scale population stays within latency budget and never goes O(N²)

#### 5. Generic retrieve→sort→display pipeline (P4, REQ-SIM-07) `[Haiku]` — mechanical registry + wiring 3 known call sites

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
```

## Working Rule

- Move completed TODO items to `docs/completed.md`.
- Keep this file short and action-oriented.
- Keep SRS audit snapshots tied to code evidence and verification commands.

---

## Appendix A — Detailed backlog inventory `[Haiku]` — acceptance closure against shipped code; escalate findings to Sonnet

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

## Appendix B — Statistics expansion backlog `[Sonnet]` — aggregation on shipped schemas; privacy-masking rules need attention

> Consolidated 2026-06-08 from `docs/roadmap/statistics-expansion.md` (archived). Baseline stats are shipped (see `docs/completed.md`); the items below are forward analytics work. Verification requirements: `docs/testing/testplan.md` Appendix E.

**Design decisions already made:** normalized response events are append-only + Gun-mirrored; in-memory indices are derived caches; broadcast tag counters are server trend buckets; quota counters remain server-cache state. No precise locations in stats (regions use blurred/chatroom ids); small cohorts masked at < 3 responses; exports keep masking on. Shared schemas/aggregators live in `src/shared/talk-stats.ts`. Raw stats events retained as Gun-mirrored append-only records; compaction/user-pruning is a production policy follow-up.

- **Survey analytics:** cross-question correlation; completion/skip rates by question; time-to-answer; segment filters (region/time bucket/talk type/responder cohort) under privacy thresholds; original vs follow-up survey comparison.
- **Talk analytics:** unified creator dashboard (tags/flows/routes/surveys); match/ignore/response/completion rates across types; time series with day/week/month controls; per-question answer-distribution drilldown.
- **Broadcast & tag analytics:** reach vs response rate; tag demand trends by region/time bucket; targeting effectiveness (tags → eligible → delivered → responses → matches); distance-cap effectiveness and local-vs-traveller split.
- **Chatroom & location analytics:** room activity over time; broadcast volume/response/match rate by room; region-level trends without precise location; travel-mode participation and remote-room effectiveness.
- **Peer & reputation analytics:** relationship history summaries; reputation trend inputs (ratings/blocks/age-votes/capacity impact); visibility-aware reputation sections respecting privacy settings.

## Appendix C — Residual P2P transport & spec-gap follow-ups `[Haiku]` — suite runs and audits; escalate findings

> Consolidated 2026-06-08 from `docs/TODO-direct-p2p.md`, `docs/roadmap/spec-gap-matrix.md`, and `docs/reports/PROJECT_STATUS.md` (all archived). The direct-P2P transport stack shipped (see `docs/completed.md`); only the items below remain open.

- [ ] Reputation/credit section visibility allowlists (FR-UM-7) and deeper FR-UM profile-surface audit.
- [ ] Broader moderation UX and any future centralized reporting/appeal model (FR-BF / FR-SP).
- [ ] Production-durability review of in-memory stats indices, quota counters, and rate-limit counters if persistence requirements tighten (currently in-memory derived state).
- [ ] Statistics/visualization product polish on top of the shipped dashboard and endpoints.
- [ ] Android: maintenance-only until the web/server loop is fully stable.

**Known runtime risks to watch (from project status):** Gun replication timing still affects the incoming-talk auto-reply path (`POST /api/talks/:id/received` needs the answer template replicated before the new talk arrives); the `talkCompleted` handler's Gun direct-write fallback preserves data but skips match/conversation creation when the server is unreachable.
