# IinPublic Identity & Key Architecture TODO

## Goal

Replace the original **one SEA public/private keypair for everything** design with a layered identity architecture.

Original:

```text
SEA keypair
   ├── user/social identity
   ├── device identity
   ├── network identity
   └── authentication
```

Target:

```text
Social Identity Key
        |
        | authorizes
        v
Device Key(s)
        |
        | authenticates connection
        v
Session Key(s)
```

Keep the system as simple as possible while separating things that have different lifetimes and security requirements.

## 1. Keep SEA/GUN as the Social Identity Layer

- [ ] Continue using the existing SEA public/private keypair as the primary **pseudonymous social identity**.
- [ ] Define `SEA public key = IinPublic Identity ID`.
- [ ] Do **not** equate an SEA identity with a physical person.
- [ ] Allow one human to create multiple completely independent SEA identities.
- [ ] Ensure independent identities contain no common public identifier that automatically links them.
- [ ] Keep SEA private keys in secure local device storage whenever possible.
- [ ] Never transmit an SEA private key over the network.
- [ ] Use SEA signatures for Talks and identity-management events.

Conceptually:

```text
SEA Identity X
   |
   +-- Talks
   +-- profile
   +-- reputation
   +-- device authorizations
   +-- identity relationships
```

## 2. Introduce Separate Device Keys

- [ ] Give every IinPublic installation/device its own public/private keypair.
- [ ] Generate the device private key locally.
- [ ] Never send the device private key elsewhere.
- [ ] Use Android Keystore / Apple Keychain or hardware-backed key storage where available.
- [ ] Treat a device key as **device/installation identity**, not social identity.
- [ ] Allow one SEA identity to authorize multiple device keys.

Example:

```text
             SEA Alice
                 |
        +--------+--------+
        |                 |
    iPhone key        Android key
        |                 |
     iPhone            Android
```

## 3. Define a Simple IinPublic Device Certificate

Do not initially introduce X.509 or a conventional CA.

An IinPublic certificate can simply be a SEA-signed object.

- [ ] Define an `ADD_DEVICE` certificate/event.

Example:

```text
DeviceAuthorization {
    type: "ADD_DEVICE"
    identity: AliceSEApublicKey
    devicePublicKey: B
    issued: ...
    sequence: ...
}
```

Then:

```text
signature =
    SEA.sign(DeviceAuthorization, AliceSEAprivateKey)
```

- [ ] Other peers verify the certificate using the SEA public key they already associate with Alice.
- [ ] A certificate itself is public and may be freely copied.
- [ ] Require the device to separately prove possession of its private key.

Key principle:

```text
Certificate proves:

    Alice authorized B_pub.

Challenge/handshake proves:

    Current peer possesses B_priv.
```

Both are required.

## 4. Implement New-Phone Pairing

Example flow:

```text
NEW ANDROID                     OLD IPHONE

generate B_priv/B_pub

display QR containing B_pub
       ---------------------->

                              scan QR

                              confirm with user

                              SEA.sign(
                                  ADD_DEVICE(B_pub),
                                  Alice_priv
                              )

       <----------------------
       device certificate
```

- [ ] Generate the new device keypair entirely on the new phone.
- [ ] Transfer only the new **public key** to the old phone.
- [ ] Ask Alice to explicitly authorize the new device.
- [ ] Old phone signs the authorization.
- [ ] Transfer the resulting certificate back to the new phone.
- [ ] Never transfer Alice's existing private key merely to add a device.

Core rule:

> **Private keys don't move between devices; trust moves between public keys using signatures.**

## 5. Authenticate Devices During P2P Connections

- [ ] Do not trust discovery advertisements as authentication.
- [ ] Treat mDNS/BLE/Nearby/etc. as discovery only.
- [ ] Authenticate after discovery.
- [ ] Use a standard authenticated transport/handshake where practical.
- [ ] Consider libp2p + Noise rather than implementing a custom secure transport.
- [ ] Consider libp2p PeerID as the network/device identity.
- [ ] Keep libp2p PeerID separate from SEA social identity.

Potential architecture:

```text
IinPublic
   |
   +-- SEA/GUN
   |      social identity
   |      Talks
   |      signed identity events
   |
   +-- Device identity
   |      per-device key
   |
   +-- libp2p / Noise
          authenticated connection
          encryption
          PeerID
          transport
```

## 6. Add Challenge/Proof-of-Possession

If not already provided adequately by the transport handshake:

- [ ] Bob generates a cryptographically random nonce.
- [ ] New device signs the nonce with its device private key.
- [ ] Bob verifies it with the certified device public key.

```text
Bob                         Alice Android

random nonce
    ----------------------->

                         Sign(B_priv, nonce)

    <-----------------------
        signature
```

Bob establishes:

```text
Alice SEA key
     |
     | signed certificate
     ↓
Android B_pub
     |
     | verifies challenge
     ↓
current connection
```

