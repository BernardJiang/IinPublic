# Phase D — DHT Bootstrap Design Document

> **Status:** Design / pre-implementation  
> **Date:** 2026-06-06  
> **Spec reference:** SRS v4.5 §19.12 Phase D, §16 item 12, §21.4  
> **Depends on:** Phase C (relay-only hub, already shipped)

---

## 1. Goal

Supplement hub-based peer discovery so the IinPublic network continues to function when `www.iinpublic.com` is fully offline.  After Phase D, a new user can join the network through any live super-peer or DHT entry point — no central server required at runtime.

Phase D does **not** change message routing, talk delivery, conversation storage, or match logic.  It is a pure _peer-discovery_ upgrade.

---

## 2. Context: current discovery (Phase C)

```
New User
  │
  ▼ HTTP
Hub (www.iinpublic.com)
  │  GET /api/peers  →  list of 20–50 live super-peers
  ▼
WebRTC / Gun mesh
```

**Single point of failure:** if the hub is down, new users cannot bootstrap.  Existing users with cached peer lists continue to function, but no new sessions can form.

---

## 3. Phase D target state

```
New User
  │
  ├─ Try hub (fast path, still supported)
  │    GET /api/peers
  │
  └─ If hub unreachable: DHT cold-start
       Known super-peer address (DNS / baked into client binary)
             ↓
       Bootstrap Request  →  Peer List (20–50 entries)
             ↓
       Connect To Peers (WebRTC / Gun)
             ↓
       Join DHT (publish PeerID → network address)
             ↓
       Publish Presence (encrypted location blob)
```

The hub becomes optional infrastructure.  Its `/api/peers` endpoint is retained as a fast-path convenience.

---

## 4. Bootstrap service API

The bootstrap service is a lightweight HTTP(S) endpoint that any super-peer or dedicated node can run.  It is intentionally narrow — it stores **only** peer-discovery data.

### 4.1 Endpoints

#### `GET /bootstrap/peers`

Returns a random sample of recently-active peers.

**Response**
```json
{
  "peers": [
    {
      "peerId": "QmXxx...",
      "addresses": ["wss://peer1.example.com:4444", "/ip4/1.2.3.4/tcp/4001"],
      "lastSeen": "2026-06-06T10:00:00Z"
    }
  ],
  "ttlSeconds": 300
}
```

**Constraints**
- Returns at most 50 peers.
- Only peers seen within the last `ttlSeconds` seconds are included.
- The service does **not** authenticate callers.

#### `POST /bootstrap/announce`

A peer registers itself as reachable.

**Request body**
```json
{
  "peerId": "QmXxx...",
  "addresses": ["wss://peer1.example.com:4444"],
  "pubkey": "<SEA hex public key>",
  "sig": "<SEA signature over {peerId, addresses, timestamp}>",
  "timestamp": "2026-06-06T10:00:00Z"
}
```

**Validation**
- `sig` must verify against `pubkey` over the canonical `{peerId, addresses, timestamp}` JSON.
- `timestamp` must be within ±5 minutes of server wall-clock time (replay defence).
- `peerId` must equal `derivePeerIdFromPub(pubkey)` (binding peer address to identity).

**Response**
```json
{ "ok": true, "ttlSeconds": 300 }
```

#### `GET /bootstrap/lookup/:userId`

Resolves a `userId` (Gun public key hex) to the most recently announced peer addresses.

**Response**
```json
{
  "userId": "abc123...",
  "peerId": "QmXxx...",
  "addresses": ["wss://peer1.example.com:4444"],
  "lastSeen": "2026-06-06T10:00:00Z"
}
```

Returns 404 when no record exists.

### 4.2 TypeScript interface

```typescript
// src/shared/dht-bootstrap.ts (to be created in Phase D implementation)

export interface BootstrapPeer {
  peerId: string;
  addresses: string[];           // multiaddr or wss:// strings
  lastSeen: string;              // ISO-8601 UTC
}

export interface BootstrapAnnouncement {
  peerId: string;
  addresses: string[];
  pubkey: string;
  sig: string;
  timestamp: string;
}

export interface UserPeerRecord {
  userId: string;                // SEA pub key hex
  peerId: string;
  addresses: string[];
  lastSeen: string;
}

/** Client-side interface for the bootstrap service. */
export interface DhtBootstrapClient {
  getPeers(): Promise<BootstrapPeer[]>;
  announce(announcement: BootstrapAnnouncement): Promise<void>;
  lookupUser(userId: string): Promise<UserPeerRecord | null>;
}
```

---

## 5. libp2p vs Kademlia evaluation

Both are candidates for the DHT layer.  The table below compares them against IinPublic's specific requirements.

| Criterion | libp2p | Kademlia (vanilla) | Notes |
|---|---|---|---|
| **Browser runtime** | ✅ `@libp2p/browser` bundle exists | ⚠️ Requires custom implementation | libp2p has first-class browser support |
| **Gun.js integration** | ⚠️ Parallel to Gun; requires bridging | ⚠️ Same | Neither integrates natively with Gun |
| **Bundle size** | ~250 KB min (with WebRTC transport) | ~20 KB (hand-rolled) | libp2p is significantly heavier |
| **NAT traversal** | ✅ Built-in (Circuit Relay, hole-punch) | ❌ Manual | libp2p advantage |
| **Identity binding** | ✅ PeerID = hash of public key | ⚠️ Manual | libp2p natively binds peerId to key |
| **Maintenance** | ✅ Active (Protocol Labs) | ⚠️ Self-maintained | |
| **IinPublic SEA keys** | ⚠️ Different key format (Ed25519 vs Gun SEA ECDSA) | ✅ Key-agnostic | Mapping required for libp2p |
| **Incremental adoption** | ⚠️ Large surface to add at once | ✅ Bootstrap-only; add incrementally | |
| **Spec alignment** | §19.12, §21.4 | §19.12 | |

