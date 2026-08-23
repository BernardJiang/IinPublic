# Device Sync Data Inventory and Manifest v1

This document freezes the browser-portable part of WP5. The executable contract is
`src/shared/device-sync-contract.ts`; platform transports and local-custody adapters consume that
contract but do not change its categories or integrity rules.

## Transferable categories

| Category | Convergence | Required preservation |
| --- | --- | --- |
| Profile and Q&A | Mutable, versioned | Stable record ID, original author, timestamps, version |
| Contacts | Mutable, versioned | Stable contact ID and local relationship provenance |
| Blocks | Tombstoned | Block and unblock/delete history so removed state cannot return |
| Talks | Tombstoned | Original author/signature plus retraction tombstones |
| Answer memory | Mutable, versioned | Private exact-answer memory and answer preferences |
| Conversations | Mutable, versioned | Stable conversation ID and participant metadata |
| Messages | Immutable union | Original message ID, author, signature, and timestamp |
| Attachments | Immutable union | Content ID/hash and encrypted bytes that are still locally available |
| Preferences | Mutable, versioned | Only cross-installation user preferences |
| Identity events | Immutable union | Original signed link/unlink/history events |
| Sync tombstones | Tombstoned | Deletion markers and their causal/checkpoint metadata |

An immutable union deduplicates by stable ID. A mutable-versioned category retains the winning
version under the later convergence rules. A tombstoned category carries deletion/retraction state
as data; import must never resurrect a record merely because an older copy arrives later.

## Never transferred

Passwords, password verifiers, password-derived keys, SEA/device private keys, local custody and
wrapping secrets, OS permission state, device labels, connectivity configuration, caches, neighbor
hints, logs, and diagnostics are device-local. The manifest builder rejects these categories at
runtime even if an untyped caller tries to select one.

## Manifest and acknowledgement rules

An identity link is not transfer consent. Before the public importer accepts a bundle, both
installations must sign the same random authorization ID, device pair, migration/continuous mode,
and canonical category set. The manifest commits to that authorization ID. Either installation can
publish a later signed revocation; a valid unilateral revocation stops future imports before any
record is written.

Manifest v1 binds the source and target installation public/encryption keys, selected categories,
authorization ID, snapshot or delta mode, predecessor checkpoint for deltas, every item hash, per-category count and
hash, an aggregate items hash, and a deterministic checkpoint ID. The source installation signs
the whole canonical manifest.

The complete signed manifest and records are then SEA-ECDH encrypted to the target installation's
`epub`; only endpoint routing keys remain outside the ciphertext. The receiver verifies endpoint
binding, the source signature, original record signatures when present, every item hash, aggregate
hash, category count/hash, and checkpoint ID. The safe receiver API creates its target-signed
acknowledgement only after all verification passes. Reordering records is harmless; changing a
record, count, endpoint, checkpoint, or signature fails closed.

The companion importer persists progress after each item, resumes across a fresh importer instance,
deduplicates repeated imports, enforces ordered delta predecessors, re-encrypts records under the
receiving installation's local custody, and withholds acknowledgement for ambiguous conflicts.
The portable core now prepares and drains live deltas from an offline-capable outbox, but it does
not yet wire an actual peer route, present the conflict UI, or connect the legacy erase dialog to a
verified transfer. Hardware lifecycle and real-phone coverage are explicitly outside this
browser-portable contract.

## Continuous delta outbox

After an acknowledged initial snapshot, each direction keeps an independently encrypted local
outbox. Every local change receives a monotonic sequence. A flush persists the exact signed delta
bundle and its high-water sequence before attempting transport; the transport sees only a sealed
payload. Route failure leaves that bundle in flight. If the receiver imported it but its
acknowledgement was lost, the sender retries the identical checkpoint and the receiver returns its
stored acknowledgement without duplicating records.

On acknowledgement, the sender reloads its outbox before committing so changes queued during the
network call are retained. It removes only entries through the acknowledged high-water mark, uses
that checkpoint as the predecessor for the next delta, and repeats until the queue is empty. At
that point the sender's last acknowledged checkpoint equals the receiver's imported source head.
Repeated mutable updates to one record within a batch collapse to the latest sequence; later
batches still follow the normal convergence and conflict rules. A valid sync revocation stops the
flush before sealing or delivery and does not delete either installation's received/local data.

Transfer encryption is authorization-scoped. The SEA ECDH shared secret is fed through WebCrypto
HKDF-SHA-256 with the random authorization ID as salt and the ordered source/target device pubs as
context. Replacing a stopped or revoked authorization therefore derives different sync key
material even when the two installations retain the same long-lived v1 SEA keys. The envelope
binds the visible authorization ID back to the signed encrypted manifest and fails decryption if
that routing context is changed.

Ambiguous same-version edits and immutable ID collisions never choose a silent winner. Import
persists the conflict and withholds acknowledgement. The conflict dialog shows category, stable ID,
versions, and timestamps without rendering private payloads; no choice is preselected, every item
must be decided, and the choices are persisted under receiving-device custody. A resumed import
rechecks those decisions and acknowledges only after the chosen records are durable.