Do not design a homemade challenge protocol if Noise/libp2p already provides the necessary authenticated handshake.

## 7. Distinguish ADD_DEVICE From REPLACE_KEY

These are different operations.

### ADD_DEVICE

```text
              Alice
             /     \
        iPhone    Android
```

- [ ] Existing devices remain valid.
- [ ] New device becomes another authorized device.

### REPLACE_KEY

```text
Alice key A
     |
     | signed replacement
     ↓
Alice key B
     |
     ↓
Alice key C
```

- [ ] New key becomes the current continuation.
- [ ] Old key is retired for future operations.
- [ ] Preserve the signed historical chain.

## 8. Add Device Revocation

- [ ] Define `REVOKE_DEVICE`.
- [ ] Allow Alice to revoke a lost/stolen/sold phone without destroying Alice's social identity.
- [ ] Reject future authentication from revoked device keys.
- [ ] Preserve old Talks/messages signed while the device was authorized.

Example:

```text
Alice
 ├── iPhone       VALID
 ├── Android      REVOKED
 └── Mac          VALID
```

## 9. Separate Physical Device From Identity

A phone is never itself an identity.

If Alice gives an old phone to Charlie:

- [ ] Revoke Alice's device key.
- [ ] Erase Alice's private material from the phone.
- [ ] Charlie generates completely new keys.
- [ ] Do not transfer Alice's private keys to Charlie.

```text
BEFORE

Alice
  |
Device B
  |
Phone


AFTER

Charlie
  |
Device C
  |
same physical Phone
```

## 10. Model Identity Changes as Signed Events

Instead of mutating identity records, consider an append-only identity-event graph.

Possible events:

```text
CREATE_IDENTITY
ADD_DEVICE
REVOKE_DEVICE
REPLACE_KEY

LINK_IDENTITY
UNLINK_IDENTITY

MERGE_IDENTITY
UNMERGE_IDENTITY

TRANSFER_IDENTITY

RETIRE_IDENTITY
```

- [ ] Every event specifies the relevant public keys.
- [ ] Every event is signed by the key(s) authorized to perform it.
- [ ] Store events in GUN.
- [ ] Preserve old events rather than rewriting history.
- [ ] Use sequence numbers and/or predecessor hashes to prevent ambiguous ordering.

General principle:

> **History is immutable; future control is mutable.**

## 11. Support Multiple Independent Identities

Alice may intentionally have:

```text
Identity X
    SEA_X keypair

Identity Y
    SEA_Y keypair
```

- [ ] Generate completely independent keys.
- [ ] Do not publicly connect them.
- [ ] Do not reuse common persistent discovery identifiers.
- [ ] Do not use a publicly visible common master key.
- [ ] Treat reputation as belonging to the cryptographic identity rather than the presumed human.

Bob may privately infer that X and Y belong to the same person, but IinPublic should not automatically make that relationship authoritative.

## 12. Support LINK Without MERGE

Define two separate concepts.

### LINK

```text
X <------> Y
```

Means:

> "I choose to disclose that I control both identities."

But profiles, Talks and reputations remain separate.

### MERGE

```text
X ----\
       ---> Z
Y ----/
```

Means:

> "These identities should operate as one identity going forward."

- [ ] Require appropriate signatures from both identities.
- [ ] Preserve old X/Y Talks under their original signatures.
- [ ] Do not rewrite historical content as authored by Z.

## 13. Support UNLINK / UNMERGE

This conversation identified a legitimate reason for this: ownership/control can change.

Example:

```text
Past:

Alice X <====> Alice Y


Future:

Alice X             Charlie Y
```

- [ ] Allow an existing relationship to end for future operations.
- [ ] Do not attempt to erase the historical cryptographic evidence that X and Y were once linked.
- [ ] Clearly distinguish "formerly linked" from "currently linked."

Important:

> Unmerge can end the relationship, but it cannot restore the original anonymity once other peers learned that X and Y were related.

## 14. Consider Identity Transfer

If Alice intentionally transfers an identity rather than merely giving away hardware:

```text
Y old key
    |
    | signed TRANSFER
    ↓
Y new key controlled by Charlie
```

- [ ] Never transfer the old private key.
- [ ] Generate a new controller key.
- [ ] Old key signs authorization of the new key.
- [ ] Retire the old key after transfer.
- [ ] Preserve historical attribution.

Thus peers can distinguish:

```text
Identity Y

2025        Alice controlled Y
2026        Alice controlled Y
----------- TRANSFER -----------
2027        Charlie controls Y
```

## 15. Protect Identity Unlinkability

Because IinPublic uses proximity/discovery mechanisms, metadata can accidentally correlate pseudonyms.

Investigate:

- [ ] Rotating BLE/discovery identifiers.
- [ ] MAC/address privacy implications.
- [ ] IP-address correlation.
- [ ] Device fingerprint leakage.
- [ ] App/version fingerprint leakage.
- [ ] Presence/timing correlation.
- [ ] Location correlation.
- [ ] Whether the same libp2p PeerID should ever be reused across separate SEA identities.

