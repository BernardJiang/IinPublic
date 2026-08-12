# Gun-authoritative store and transfer inventory

**Decision date:** 2026-08-11  
**Authority:** `docs/specs/iinpublic-technical-specifications.md` §29  
**Machine-readable contract:** `src/shared/authoritative-data-invariants.ts`

## Locked decisions

1. The local Gun graph is the target authority for every durable application object. A relay, mailbox, transport frame, browser storage entry, or memory cache is never the final acknowledged copy.
2. SEA public keys identify users. Peer IDs, radio IDs, IP addresses, and connection IDs are replaceable transport bindings only.
3. Keep the version-1 JSON `P2PMeshFrame` control envelope during migration. Retain ping/pong, offers, requests, receipts, retractions, discovery gossip, and bounded forwarding. Full `talk-body` frames remain a mixed-version compatibility path until Gun-native sync reaches parity.
4. A delivery receipt means the receiver has committed the object to local Gun and verified a read-back. A mailbox HTTP acceptance or transport ACK alone is not a delivery receipt.

## Durable object inventory

| Data class | Visibility | Current authority / compatibility copies | Target Gun soul |
|---|---|---|---|
| Authored Talk | room-public offer; author-owned body | `myAuthoredTalks` localStorage; legacy `talks/<id>` relay graph | `users/<authorSeaPub>/talks/<talkId>` |
| Received/accepted Talk | user-private | `myReceivedTalks` localStorage; PeerMeshService memory body cache | `users/<ownerSeaPub>/receivedTalks/<authorSeaPub>/<talkId>` |
| Incoming Talk cluster | user-private | local Gun `ownerIncomingTalkIndex/<userId>/<identityKey>` | `users/<ownerSeaPub>/incomingTalkClusters/<identityKey>` |
| Me Q&A | user-private; separately publishable projection later | localStorage answer history/preferences | `users/<ownerSeaPub>/meQa/<questionCid>` |
| Chatbot memory/provenance | user-private | `exactChatbotMemory`, typed preferences, and templates in localStorage | `users/<ownerSeaPub>/chatbotMemory/<questionCid>/<contextHash>` |
| Pair response | pair-private, SEA-encrypted | local Gun response records; encrypted mailbox compatibility envelope | `pairs/<pairId>/talkResponses/<talkId>/<responseId>` |
| Conversation/message | pair-private, SEA-encrypted | local Gun plus `myConversations` compatibility index and encrypted mailbox | `pairs/<pairId>/conversations/<conversationId>/messages/<messageId>` |
| Chatroom | room-public | local/relay Gun graph | `rooms/<roomId>` |
| Reputation input | user-private until a signed public projection is defined | derived/local browser state | `users/<ownerSeaPub>/reputationInputs/<eventId>` |
| Talk outcome ledger | user-private | `talkLedger` localStorage | `users/<ownerSeaPub>/talkLedger/<entryKind>/<entryId>` |

The table describes current debt, not permission to add more browser-only authority. Exact current file/key references are enforced conceptually by the shared manifest and will be migrated repository by repository.

## Transfer-path inventory

| Path | Current role | Durable authority? | Migration treatment |
|---|---|---:|---|
| Gun Wire over WebSocket | graph synchronization through configured Gun peers | only after local Gun commit | preferred common sync path where IP connectivity exists |
| libp2p mesh stream `/iinpublic/mesh/1.0.0` | signed JSON mesh frames, direct or relayed | no | retain control frames; carry Gun-compatible deltas only if WebSocket cannot use the route |
| WebRTC mesh fallback | compatibility `P2PMeshFrame` session | no | retain until mixed-version exit gate passes |
| Peer forwarding | TTL/seen-set forwarding of eligible signed frames | no | enabled by default, policy-controlled; forwarding never changes SEA authorship |
| Encrypted mailbox | store-and-forward ciphertext when live delivery fails | no | delete envelope only after receiver local-Gun commit and successful handler |
| IPFS/libp2p blocks | large attachment bytes addressed by CID | no for application metadata | Gun stores CID, encryption metadata, ownership, and receipt state |

## Visibility and authorization

- **Room-public:** authenticated room members may read and subscribe; only the SEA author/room authority may write its owned records. Offers expose minimum discovery metadata, not private answer bodies.
- **User-private:** only the owning SEA identity/device graph may read, write, or subscribe. Ordinary room or peer subscriptions must never traverse these souls.
- **Pair-private:** only the two participant SEA identities may request ciphertext or subscribe. Writes retain the original SEA author signature; intermediaries may store/forward ciphertext but cannot authorize or rewrite it.

Multi-device access under one person identity remains unresolved. These rules apply to the current device-based SEA identity until that decision is made.

## Migration and rollback flags

The implementation milestones will introduce these independently testable flags (names locked here; defaults change only after parity):

- `IINPUBLIC_GUN_TALK_REPOSITORY`: dual-write authored and accepted Talks to local Gun; compatibility reads remain enabled.
- `IINPUBLIC_GUN_NATIVE_SYNC`: prefer selective Gun synchronization; accept legacy body frames.
- `IINPUBLIC_LEGACY_TALK_BODY_FRAMES`: send full body frames for old peers or rollback; initially on.
- `IINPUBLIC_MESH_FORWARDING`: permit bounded third-party forwarding; default on, with later per-interface policy.

Mixed versions advertise capabilities. A new receiver accepts and persists an old full-body frame to Gun before ACK. A new sender uses the legacy body path for a peer that does not advertise Gun-native sync. Rollback disables the first two flags without deleting either Gun or compatibility data. No migration step rewrites content IDs.

## Known sole-copy hazards to remove

- `src/web/services/web-talk-service.ts`: `myAuthoredTalks` and `myReceivedTalks` can be the only Talk-body copies.
- `src/web/services/peer-mesh-service.ts`: the in-memory Talk body map can be the only immediately reachable copy on a mesh-only path.
- `src/web/services/web-talk-ledger-store.ts`: `talkLedger` is browser-only.
- `src/web/ui/answer-preferences-storage.ts` and `answer-history-storage.ts`: Me Q&A/chatbot memory is browser-only.
- `src/web/ui/ui-manager.ts`: `myConversations` remains a browser compatibility index and must be rebuildable from Gun.

