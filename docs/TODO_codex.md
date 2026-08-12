# IinPublic Discovery, Connection, Gun Synchronization and Chatbot Plan

**Created:** 2026-08-10

**Authority:** `docs/specs/iinpublic-technical-specifications.md` §29

**Design source:** `docs/iinpublic_discovery_design(3).md`

**Scope:** Implementation and verification plan only; completed work should move to `docs/completed.md` after review.

## Working constraints

- [x] Keep IinPublic independently designed and open source; record the license and provenance of every new dependency.
- [ ] Do not copy proprietary code, private APIs, undocumented wire formats, assets or branding.
- [ ] Preserve unrelated worktree changes and land this architecture incrementally behind flags.
- [ ] Do not delete the current mesh Talk path until Gun-native parity, mixed-version and rollback tests pass.
- [ ] Keep SEA as the only application identity; transport identifiers remain signed subordinate bindings.
- [ ] Every durable application object must end in local Gun before delivery is acknowledged.

## Milestone 0 — architecture inventory and decision locks

- [x] Map every durable object to its current authoritative and compatibility stores:
  Talks, incoming clusters, Q&A, chatbot memory, responses, conversations, chatrooms, reputation inputs and ledger.
- [x] Map every current transfer path: Gun Wire, libp2p stream, WebRTC fallback, peer forwarding and mailbox.
- [x] Identify all localStorage and in-memory caches currently capable of being the only Talk-body copy.
- [x] Define target Gun souls for authored Talks, received/accepted Talks, Me Q&A, chatbot provenance and pair responses.
- [x] Specify room-public, user-private and pair-private read/write/subscription authorization.
- [x] Decide whether control frames remain JSON `P2PMeshFrame`s or become a smaller versioned control envelope.
- [x] Document migration/rollback flags and mixed-version behavior.
- [x] Test: add an architecture-invariant unit test enumerating authoritative data classes and their allowed stores.

## Milestone 1 — common discovery-provider model

- [x] Add `PeerDiscoveryProvider` with start, stop, status and candidate subscription methods.
- [x] Add normalized `ConnectivityCandidate` and source provenance.
- [x] Wrap current hub presence/roster discovery.
- [x] Wrap known verified peers.
- [x] Wrap libp2p DHT room rendezvous and bootstrap multiaddresses.
- [x] Wrap mDNS/Bonjour.
- [x] Add bounded authenticated discovery-gossip provider.
- [x] Add provider-specific backoff without globally disabling discovery.
- [x] Enforce candidate count, address count, record size, expiry and rate limits.
- [x] Test: common provider contract suite runs against every provider.
- [x] Test: each provider fails independently while remaining providers continue.
- [x] Test: candidate source provenance and dedup survive the same peer arriving from multiple providers.
- [x] Test: invalid/expired/malformed candidates fail closed.

## Milestone 2 — SEA-signed connectivity bindings

- [x] Add versioned `ConnectivityBinding` with SEA pub, kind, ID, addresses, capabilities, sequence, issue/expiry and signature.
- [x] Migrate the existing SEA↔libp2p binding to the common schema.
- [x] Verify `connectivityId` control separately from SEA authorship control.
- [x] Reject stale sequences, expired records, mismatched SEA signatures and replayed handshakes.
- [x] Persist recently successful verified bindings in local Gun.
- [x] Ensure a new transport ID cannot evade a SEA-level block.
- [x] Test: binding issuance, verification, rotation, expiry and revocation.
- [x] Test: compromised discovery provider cannot impersonate a SEA identity.
- [x] Test: UI never displays libp2p/radio identifiers as the person identity.

## Milestone 3 — Connection Manager and path metadata

- [x] Introduce `ConnectionManager` above transport adapters and below Gun synchronization.
- [x] Add `PathInfo`: transport, interface, directness, metered state, latency, bandwidth estimate, battery class and stability.
- [x] Add deterministic scoring: reuse healthy route, free first, direct first, stable/fast, battery-aware.
- [x] Add operation classes: discovery, text, background sync, urgent action and IPFS bulk transfer.
- [x] Add permission states: ask, allow once, always allow and wait for free route.
- [x] Add route migration without changing SEA identity or graph/message IDs.
- [x] Add human-readable selection reason and alternatives.
- [x] Test: table-driven route-policy matrix.
- [x] Test: no newly metered route is used without matching permission.
- [x] Test: BLE is not selected for IPFS bulk transfer by default.
- [x] Test: route migration produces no duplicate Gun record or UI row.

## Milestone 4 — configurable peer forwarding

