# IinPublic Completed Work

Last updated: 2026-05-21

This is the durable ledger for shipped feature work. Keep `TODO.md` focused on forward work:
when an item is finished, move it here with a short description and concrete evidence.

## Maintenance Rule

- Move completed TODO items from `docs/TODO.md` into this file.
- Include the date, feature/phase name, user-visible result, and verification evidence.
- Keep detailed design and future work in the relevant spec or roadmap doc.
- If a completed item later needs more work, add a new TODO entry instead of editing history.

## 2026-05-20 - P2P Node Network Roadmap P1-P7

Source roadmap: [P2P Node Network Roadmap](roadmap/p2p-node-network.md)

### P1 - Star Compatibility Baseline

Implemented runtime flags and explicit star-mode storage classification while keeping the
existing Gun star topology as the default compatibility baseline.

Evidence:

- Commit: `0a90432` - `Implement P2P star baseline`
- Runtime/debug surface: `GET /api/debug/storage`
- E2E: `tests/e2e/staged/stage1-single-user/00-p2p-star-baseline-storage.spec.ts`
- Unit/integration: `src/test/unit/p2p-runtime.test.ts`, `src/test/integration/system-routes.test.ts`

### P2 - Permissioned Local Node Supervisor

Added the local-node supervisor model and APIs for explicit permission disclosures, lifecycle
state, signed session pairing, identity binding, health checks, local-only persistence controls,
and wipe/delete behavior.

Evidence:

- Commit: `ff3943c` - `Implement P2P local node supervisor`
- APIs: `/api/p2p/local-node`, `/start`, `/bind-identity`, `/health-check`, `/wipe`
- E2E: `tests/e2e/staged/stage1-single-user/00-p2p-local-node-supervisor.spec.ts`
- Unit/integration: `src/test/unit/p2p-runtime.test.ts`, `src/test/integration/system-routes.test.ts`

### P3 - SEA Key Custody And Relay Privacy

Replaced plaintext browser SEA keypair storage with encrypted WebCrypto custody, formalized the
public-only SEA identity policy, added encrypted linked-device/recovery primitives, and added
relay/browser leak scanning for private SEA keys and plaintext direct-message bodies.

Evidence:

- Commit: `134ddf5` - `Implement P2P SEA key custody`
- E2E: `tests/e2e/staged/stage1-single-user/00-p2p-sea-key-custody.spec.ts`
- Unit/integration: `src/test/unit/p2p-runtime.test.ts`, `src/test/integration/system-routes.test.ts`

### P4 - Conversation Transport Boundary

Introduced the conversation transport abstraction while preserving `star-gun` as the active
default, exposed `server-relay` and `direct-p2p` modes, added encrypted short-lived signaling
envelopes, and surfaced transport diagnostics in Settings/debug storage.

Evidence:

- Commit: `dd17f70` - `Implement P2P conversation transport`
- APIs: `/api/p2p/signaling/:conversationId`
- E2E: `tests/e2e/staged/stage1-single-user/00-p2p-conversation-transport.spec.ts`
- Unit/integration: `src/test/unit/p2p-runtime.test.ts`, `src/test/integration/system-routes.test.ts`

### P5 - Cross-Platform P2P Protocol

Added the platform-neutral P2P protocol model using the selected
`gun-mesh-websocket-webrtc` substrate, with Web/Windows/Ubuntu/Android/iOS descriptors,
capability negotiation, signed discovery messages, encrypted signaling expectations, and
plaintext/private-key rejection rules.

Evidence:

- Commit: `17c71a8` - `Implement P2P cross-platform protocol`
- APIs: `/api/p2p/discovery`
- E2E: `tests/e2e/staged/stage1-single-user/00-p2p-cross-platform-protocol.spec.ts`
- Unit/integration: `src/test/unit/p2p-runtime.test.ts`, `src/test/integration/system-routes.test.ts`

### P6 - Active Neighbor Memory

Added local-only active neighbor memory with scoring, expiry pruning, blocked/failed peer
exclusion, encrypted export, disable/clear controls, and bootstrap candidates before public
star fallback.

Evidence:

- Commit: `0265e3f` - `Implement P2P active neighbor memory`
- APIs: `/api/p2p/neighbors`
- E2E: `tests/e2e/staged/stage1-single-user/00-p2p-neighbor-memory.spec.ts`
- Unit/integration: `src/test/unit/p2p-runtime.test.ts`, `src/test/integration/system-routes.test.ts`

### P7 - Data Ownership And Migration Boundaries

Added data ownership policy surfaces for device-local deletion, metadata-only server-held data
requests/deletes, migration planning for private and legacy data, relay-only TTL policy, and
telemetry-free user-visible transport diagnostics.

Evidence:

- Commit: `344558a` - `Implement P2P data ownership boundaries`
- APIs: `/api/p2p/data-ownership`, `/api/p2p/transport-diagnostics`
- E2E: `tests/e2e/staged/stage1-single-user/00-p2p-data-ownership.spec.ts`
- Unit/integration: `src/test/unit/p2p-runtime.test.ts`, `src/test/integration/system-routes.test.ts`

Verification after P1-P7:

- `npm run health`
- `PW_WORKERS=20 npm run test:e2e`

## 2026-05-20 - P2P Test Stabilization

Stabilized date-sensitive P2P expiry tests so discovery and neighbor-memory checks use
future-relative timestamps instead of fixed dates.

Evidence:

- Commit: `84f330d` - `Stabilize P2P expiry tests`
- Files:
  - `src/test/integration/system-routes.test.ts`
  - `tests/e2e/staged/stage1-single-user/00-p2p-cross-platform-protocol.spec.ts`
  - `tests/e2e/staged/stage1-single-user/00-p2p-neighbor-memory.spec.ts`

## 2026-05-20 - Health Check Warning Cleanup

Removed Jest open-handle warnings from Gun read helpers and silenced the expected Webpack
production bundle-size warning with an explicit project budget.

Evidence:

- Commit: `8edb241` - `Silence health check warnings`
- Files:
  - `src/server/services/gun-service.ts`
  - `webpack.config.js`
- Verification: `npm run health`

## 2026-05-20 - Exact Chatbot Memory E2E Stabilization

Stabilized the exact chatbot memory E2E by adding a normalized server-side test endpoint and
waiting on the same memory read path used by server auto-reply instead of grepping raw Gun
snapshots.

Evidence:

- Commit: `2d5db9a` - `Stabilize exact chatbot memory E2E`
- API: `/api/test/exact-chatbot-memory/:userId`
- E2E: `tests/e2e/staged/stage3-three-user/14-exact-chatbot-memory.spec.ts`
- Verification: `npm run health && PW_WORKERS=20 npm run test:e2e`

## Current Implemented Feature Baseline

These feature areas are already part of the current implementation and should not be re-added
to `TODO.md` as greenfield work:

- Profile editor and viewer-filtered public profile rendering.
- Intake filters, server-side moderation, blocking/unblock, age gating, reputation scoring,
  and bulk-capacity enforcement.
- Custom/business chatrooms, hierarchy navigation, single-room travel mode, and same-room
  broadcast delivery.
- Tag catalog, mandatory broadcast preamble, interest targeting, distance caps, tag popularity,
  and tag trend stats.
- Talk creation, matching, answer history, contacts, messaging, cancellation/deletion paths,
  and exact chatbot Q/A memory.
- Generic per-talk stats endpoints, cross-question/time-series/chatroom/peer/dashboard stats,
  dedicated Statistics tab, survey analytics dashboard, low-count masking, CSV exports,
  follow-up survey creation, and peer relationship stats.