### Recommendation

**Start with a minimal Kademlia-inspired bootstrap service** (the API in §4 above) without adopting the full libp2p stack.  This delivers Phase D goals (hub-independent discovery) at low integration cost.  The full libp2p DHT can replace it in Phase D+ if the network needs true distributed peer routing at scale.

**Decision criteria for upgrading to libp2p:**
- Network reaches > 10,000 concurrent peers and a central bootstrap list becomes a bottleneck.
- NAT traversal success rate (measured) drops below 80% and Circuit Relay is needed.
- Key management can be bridged (SEA → Ed25519 wrapper or dual-key support).

---

## 6. UserID → address lookup interface

The lookup interface is intentionally simple so it can be swapped between a hub-hosted HTTP store and a full DHT without changing call sites.

```typescript
/**
 * Resolves a UserID (Gun SEA public key hex) to the user's current
 * network address(es).
 *
 * Implementations:
 *   HubLookupClient    — HTTP GET /bootstrap/lookup/:userId  (Phase D)
 *   KademliaDhtClient  — DHT key lookup                     (Phase D+)
 *   LibP2PDhtClient    — libp2p DHT                         (future)
 */
export interface UserAddressLookup {
  /** Returns null when the user is unknown or offline. */
  lookupUser(userId: string): Promise<UserPeerRecord | null>;
}
```

Call sites in the web client that need to initiate a direct P2P session will depend on `UserAddressLookup` (injected at construction time) rather than any concrete client.

---

## 7. Migration path from Phase C

| Step | Change | Risk |
|---|---|---|
| **D-1** | Deploy bootstrap service alongside existing hub (hub hosts `/bootstrap/*`) | Low — additive only |
| **D-2** | Super-peers POST `/bootstrap/announce` on startup and every 60 s | Low |
| **D-3** | Web client tries hub peer list first, falls back to bootstrap if hub unreachable | Low — fallback path |
| **D-4** | Web client POSTs `/bootstrap/announce` on first successful Gun connect | Low |
| **D-5** | Bake 3–5 known super-peer addresses into client binary as cold-start fallback | Low — DNS-based |
| **D-6** | Hub's `/api/peers` endpoint delegates to bootstrap service internally | Low — transparent |
| **D-7** | Hub can be taken offline without breaking peer discovery | Goal achieved |

No Gun schema changes or message-format changes are required.

---

## 8. Data storage

The bootstrap service stores only peer-announcement records.  Recommended storage: in-memory LRU (capacity 10,000 peers) with a 5-minute TTL.  No disk persistence required — the DHT is self-healing: peers re-announce on restart.

For high-availability deployments, a Redis-backed store can be substituted without changing the API.

---

## 9. Security considerations

- **Sybil resistance**: Announcements are signed; `peerId` is bound to `pubkey` via `derivePeerIdFromPub`.  A malicious actor can announce a valid peer address only if they hold the corresponding private key.
- **Replay attacks**: The `timestamp` field (±5 min window) prevents re-use of captured announcements.
- **Amplification**: The bootstrap service returns at most 50 peers per request; no reflection/amplification surface.
- **Enumeration**: The `/bootstrap/peers` endpoint returns a random sample, not a full dump.  Full enumeration requires many requests and is rate-limited.
- **Privacy**: Peer addresses are published voluntarily by the peer itself.  Location data is not stored by the bootstrap service.

---

## 10. Open questions

1. **Key bridge**: How to map Gun SEA (ECDSA) keys to libp2p PeerID format (Ed25519) if the full libp2p stack is adopted in Phase D+?  Options: separate Ed25519 key stored in Gun user space, or a deterministic derivation from the SEA private key.

2. **Super-peer incentives**: What motivates a peer to run a bootstrap node?  (No answer required for Phase D — the hub and a handful of volunteer super-peers are sufficient initially.)

3. **DHT key space**: Should the DHT key for a user record be `sha256(pubkey)` or `derivePeerIdFromPub(pubkey)` (currently FNV-based)?  A SHA-256 key aligns with libp2p and Kademlia conventions but requires updating `derivePeerIdFromPub`.

---

## 11. Files to create (Phase D implementation)

| File | Purpose |
|---|---|
| `src/shared/dht-bootstrap.ts` | `DhtBootstrapClient`, `UserAddressLookup` interfaces, `BootstrapPeer` types |
| `src/server/routes/bootstrap-routes.ts` | `GET /bootstrap/peers`, `POST /bootstrap/announce`, `GET /bootstrap/lookup/:userId` |
| `src/server/services/bootstrap-store.ts` | In-memory LRU peer store with TTL eviction |
| `src/web/services/web-bootstrap-client.ts` | `DhtBootstrapClient` impl backed by hub `/bootstrap/*` |
| `src/test/unit/dht-bootstrap.test.ts` | Unit tests for announcement validation, TTL eviction, lookup |
| `src/test/integration/bootstrap-routes.test.ts` | HTTP-level integration tests for all three endpoints |