- [x] Add settings: forwarding enabled, Wi-Fi forwarding, cellular forwarding, low-battery pause and byte budget.
- [x] Defaults: enabled; Wi-Fi on; cellular off; low-battery pause on; cellular budget zero.
- [x] Classify frames/deltas as locally originated, locally addressed, discovery gossip or third-party forwarding.
- [x] Enforce policy before neighbor selection and immediately before transmission.
- [x] Preserve original SEA authorship and signed payload across hops.
- [x] Add per-route byte counters, hop bounds, dedup, rate limits and abuse counters.
- [x] Ensure disabling forwarding does not disable the user's own Talks, responses, ACKs or accepted discovery gossip.
- [x] Test: Alice→Carol→Bob with Alice↔Bob blocked.
- [x] Test: disable Carol forwarding and prove the path is not used.
- [x] Test: low battery and cellular policies independently stop only third-party forwarding.
- [x] Test: duplicate multi-path delivery creates one durable Bob record.

## Milestone 5 — restore Gun as authoritative Talk storage

- [x] Add authored-Talk Gun repository and migrate existing authored localStorage records idempotently.
- [x] Add received/accepted-Talk Gun repository and migrate received content caches idempotently.
- [x] Keep compatibility reads during migration; make new writes Gun-first.
- [x] Write to local Gun before sending an offer or response.
- [x] Add read-back verification before sending acceptance receipts.
- [x] Preserve current content IDs, author lineage, expiry and retraction semantics.
- [x] Ensure localStorage and mesh caches become disposable accelerators, not authoritative stores.
- [x] Add crash recovery between local commit, send and receipt.
- [x] Test: restart sender before delivery; Talk remains available from Gun.
- [x] Test: restart receiver after acceptance; Talk and UI rebuild from Gun only.
- [x] Test: delete transport caches; no application history is lost.
- [x] Test: migration is idempotent and rollback reads old storage without data loss.

## Milestone 6 — selective Gun synchronization

- [x] Define a signed Talk offer containing only safe metadata, Talk ID/CID and requested authorization.
- [x] Apply receiver intake before requesting the complete graph.
- [x] Authorize the minimum graph path after acceptance.
- [x] Synchronize the accepted Talk into receiver local Gun using Gun Wire or a documented Gun-compatible delta adapter.
- [x] Synchronize pair-private responses only to participants.
- [x] Keep user-private Q&A, filters, blocks and chatbot memory outside ordinary peer subscriptions.
- [x] Add heads/checkpoints for delta recovery after disconnect.
- [x] Test: rejected Talk does not enter the durable incoming graph.
- [x] Test: accepted Talk converges identically over every transport adapter.
- [x] Test: unauthorized peer cannot request pair-private or user-private paths.
- [x] Test: concurrent edits/retractions converge according to ledger rules.

## Milestone 7 — narrow PeerMeshService

- [x] Inventory current frame kinds and classify each as retain, adapt or retire.
- [x] Retain small offers, requests, persisted receipts, discovery gossip, ACK/control and optional forwarding where useful.
- [x] Replace complete `talk-body` authority with Gun-path synchronization after parity.
- [x] Preserve `msgId`, TTL and seen-set behavior for retained multi-hop control traffic.
- [x] Maintain mixed-version translation while old clients still send Talk bodies.
- [ ] Delete duplicate body caches/retry logic only after two release cycles or explicit compatibility decision.
- [x] Test: old sender→new receiver and new sender→old receiver.
- [ ] Test: current full E2E suite remains green under both legacy and Gun-native flags.

## Milestone 8 — chatbot in the Gun Talk flow

- [x] Trigger chatbot evaluation only after receiver intake and accepted Talk persistence.
- [x] Store exact chatbot answer memory in user-private Gun paths.
- [x] Add answer provenance: human, chatbot reuse, chatbot draft, human approval and source version.
- [x] Preserve question-level differential answering and stale-answer notification.
- [x] Write chatbot/manual responses to pair-private local Gun before network synchronization.
- [x] Attribute every submitted response to the user's SEA identity, never a chatbot identity.
- [x] Ensure public Talk discovery cannot expose private answer memory.
- [x] Test: exact reuse, partial differential prompt, changed question, withdrawn Talk and manual mode.
- [x] Test: same chatbot result over direct, relayed, peer-forwarded and mailbox delivery.
- [x] Test: private chatbot memory absent from hub/server exports and unauthorized peer graphs.

## Milestone 9 — platform adapters

### Common adapter contracts

- [x] Define open discovery and connection adapter interfaces.
- [x] Add capability negotiation and permission-denied degradation.
- [x] Prefer temporary Gun WebSocket peers when the adapter supplies IP connectivity.
- [x] Implement a Gun-over-libp2p stream adapter only if required by measured path limitations.
- [x] Test: common adapter contract, reconnect, backpressure, malformed input and shutdown.

### Apple

- [ ] Wi-Fi Aware discovery/data-path prototype on supported physical devices.
- [ ] Network.framework/Bonjour local peer endpoint.
- [ ] Core Bluetooth rotating discovery identifier.
- [ ] Evaluate Multipeer Connectivity as an Apple-only accelerator behind the common adapter.
- [ ] Treat share-sheet/AirDrop as explicit attachment/import/export only, not background sync.
- [ ] Test: supported/unsupported device and permission matrices.

