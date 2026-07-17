# 00-p2p-infrastructure

covers: SPEC-19.4, SPEC-3.12  <!-- auto-seeded; refine by hand -->

Merged spec (speed re-organization): one shared boot instead of 6. Sections below are the original per-spec narratives.

---

## from 00-p2p-sea-key-custody.md

# P2P roadmap P3 — SEA key custody and relay storage boundaries

Verifies that browser SEA private keys are stored as an encrypted custody record instead of raw
`iinpublic_keypair` localStorage, and that the non-production relay/storage debug surface reports
only public identity policy plus a clean private-key/plaintext scan.

---

## from 00-p2p-conversation-transport.md

# P2P roadmap P4 — conversation transport and signaling

Verifies the first transport abstraction surface: star mode remains the default, direct P2P and
server-relay modes are advertised as supported transport targets, and server signaling accepts only
encrypted short-lived setup envelopes rather than plaintext SDP/ICE bodies.

---

## from 00-p2p-cross-platform-protocol.md

**Features tested:** P2P P5 platform-neutral protocol, chosen substrate, signed discovery compatibility, Settings protocol inspector

1. Verifies debug storage exposes a versioned node protocol for Web, Windows, Ubuntu, Android, and iOS.
2. Verifies the chosen substrate is `gun-mesh-websocket-webrtc`.
3. Posts signed discovery messages for representative desktop/mobile peers.
4. Confirms unsigned or plaintext discovery is rejected.
5. Opens Settings and verifies the protocol/platform/capability inspector.

---

## from 00-p2p-data-ownership.md

# P2P Roadmap P7 — Data Ownership and Migration

Verifies that data ownership has a concrete non-production surface:

- local device data deletion clears local-first data classes
- server-held data export/delete requests are metadata-only
- migration planning moves eligible private/legacy data to local encrypted storage
- relay-only paths have explicit TTLs
- transport diagnostics are user-visible and telemetry-free

---

## from 00-p2p-neighbor-memory.md

# P2P Roadmap P6 — Active Neighbor Memory

Verifies that the non-production debug/API surface models local-only active neighbor memory:

- neighbor memory defaults to local-only and private
- active low-latency peers become bootstrap candidates before star fallback
- failed endpoints and blocked peers are excluded from bootstrap candidates
- encrypted export and Settings inspector controls are visible

---

## from 00-p2p-local-node-supervisor.md

**Features tested:** P2 permissioned local node supervisor, permission disclosures, signed pairing, identity binding, local-only data controls

1. Starts a clean single-user session.
2. Verifies the local node supervisor starts stopped and lists storage, bandwidth, battery, background, local-port, and delete/stop disclosures.
3. Verifies browser-to-local-node discovery requires signed session pairing.
4. Starts the node, binds separate web and node identities with a proof, and confirms the Settings inspector renders the supervisor state.
5. Wipes local node state and confirms the supervisor reports `wiped`.
