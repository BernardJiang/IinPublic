# Hub Hardening: Explicit Relay Channel

## Status

Design note for `docs/TODO.md` S3 Hub hardening fix.

## Problem

Embedded desktop/mobile nodes currently dial the public hub as a generic Gun
peer through `IINPUBLIC_HUB_GUN_URL` and `attachGun()`:

- `src/node-app/embedded-node.ts` resolves `hubGunPeers`.
- `src/server/bootstrap/http-bootstrap.ts` passes those peers into `Gun({ peers })`.
- Gun then fans out local `.put()` messages to every connected peer.

`scripts/relay-only-verification/run.js` documents the code-level finding in
`node_modules/gun/gun.js`: `mesh.say` broadcasts local puts to all peers. The
public hub can be `radisk:false`, but the hub process still receives app graph
writes into memory. That violates the production target: the hub may carry only
relay metadata, not talk bodies, pair responses, conversation records, or other
device-owned application graph.

## Non-goals

- Do not classify Gun wire packets by payload only. Child nodes and nested
  `.get().get()` chains can use generated souls, so a single outbound packet is
  not reliably self-classifying.
- Do not rely on `radisk:false` as privacy. It prevents durable disk writes but
  not in-memory hub visibility or relay to another connected peer.
- Do not fork Gun internals unless every narrower option fails.

## Decision

Replace the embedded-node-to-hub generic Gun peer link with an explicit
relay-only HTTP channel.

The embedded node still runs local Gun as the device source of truth. It does
not configure the public hub URL as a Gun peer. Instead it synchronizes only
the data classes declared in `createP2PNodeProtocolSpec().syncPolicy`:

- `discovery`
- `signaling`
- `presence`
- `room-membership`

All other graph paths remain local-first and pair/private. This makes the hub
contract enforceable at route boundaries instead of trying to infer intent from
Gun mesh packets.

## Proposed Shape

### 1. Split Config

Keep the shell-facing env var name, but change what it means in embedded mode:

- `IINPUBLIC_HUB_GUN_URL` remains accepted for backward compatibility.
- New internal config exposes `upstreamHubBaseUrl`, derived from the configured
  `/gun` URL by removing the `/gun` suffix.
- `attachGun()` gets no `peers` for embedded nodes when explicit relay mode is
  enabled.

Example:

```text
IINPUBLIC_HUB_GUN_URL=http://192.168.10.48:8080/gun
upstreamHubBaseUrl=http://192.168.10.48:8080
local Gun peers=[]
```

### 2. Add `EmbeddedHubRelayClient`

Create a small server-side client used only by embedded nodes:

```text
src/node-app/embedded-hub-relay-client.ts
```

Responsibilities:

- POST/refresh room membership:
  `POST /api/chatrooms/:id/members`
  `PATCH /api/chatrooms/:id/members/:userId`
- Fetch room membership snapshots:
  `GET /api/chatrooms/:id/members`
- Use existing signaling endpoints for WebRTC:
  `/api/p2p/signaling`
- Use existing relay fallback endpoints:
  `/api/p2p/conversation-relay/:conversationId`
- Optionally publish signed discovery metadata once the discovery API is
  formalized.

It must reject any attempt to send data classified by
`classifyServerConnectorPath()` as app/private or legacy public app state.

### 3. Bridge Room Membership Into Local Gun

The local embedded node serves the unchanged SPA. The SPA still calls
same-origin APIs on `127.0.0.1:<localPort>`.

For room membership:

1. Renderer calls local `POST /api/chatrooms/:id/members`.
2. Local server writes local Gun for local UI responsiveness.
3. Local server mirrors the membership event to `upstreamHubBaseUrl`.
4. Local server periodically fetches hub membership and merges relay metadata
   into local Gun under the existing membership paths.

This preserves the current UI's same-origin assumption while making the hub
see only membership metadata.

### 4. Keep Browser Dev And Production Paths Unchanged

Browsers loaded directly from the dev/prod server still use same-site web/API
and Gun URL derivation:

- dev/LAN web `http://<host>:3001` -> hub/API `http://<host>:8080`
- production `https://www.iinpublic.com` -> `https://www.iinpublic.com/gun`
- embedded UI `http://127.0.0.1:<appPort>` -> local node only

Only embedded-node upstream sync changes.

## Acceptance Tests

### Unit

- `resolveUpstreamHubPeers()` returns `[]` for embedded explicit-relay mode.
- `EmbeddedHubRelayClient` refuses app/private classifications such as:
  `talks/*`, `conversations/*`, `pairConversations/*`, `pairTalkResponses/*`,
  `incomingTalksByUser/*`, `ownerIncomingTalkIndex/*`.
- It allows only explicit relay metadata operations.

### Integration

- Embedded local `POST /api/chatrooms/global/members` mirrors to the hub.
- Hub `/api/chatrooms/global/members` lists the embedded user.
- A `talks/<id>` write on an embedded local Gun does not appear in the hub
  export snapshot or through a hub-connected Gun reader.

### E2E

- `tests/e2e/native-app/02-browser-and-desktop-app-presence.spec.ts` remains
  green after removing the embedded generic Gun peer.
- `tests/e2e/native-app/03-two-desktop-apps-presence.spec.ts` remains green.
- `scripts/relay-only-verification/run.js` becomes a stable pass in an
  environment where Gun websocket handshakes are reliable.

## Migration Steps

1. Add explicit relay config while leaving old generic peer mode behind an env
   fallback for one release.
2. Implement `EmbeddedHubRelayClient` with membership mirroring first.
3. Disable generic hub Gun peers for native E2E and keep native E2E green.
4. Extend the relay client to signaling/discovery endpoints as needed.
5. Remove the generic embedded hub Gun peer fallback.
6. Re-run the relay-only verification harness and document the result.

## Recommendation

Implement option B from `docs/TODO.md`: replace the generic hub Gun peer link
with explicit REST relay metadata. It is less clever than a Gun packet filter,
but it gives the product a crisp security boundary: the public hub can only
receive data through routes whose payloads are already classified as relay-only.