Strong default:

```text
Identity X               Identity Y
    |                         |
different SEA keys       different SEA keys
different device IDs     different device IDs
different discovery IDs  different discovery IDs

       no protocol-level link
```

## 16. Keep "Official IinPublic App" Authentication Separate

Do not confuse:

```text
"Is this Alice?"
```

with:

```text
"Is this official IinPublic software?"
```

They are separate security questions.

Potential future layers:

```text
User identity
     |
     +-- SEA signatures

Device identity
     |
     +-- device keys / PeerID

Software authenticity
     |
     +-- Apple App Attest
     +-- Google Play Integrity
     +-- release signing
```

- [ ] Do not make social identity depend on Apple/Google attestation.
- [ ] Consider app attestation later as optional additional trust metadata.
- [ ] Allow compatible open-source/community implementations without breaking social identity verification.

## 17. Session Encryption Should Be Another Layer

Do not use the permanent SEA identity private key as the encryption key for every connection.

Target:

```text
SEA Identity Key
      |
      | authorizes
      ↓
Device Key
      |
      | authenticates
      ↓
Ephemeral Session Keys
      |
      ↓
encrypted P2P traffic
```

- [ ] Use Noise/libp2p or another established protocol to generate ephemeral session keys.
- [ ] Require forward secrecy.
- [ ] Don't invent custom session cryptography.

Consider libsignal later if IinPublic needs sophisticated asynchronous encrypted messaging, offline delivery and Double Ratchet semantics.

## 18. Recovery Is Still Unresolved

This needs a separate design.

Problem:

```text
Alice loses:
    iPhone
    Android
    all private keys
```

Without some recovery mechanism, nobody can cryptographically prove that a newly generated identity is the old Alice.

Evaluate later:

- [ ] Recovery seed.
- [ ] Offline backup.
- [ ] Trusted devices.
- [ ] Trusted contacts.
- [ ] Social recovery.
- [ ] Optional IinPublic.com recovery service.
- [ ] Threshold/multi-party recovery.

Do not solve this casually; recovery can undermine the entire identity security model.

---

# Recommended First Implementation

Do **not** implement everything above immediately.

Start with four layers:

```text
                 IinPublic
                    |
          +---------+---------+
          |                   |
     SEA Identity          Device Key
          |                   |
       Persona             Installation
       Talks                  |
       Profile                |
       Reputation             |
          |                   |
          +---- authorizes ---+
                              |
                              ↓
                       Noise / libp2p
                              |
                        Session Keys
```

### Phase 1

- [ ] Keep current SEA/GUN identity implementation.
- [ ] Document that SEA key means **social/pseudonymous identity**, not physical device.
- [ ] Introduce one independent device keypair per installation.
- [ ] Securely store both private keys.
- [ ] Define `ADD_DEVICE`.
- [ ] Define `REVOKE_DEVICE`.
- [ ] Implement QR-based new-device authorization.
- [ ] Authenticate device ownership during connection.
- [ ] Investigate libp2p/Noise before implementing custom transport authentication.

### Phase 2

- [ ] Implement `REPLACE_KEY`.
- [ ] Implement identity/device event history in GUN.
- [ ] Design lost-device handling.
- [ ] Design key rotation.

### Phase 3

- [ ] Implement `LINK_IDENTITY`.
- [ ] Implement `UNLINK_IDENTITY`.
- [ ] Implement `MERGE_IDENTITY`.
- [ ] Implement `UNMERGE_IDENTITY`.
- [ ] Consider `TRANSFER_IDENTITY`.

### Phase 4

- [ ] Design recovery.
- [ ] Evaluate Apple/Google app attestation.
- [ ] Evaluate libsignal if private asynchronous messaging requires it.
- [ ] Perform a full privacy review of discovery metadata and identity correlation.

# Core Design Rules

1. **SEA key = pseudonymous social identity.**
2. **Device key = one installation/device.**
3. **Session key = one secure communication context.**
4. **Private keys stay on the device that generated them whenever possible.**
5. **Public keys are connected through signed certificates/events.**
6. **Discovery is not authentication.**
7. **A physical human is not a protocol identity.**
8. **Different pseudonyms should be cryptographically unlinkable by default.**
9. **Historical signed facts remain verifiable even after relationships change.**
10. **Use established cryptographic protocols rather than implementing cryptography ourselves.**

The biggest change from the original IinPublic design is therefore:

```text
OLD

one SEA keypair
      ↓
everything


NEW

SEA identity key
      ↓
social identity
      ↓
authorizes
      ↓
device key(s)
      ↓
authenticate
      ↓
ephemeral session keys
```

This adds some complexity, but puts the complexity at explicit boundaries. It should ultimately make multiple devices, lost phones, pseudonyms, key rotation, identity linking/unlinking, and secure P2P connections substantially easier to reason about.