### Android/Google

- [ ] Android Wi-Fi Aware provider and IP path.
- [ ] Wi-Fi Direct provider and temporary Gun endpoint.
- [ ] NSD/mDNS provider.
- [ ] BLE rotating discovery identifier.
- [ ] Evaluate Google Nearby Connections as optional; verify operation without Google services.
- [ ] Test: supported/unsupported device and permission matrices.

### Cross-platform

- [ ] Real iPhone→Android and Android→iPhone Wi-Fi Aware tests.
- [ ] Same-LAN iOS↔Android Gun convergence.
- [ ] BLE discovery followed by upgrade to a high-bandwidth route.
- [ ] Decide on BLE data transport only after throughput, battery and background measurements.
- [ ] Never send IPFS block bytes over BLE by default.

## Milestone 10 — connectivity UI and diagnostics

- [x] Add Automatic, Data Saver, Fastest, Local/Event, Private and Advanced presets.
- [x] Add free/direct/battery priorities and cellular permission control.
- [x] Add forwarding controls and byte usage.
- [x] Show compact active status: direct/relayed, interface and free/metered.
- [x] Add advanced provider, candidate, SEA-binding, route, health and failure diagnostics.
- [x] Explain permissions in product language before OS prompts.
- [x] Test: every setting affects policy without exposing transport IDs as user identities.
- [x] Test: denied nearby permission leaves Internet discovery operational.
- [x] Test: accessibility, responsive layout and persisted settings.

## Milestone 11 — deterministic redundancy test harness

- [x] Add test-only controls to enable exactly one discovery source and one transport route.
- [x] Add fault injection: connect failure, mid-send drop, latency, duplication, corruption, metered route and battery state.
- [x] Define one hard oracle: Bob's expected Gun soul exists exactly once, rereads correctly, UI renders once, and Alice receives persisted receipt.
- [x] Ensure route tests disable mailbox and all untested fallbacks.
- [x] Add isolated tests for hub, known peer, DHT, mDNS, direct libp2p, WebRTC compatibility, Circuit Relay, peer forwarding and mailbox.
- [x] Add route-transition tests: direct→relay, direct→peer-forward, LAN→cellular with permission, relay→direct and live→mailbox→live.
- [x] Add server-export assertions proving prohibited application bodies are absent.
- [x] Produce a machine-readable capability/verification report per build.

## Milestone 12 — physical-device verification

- [ ] Maintain at least two iPhones, two Android devices and one desktop node across supported OS ranges.
- [ ] Record device model, OS, app build, route, battery state and network type for every run.
- [ ] Test foreground/background/locked-screen transitions.
- [ ] Test normal Wi-Fi, isolated LAN, no Internet, cellular NAT and mixed routes.
- [ ] Test Wi-Fi Aware both directions on supported iPhone↔Android hardware.
- [ ] Test BLE discovery roles in both directions.
- [ ] Measure latency, throughput, battery drain, reconnect time and forwarding bytes.
- [ ] Gate release claims: a route is “supported” only after contract, integration and physical-device verification pass.

## Milestone 13 — security and open-source release gates

- [x] Threat-model discovery poisoning, binding replay, malicious relays, Sybil flooding, metadata leakage and graph over-subscription.
- [x] Fuzz pre-auth candidate, binding, control-frame and Gun-delta parsers.
- [x] Audit dependency licenses and generate an attribution/SBOM artifact.
- [ ] Verify reproducible documented builds for web, desktop, Android and iOS where supported.
- [ ] Publish protocol/schema documentation and test vectors produced specifically for IinPublic.
- [ ] Document cryptographic limits of SEA pair encryption and separately evaluate a reviewed ratcheting protocol for private conversations.
- [ ] External security review before enabling cellular peer forwarding or BLE data transport by default.
- [ ] Test: malicious intermediary cannot alter original SEA authorship or decrypt pair-private payloads.

## Deferred decisions

- [ ] Multi-device person semantics: cluster ID, recovery, Q&A aggregation, reputation, contacts and blocks.
- [ ] Geographic/topic DHT indexes after privacy/enumeration review.
- [ ] Advanced V2 relay guarantees, incentives and accounting.
- [ ] BLE Gun transport after measured product need.
- [ ] Broader public-image graph beyond Me-tab Q&A and contextual credit/reputation.

## Completion definition

The program is complete when all required milestones are reviewed and:

- [ ] Gun is demonstrably authoritative for every durable application data class.
- [ ] Any one permitted working connection can produce exactly-once durable convergence.
- [ ] Each discovery source and route passes in isolation and during failover.
- [ ] Chatbot-assisted and manual Talk responses converge identically across transports.
- [ ] Optional vendor adapters can be removed without data loss or protocol failure.
- [ ] The public repository contains independent source, protocol documentation, tests, license provenance and reproducible build instructions.
