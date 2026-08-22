# IinPublic Identity & Key Architecture TODO

**Status:** implementation started 2026-08-21. WP0 semantics are accepted in
`docs/architecture/identity-v1-semantics.md`; WP1, WP3, and WP4 are complete. WP2 passed its staged
security-design gate on 2026-08-22 and its reviewed KDF, authenticated-envelope, transactional
storage, and crash-safe set/change coordinator are implemented; production lifecycle integration,
remove-password, and GUI work remain. Native/app
distribution extensions and WP5 onward remain. The architectural sections below describe the
long-term direction; the final section, **Actionable Implementation Plan**, defines the
dependency-ordered delivery plan.

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
    capabilities: [
        "SYNC_DATA",
        "REVOKE_DEVICE",
        "ADD_REPLACEMENT_DEVICE",
        "ROTATE_CONTROLLER"
    ]
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

Capabilities must be explicit and least-privileged. A device authorized only for transport or data
sync must not automatically gain authority to replace the identity controller. Granting one device
`ROTATE_CONTROLLER` makes continuity possible after every other device is lost, but also means that
compromise of that device can take over the identity. The Settings flow must explain this tradeoff.

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

### 4.1 Migrate historical data to a new phone

After the link is mutually approved, Alice may choose **Move data to this phone**. Linking and data
transfer are separate approvals: linking alone must not copy private data.

```text
NEW ANDROID                         OLD IPHONE

linked and mutually verified

request encrypted migration
       -------------------------->

                                    build local snapshot
                                    encrypt for Android

encrypted snapshot + manifest
       <--------------------------

verify item hashes and counts

signed import acknowledgement
       -------------------------->

                                    send final delta

verify migration complete on both phones
```

- [ ] Transfer all supported history that is actually present on the old phone: profile and Q&A,
      contacts, blocks, Talks, answer memory, conversations/messages, attachments, preferences,
      signed identity events, and sync tombstones.
- [ ] Preserve original record IDs, author public keys, signatures, timestamps, and provenance.
- [ ] Historical content authored by the old phone remains authored by its original public key; do
      not rewrite or re-sign history as if the new phone created it.
- [ ] Encrypt the transfer end to end for the receiving device and authenticate both endpoints.
- [ ] Re-encrypt imported private data for the new phone's local custody after verification.
- [ ] Transfer an initial snapshot, then a final delta so changes made during migration are not
      lost.
- [ ] Make interrupted transfers resumable and idempotent.
- [ ] Compare a signed manifest, per-category counts, and content hashes before declaring success.
- [ ] Never erase or revoke the old phone automatically. Offer those actions only after the new
      phone has acknowledged and locally verified the complete import.
- [ ] State the honest limit: data already pruned, deleted, or never stored on the old phone cannot
      be reconstructed by migration.

### 4.2 Keep two linked phones synchronized

If Alice keeps both phones, she may separately enable **Sync data with this device** on both. Sync is
bidirectional, encrypted, and limited to explicitly selected data classes.

- [ ] Default eligible shared data to profile/Q&A, contacts, blocks, authored Talks, answer memory,
      conversation history, attachments, and identity-event history.
- [ ] Keep passwords, password-derived keys, SEA/device private keys, local custody secrets, OS
      permissions, device names, connectivity settings, caches, and diagnostics device-local.
- [ ] Treat immutable histories as a signed union, deduplicated by stable record ID/content hash.
- [ ] Propagate authenticated updates and tombstones rather than deleting history silently.
- [ ] Define deterministic conflict handling for mutable data. Preserve both concurrent versions
      when automatic resolution could lose user intent, and show a resolve-conflict action.
- [ ] Queue outgoing changes locally while the other phone is offline and resume when an
      authenticated route becomes available.
- [ ] Do not require a durable central server. Any relay may carry encrypted envelopes but must not
      receive plaintext or the data-encryption key.
- [ ] Show last successful sync, pending item count, errors, **Sync now**, **Pause sync**, and
      per-category controls in Settings.
- [ ] Revoking/unlinking stops future sync and rotates any shared sync authorization/key material.
      It cannot remotely delete data that the other phone already received.

### 4.3 Replace an old phone after verified migration

When Alice is intentionally replacing a phone:

1. Link and approve the new phone.
2. Migrate and verify all locally available history.
3. Catch up the final delta.
4. If the target continuity model is implemented, make the new phone a recovery-capable controller.
5. Revoke the old device authorization or unlink the old per-installation identity.
6. Erase the old phone only after Alice separately confirms the destructive action on that phone.

The GUI must not describe this as complete until data verification and the chosen identity-control
transition have both succeeded.

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

### 8.1 Losing the original phone

Example:

```text
Alice first created her social identity on iPhone A.
iPhone A later authorized Android B.
iPhone A is now lost; Android B still works.
```

The original public key is immutable. Alice cannot change it, derive its private key, or recreate
that private key from the public key. What Android B can do depends on the authorization model that
was established before the loss.

**Under the current per-installation SEA-link model:**

- Android B has its own SEA identity and can preserve all history previously synchronized to it.
- Android B can publish its own `UNLINK_IDENTITY` / lost-device notice.
- Android B cannot sign new Talks as iPhone A's SEA public key.
- Android B cannot rotate iPhone A's SEA key or recover data that never synchronized from A.
- If A's private key is unavailable, A's public identity becomes permanently read-only. Its old
  signatures and public history remain verifiable.

**Under the target delegated-device model:**

If iPhone A previously issued Android B a verified authorization containing the required recovery
capabilities, Android B may:

1. Publish `REVOKE_DEVICE(iPhoneADeviceKey)`.
2. Stop future authentication and synchronization from the lost phone.
3. Authorize a replacement phone with `ADD_REPLACEMENT_DEVICE`.
4. Publish `REPLACE_KEY` / `ROTATE_CONTROLLER` when the approved policy permits it.
5. Continue from the original public key as the stable historical identity root while peers follow
   the signed controller/authorization chain.

```text
Original social public key
        |
        | previously authorized recovery capability
        v
Android B device key
        |
        +-- revoke lost iPhone A
        +-- authorize replacement phone C
        +-- rotate current controller when permitted
```

- [ ] Define whether one recovery-capable device is sufficient or whether a threshold/offline
      recovery key is required.
- [ ] Let the user see which devices have ordinary sync authority and which have identity-recovery
      authority.
- [ ] Require an explicit warning before granting single-device recovery authority: compromise of
      that device may allow identity takeover.
- [ ] Do not imply that the optional local password can recover the lost iPhone; it protects only
      the installation on which it was set.
- [ ] Preserve the original public key and historical signatures even when the current controller
      changes.

Practical product rule:

> If Alice retains at least one previously authorized recovery-capable device, she can revoke the
> lost phone and continue the original identity through a signed control chain. If she loses every
> recovery-capable device and user-held recovery method, the original public key becomes permanently
> read-only.

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

They are separate security questions. A third question is also separate:

```text
"Is this device and operating system trustworthy?"
```

The desired layers are:

```text
User identity
     |
     +-- SEA signatures

Device identity
     |
     +-- device keys / PeerID

Software authenticity
     |
     +-- official release signing identity
     +-- Apple App Attest / Google Play Integrity
     +-- short-lived IinPublic software credential
```

- [ ] Do not make social identity depend on Apple/Google attestation.
- [ ] Allow compatible open-source/community implementations without breaking SEA identity,
      message verification, or baseline interoperability.
- [ ] Let official IinPublic builds prove their publisher/build status in a way that a fork compiled
      from the same open-source repository cannot forge.
- [ ] Do not treat a genuine device verdict as proof that the user is honest, that the device is
      uncompromised, or that content is trustworthy.

### 16.1 Trust labels

Use precise labels rather than one ambiguous `verified` flag:

- **Official IinPublic — verified:** fresh platform evidence matched an approved IinPublic
  application ID and signing identity, and the credential is bound to the current device key.
- **Official IinPublic beta — verified:** the same, but from an explicitly approved beta/TestFlight
  channel.
- **Officially signed — attestation unavailable:** the installed artifact reports an approved
  signing identity locally, but no fresh remotely verifiable platform evidence is available. This
  is weaker and must not appear to peers as fully verified.
- **Community build:** a compatible build signed by another publisher. It may identify its publisher
  key, but it does not carry IinPublic's official credential.
- **Development build:** debug/development signing or an approved internal development environment.
- **Unverified build:** evidence is missing, expired, malformed, or unsupported. This is not by
  itself proof of malicious behavior.

Community developers can copy the source, protocol, package-like display text, and visual badge.
They cannot obtain **Official IinPublic — verified** without the approved platform signing identity
and a valid credential from the IinPublic software-attestation verifier.

### 16.2 Official release signing is the first boundary

**Android:**

- [ ] Define the official application package name(s).
- [ ] Pin the SHA-256 digest/lineage of the official Android app-signing certificate, not the upload
      certificate or a developer debug certificate.
- [ ] Sign every official APK/AAB through the controlled release process.
- [ ] Keep signing secrets outside the repository and ordinary developer workstations.
- [ ] Publish the expected package name, signing-certificate digests, release channel, version, and
      artifact hashes in a separately signed official release manifest.
- [ ] Plan signing-key rotation using Android's supported signing lineage and overlapping verifier
      configuration rather than replacing the pin without a signed transition.

Android requires installed APKs to be signed, and Google Play uses the app signing key to sign
distributed APKs. The public certificate fingerprint is therefore an important official-publisher
identifier; the upload key is not the installed-app identity.

**Apple iOS:**

- [ ] Define the official Apple Team ID/App ID prefix and explicit bundle identifier(s).
- [ ] Use Apple Distribution signing for App Store/TestFlight releases.
- [ ] Keep Apple account credentials and distribution signing access restricted and auditable.
- [ ] Register production and beta channels separately even if both are signed by the same team.
- [ ] Publish the expected Team ID, bundle identifier, release channel, version/build number, and
      artifact/store metadata in the official release manifest.

Apple code signing identifies the development team and application bundle, but network peers must
not trust values merely reported by the app itself. Runtime attestation supplies the external proof.

**Current repository baseline (reviewed 2026-08-15):**

- Android namespace/application ID is `com.iinpublic.app` in `android/app/build.gradle`.
- iOS bundle ID is `com.iinpublic.app` in `platforms/ios/IinPublic.xcodeproj/project.pbxproj` and
  `platforms/ios/Info.plist`.
- The iOS project currently has an empty `DEVELOPMENT_TEAM` and development-signing configuration;
  an official Apple Team/App ID and distribution setup have not yet been pinned in the repository.
- The repository does not yet define the approved Android production app-signing certificate
  digest/lineage or an Apple App Attest entitlement/environment.

Before implementation, confirm that `com.iinpublic.app` is the permanent official identifier on
both platforms, then commit the public identifiers/certificate digests and signed-key registry. Keep
only private signing material and service credentials outside the repository.

### 16.3 Android runtime authentication

For Google Play installations, use the Play Integrity Standard API at security-sensitive moments:

1. The verifier issues a fresh challenge for a specific operation.
2. The Android app hashes a canonical binding containing the challenge, operation, device public
   key, session identifier, and credential request ID into `requestHash`. Do not put private or
   sensitive plaintext into `requestHash`.
3. Google returns an integrity token.
4. The trusted verifier decodes/verifies the token and checks:
   - expected request package name;
   - exact `requestHash` and freshness;
   - `appRecognitionVerdict == PLAY_RECOGNIZED`;
   - expected package name, version policy, and official app-signing certificate digest;
   - only the minimum device-integrity signals required by the chosen policy.
5. The verifier issues a short-lived **Official IinPublic Android** credential bound to the device
   public key and operation/session scope.

The app-recognition verdict answers whether Google Play recognizes the signing certificate and
binary. Licensing/account and device-integrity verdicts are separate signals and must not be
silently treated as social identity or user reputation.

**Official Android builds distributed outside Google Play:** Play Integrity may not return
`PLAY_RECOGNIZED`. If direct/sideloaded official distribution is supported, define a second,
explicitly weaker or alternative proof path:

- Prefer server-verified hardware-backed Android Key Attestation that binds a challenge and a
  device key to the application's package/signing-certificate identity where supported.
- Verify the certificate chain, Google attestation root, hardware security level, and revocation
  status outside the app.
- Otherwise label the build **Officially signed — attestation unavailable** locally and do not send
  peers a full official-runtime credential.

Never let a client assert `official=true` based only on `PackageManager`, an embedded constant, an
APK hash it reports itself, or a copied package name.

### 16.4 Apple iOS runtime authentication

Use Apple's App Attest service for App Store/TestFlight-capable iOS builds:

1. On each installation, generate a unique App Attest key. Apple keeps the private key protected and
   returns a key identifier used by the app.
2. The verifier issues a fresh, one-time challenge of sufficient entropy.
3. Bind the challenge, operation, device public key, session identifier, and credential request ID
   into the App Attest `clientDataHash`.
4. Send the attestation object to the verifier; never trust validation performed only inside the
   app.
5. The verifier validates the Apple certificate chain and nonce, the RP ID derived from the
   approved App ID prefix/Team ID plus bundle identifier, the production/development environment,
   and the attested public key.
6. For later sensitive requests, validate App Attest assertions and their monotonic counter against
   fresh challenges.
7. Issue a short-lived **Official IinPublic iOS** credential bound to the IinPublic device public
   key.

App Attest is not supported in every environment. Reinstallation, device migration, or restoration
may require a new App Attest key. Unsupported or temporarily unavailable attestation must degrade to
**attestation unavailable**, not `malicious`, and must not destroy or replace the SEA identity.

### 16.5 IinPublic software-attestation verifier

Platform evidence is designed to be verified outside the potentially modified client. Add a narrow
IinPublic-operated verifier that performs only software-authenticity work; it is not an identity
account, password-reset, data-sync, or social-data service.

After verifying Apple/Google evidence, it signs:

```text
OfficialBuildCredential {
    schemaVersion: ...
    credentialId: ...
    platform: "android" | "ios"
    applicationId: packageName | teamId.bundleId
    releaseChannel: "production" | "beta"
    appVersion: ...
    buildNumber: ...
    signingIdentityHash: ...
    devicePublicKey: ...
    evidenceType: "play-integrity" | "android-key-attestation" | "apple-app-attest"
    evidenceTier: ...
    issuedAt: ...
    expiresAt: ...
    verifierKeyId: ...
    verifierSignature: ...
}
```

- [ ] Bind every credential to the IinPublic device public key; presenting it also requires proof of
      possession during the authenticated session.
- [ ] Make credentials short-lived and operation/session scoped where practical. Do not accept a
      copied credential without a fresh device-key challenge.
- [ ] Publish verifier public keys and a signed verifier-key rotation/revocation chain.
- [ ] Store only the minimum evidence state required for validation, replay defense, App Attest key
      counters, rate limiting, and audit. Never store passwords, SEA private keys, conversations,
      Talks, contacts, profiles, or synchronized history.
- [ ] Do not place raw Apple/Google tokens, stable device serials, account identifiers, or unnecessary
      integrity signals in the peer-visible credential.
- [ ] Define retention and deletion for verifier metadata and document the privacy tradeoff of
      binding attestation to a device public key.
- [ ] If the verifier is unavailable, continue normal open-protocol operation with the correct
      lower-confidence label.

### 16.6 Peer verification and network policy

A peer that receives an official-build credential verifies:

1. The verifier signature and key status.
2. Credential expiry and expected schema.
3. Device public-key equality with the authenticated device binding.
4. Fresh proof that the peer possesses that device private key.
5. Platform/application/channel policy for the requested operation.

The default network policy remains **Allow compatible builds; show authenticity status**. Users may
optionally require a fresh official-build credential for high-risk actions such as granting identity
continuity authority or private-data synchronization. Ordinary public Talks and SEA signature
verification must remain interoperable with community builds unless a user explicitly chooses a
stricter policy.

Do not:

- add official-build status to social credit or reputation;
- claim an official build proves the person behind it;
- publish platform attestation as part of the user's permanent public profile;
- reuse software-attestation keys as SEA, device-authorization, or session-encryption keys;
- allow a community build to be labeled malicious merely because it is not signed by IinPublic;
- hide that an official build may still contain bugs or run on a compromised device.

### 16.7 Official platform references

- Android: [Sign your app](https://developer.android.com/studio/publish/app-signing),
  [Play Integrity overview](https://developer.android.com/google/play/integrity/overview),
  [Play Integrity verdicts](https://developer.android.com/google/play/integrity/verdicts), and
  [hardware-backed key attestation](https://developer.android.com/privacy-and-security/security-key-attestation).
- Apple: [Certificates overview](https://developer.apple.com/help/account/certificates/certificates-overview),
  [Establishing your app's integrity](https://developer.apple.com/documentation/DeviceCheck/establishing-your-app-s-integrity),
  and [Validating apps that connect to your server](https://developer.apple.com/documentation/devicecheck/validating-apps-that-connect-to-your-server).

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

## 18. Recovery Is Intentionally Unavailable in v1

This needs a separate design.

Problem:

```text
Alice loses:
    iPhone
    Android
    all private keys
```

Without some recovery mechanism, nobody can cryptographically prove that a newly generated identity is the old Alice.

IinPublic cannot recover or reset a local identity password and cannot recreate lost private keys.
Support staff, a stage name, a public key, and a linked device are not recovery mechanisms.

Any future recovery feature must remain explicitly optional and user-controlled. It must be designed
separately from password protection and must not weaken the default local-only custody promise.
Possible future research:

- [ ] Recovery seed.
- [ ] Offline backup.
- [ ] Trusted devices.
- [ ] Trusted contacts.
- [ ] Social recovery.
- [ ] Threshold/multi-party recovery.

An IinPublic-operated reset of the local identity password remains impossible because IinPublic does
not hold that password or private key. A separately enrolled optional authentication service may
help authorize a replacement controller, but only when the identity delegated that recovery
authority and registered authenticators before the loss.

Do not solve this casually; recovery can undermine the entire identity security model.

## 19. Optional IinPublic.com Authentication and TechSupport Assistance

### 19.1 Feasibility summary

An optional authentication service is technically feasible, but the word **authentication** must be
scoped carefully.

| Capability | Feasibility | Security/product cost |
|---|---|---|
| Verify official Android/iOS builds and issue short-lived credentials | High | Small verifier service; Apple/Google dependency |
| Challenge a known SEA/device key and countersign proof of possession | High | Minimal public-key registry and availability dependency |
| Coordinate device linking, revocation, and sync consent | High | Metadata/privacy and denial-of-service risks |
| Optional passkey-backed IinPublic.com authentication | Medium-high | Creates a real server account record and recovery surface |
| Continue an identity using pre-enrolled recovery authority | Medium | Requires new event-verification rules and strong abuse controls |
| TechSupport-assisted recovery with enrolled factors | Medium | Operator security, auditing, delays, and social-engineering risk |
| Recover the original key or local password after all factors are lost | Impossible | Neither TechSupport nor the server has the missing secret |
| Declare a claimant to be Alice based only on a support conversation | Not trustworthy | Centralized impersonation/social-engineering risk |

The recommended model is **optional and additive**. Users who never enroll continue using IinPublic
entirely through local keys. The service must not become required for SEA signatures, public Talks,
ordinary P2P communication, or community-build interoperability.

### 19.2 Four service modes

#### Mode 0 — Local-only default

- No IinPublic.com authentication account.
- No email, phone, passkey, or server recovery record.
- Local password remains unresettable.
- Device linking and sync use device-to-device signatures.
- Loss of all authorized keys ends control of the identity.

#### Mode 1 — Verification-only service

The service:

- verifies Apple/Google software-attestation evidence;
- issues `OfficialBuildCredential` records;
- issues fresh challenges and verifies SEA/device proof of possession;
- optionally relays signed pairing/revocation events;
- stores no recovery factors and has no authority to replace an identity controller.

This mode is highly feasible and is the recommended first server capability.

#### Mode 2 — Optional IinPublic.com authentication

The user explicitly creates an authentication relationship with `iinpublic.com` and registers one
or more passkeys/security keys. A passkey is a public-key credential: the authenticator retains the
private key, while the server stores the credential ID/public key and verifies signatures over fresh
server challenges.

This service authenticates access to the optional IinPublic.com relationship; it does not decrypt
the local SEA identity, reset the local identity password, or automatically control the social key.

#### Mode 3 — Optional continuity/recovery authority

The identity signs an enrollment event that gives a specific IinPublic.com recovery key narrowly
defined authority to countersign a future controller replacement after the approved recovery policy
succeeds. Without that prior signed delegation, the server and TechSupport have no recovery power.

Mode 3 is the highest-risk mode and must be separately enabled after Mode 2. Do not hide it behind a
generic **Create account** checkbox.

### 19.3 Separate server account from SEA identity

Use a random, non-guessable authentication handle rather than stage name, email, or SEA public key
as the login name. An enrolled record may contain only what its selected mode requires:

```text
OptionalAuthEnrollment {
    schemaVersion: ...
    enrollmentId: random opaque identifier
    identityPublicKey: ...
    authorizedDevicePublicKeys: [...]
    webAuthnCredentials: [credentialId, publicKey, signCount, metadata]
    recoveryCodeHashes: [...]                 // only if enabled
    notificationAddresses: [...]              // only if explicitly enabled
    recoveryPolicy: "none" | "device+passkey" | "two-factors" | "support-assisted"
    delegatedServerRecoveryKey: ...            // only Mode 3
    enrolledAt: ...
    identitySignature: ...
    serverCountersignature: ...
}
```

- [ ] Never store the local identity password, SEA/device private keys, recovery seed, decrypted
      data, sync archive, conversations, contacts, Talks, or profile history.
- [ ] Encrypt sensitive server metadata at rest and separate lookup identifiers from public keys
      where practical.
- [ ] Make email/phone optional and use them only for notifications or an explicitly chosen
      recovery factor.
- [ ] Let the user download a signed enrollment receipt that states the exact server authority.
- [ ] Let the user revoke the enrollment/server recovery authority from any still-authorized device.
- [ ] Publish signed server-key rotation and revocation records.

### 19.4 Enrollment flow

Enrollment must happen while Alice still controls an authorized identity/device key:

1. Settings → **Optional IinPublic.com authentication** explains local-only versus server-assisted
   modes.
2. Alice selects Mode 2 or Mode 3 and the precise recovery policy.
3. The server issues a fresh challenge.
4. Alice's current authorized device signs the canonical enrollment request.
5. Alice registers at least two independent authenticators for recovery-capable enrollment—for
   example, a platform passkey plus a hardware security key or offline saved recovery code.
6. The server verifies the device signature, WebAuthn ceremonies, official-build policy if required,
   and acknowledgement of the privacy/authority warning.
7. The server countersigns the enrollment; the signed receipt is stored both locally and by the
   service.
8. Every linked device is notified of the new server authority at the next authenticated sync.

The server-generated WebAuthn challenges must be random, short-lived, single-use, and checked
exactly on return. Use a reviewed WebAuthn server library rather than implementing attestation and
assertion parsing from scratch.

### 19.5 Normal authentication

For ordinary optional-service use:

1. The service issues a one-time challenge scoped to the operation.
2. The device signs the challenge with its authorized device key.
3. High-risk operations additionally require a passkey assertion with user verification.
4. The server verifies credential origin/RP ID, challenge, signature, user-verification flags,
   counters where applicable, device authorization, revocation status, and request freshness.
5. The server returns a short-lived, scoped authorization token or signs the requested public
   identity-management event.

Do not use a long-lived bearer token as a substitute for fresh device/passkey proof on recovery,
device addition, sync authorization, or server-authority changes.

### 19.6 Recovery with TechSupport

TechSupport may guide and audit recovery, but it cannot create cryptographic proof from a
conversation alone.

Recommended flow:

```text
Alice on replacement phone
        |
        | opens built-in TechSupport → Identity access help
        v
TechSupport explains local-password and key-loss limits
        |
        | creates opaque recovery case + fresh server challenge
        v
Alice proves enrolled factors
        |
        +-- surviving authorized device signature, or
        +-- passkey/security key, and
        +-- second approved factor/recovery code when policy requires
        v
Automated verifier validates enrollment and factors
        |
        | optional human review / two-operator approval
        v
Cooling period + notifications to every enrolled channel/device
        |
        v
Server signs scoped controller-replacement authorization
        |
        v
new phone generates its own keys; old device is revoked
```

TechSupport responsibilities:

- explain what can and cannot be recovered;
- help locate enrollment receipts, passkeys, recovery codes, or a surviving device;
- open a case without asking the user to paste passwords, private keys, seeds, or raw recovery
  secrets into chat;
- deliver server-signed challenge/status messages;
- review rate-limit, device-loss, and fraud signals under a documented policy;
- require a second operator for exceptional recovery approval;
- provide a complete signed audit receipt and notify every enrolled channel/device;
- help the user create a new unrelated identity when recovery requirements cannot be satisfied.

TechSupport must not:

- reset or learn the local identity password;
- request the SEA private key, device private key, seed, or full exported custody package;
- accept stage name, profile knowledge, contacts, prior messages, caller voice, or possession of an
  email inbox alone as conclusive cryptographic identity proof;
- sign a controller replacement from the ordinary TechSupport DM or announcement key;
- bypass the enrolled recovery policy because the claimant appears convincing;
- tell a user that unsynchronized local data can be recovered from IinPublic.com.

If Alice has no enrolled factor, no surviving authorized device, and no delegated server recovery
authority, TechSupport must refuse continuity of the original identity. It may help Alice create a
new identity, but must not issue an authoritative **same Alice** statement.

### 19.7 TechSupport and server key separation

The existing TechSupport design has DM and announcement trust anchors. Neither is appropriate for
authentication or recovery. Add independent roles:

```text
TechSupport DM key
    support conversation only

TechSupport announcement key
    public operational notices only

IinPublic auth-verifier key
    short-lived authentication/build credentials only

IinPublic recovery-authority key
    countersigns pre-delegated controller replacement only

TechSupport operator keys
    scoped case actions; never root recovery signing
```

- [ ] Keep verifier/recovery keys in an HSM or managed KMS with non-exportable signing where
      practical.
- [ ] Require capability-scoped operator credentials, short sessions, phishing-resistant
      authentication, and no shared TechSupport private key for administrative actions.
- [ ] Require two-person approval for manual recovery exceptions and server-recovery-key changes.
- [ ] Log operator, policy version, evidence classes, decision, and signatures in an append-only
      audit/transparency log without recording private user content.
- [ ] Make the client verify that every TechSupport recovery message is both a valid support message
      and contains a separately valid auth-service status/decision signature.
- [ ] Treat compromise of the TechSupport DM system as insufficient to recover or take over an
      identity.

### 19.8 Recovery policy and abuse controls

- [ ] Recommend at least two independent authenticators for every recovery-enabled enrollment.
- [ ] Issue a high-entropy saved recovery code for offline storage when the user chooses that method;
      store only a throttled one-way verification value and rotate it after use.
- [ ] Rate-limit enrollment lookup, factor verification, support cases, and recovery attempts.
- [ ] Add a cooling period for controller replacement unless a still-authorized device directly
      approves the action.
- [ ] Notify every enrolled device/address when an authenticator is added/removed, recovery begins,
      recovery completes, or server authority changes.
- [ ] Allow a still-authorized device to cancel a pending fraudulent recovery.
- [ ] Revoke old device/session/sync credentials after approved replacement while preserving
      historical signatures.
- [ ] Provide account/enrollment deletion that removes optional service records after required
      security/audit retention, without claiming to erase public signed history.
- [ ] Publish incident response for verifier/recovery-key compromise and fail closed on recovery
      signing while keeping ordinary P2P available.

### 19.9 Privacy and availability consequences

Optional authentication introduces metadata that the local-only model otherwise avoids. The user
must be told that IinPublic.com may learn that several device keys or passkeys belong to one optional
enrollment, when authentication/recovery occurred, IP/network metadata, and any notification address
the user supplied.

Mitigations:

- keep enrollment optional and disabled by default;
- minimize and expire challenge/session/IP logs;
- separate software-attestation, authentication, recovery, TechSupport case, and social-data stores;
- use opaque enrollment/case identifiers in TechSupport messages;
- never publish the optional authentication handle or notification address to GUN;
- export a user-readable audit history;
- let users revert to local-only mode by revoking server authority while they still control an
  authorized device.

An outage must affect only optional server operations. Existing local identity use, already linked
device sync, public-key verification, and ordinary P2P communication must continue. Recovery may
wait safely; it must never fail open because TechSupport or `iinpublic.com` is unavailable.

### 19.10 Recommended rollout

1. Ship the section 16 software-attestation verifier first.
2. Add device-key challenges and signed proof-of-possession receipts without account recovery.
3. Add optional passkey authentication for managing attestation/enrollment metadata.
4. Add self-service recovery only for users who pre-enrolled two independent factors and signed a
   narrow server-recovery delegation.
5. Add TechSupport guidance and case status before any manual approval capability.
6. Consider manual/two-operator recovery only after threat modelling, privacy/legal review,
   operational staffing, audit tooling, abuse testing, and an external security review.

This progression is feasible because each stage provides value without making the next stage
mandatory. Stop after step 2 or 3 if IinPublic wants official-build authentication and easier device
management without accepting centralized identity-recovery risk.

### 19.11 Authentication and recovery references

- [Web Authentication Level 3](https://www.w3.org/TR/webauthn-3/) — public-key credentials,
  relying-party challenges, user consent, and replay resistance.
- [NIST SP 800-63B](https://pages.nist.gov/800-63-4/sp800-63b.html) — authenticator binding,
  account recovery methods, recovery notifications, throttling, and risk-based recovery policy.

---

# Actionable Implementation Plan

Do **not** implement every event type in this document at once. Deliver a safe, understandable
identity-management surface first, then change the underlying key hierarchy in separately
reviewable steps.

## A. Review Findings and Required v1 Decisions

### A1. Resolve the current multi-device model before changing cryptography

There are currently two different models in project documentation:

1. This document's target model says one SEA social identity authorizes separate device keys.
2. The implemented Settings flow and technical specification currently give every installation a
   separate SEA identity, then use mutual `LINK_IDENTITY` attestations to say the installations are
   controlled together.

These are not interchangeable. If the SEA private key never moves, another device cannot author a
Talk as that same SEA identity unless verification rules are changed to accept an authorized device
signature. Conversely, two separately linked SEA identities remain two authors, not one identity.

**Recommended v1 decision:** preserve the current per-installation SEA identities and make linking
explicitly mean **"these pseudonymous identities are controlled together"**. Treat the link as a
user assertion, not proof of a legal or physical person. Introduce separate device and session keys
later without silently changing Talk authorship, contact identity, blocks, or reputation.

- [x] Record this as an approved architecture decision.
- [x] Use `LINK_IDENTITY` / `UNLINK_IDENTITY` for the existing per-installation SEA relationship.
- [x] Reserve `ADD_DEVICE` / `REVOKE_DEVICE` for the future model in which a social identity really
      authorizes a subordinate device key.
- [x] Do not label a linked set as a single cryptographic identity until authorship, reputation,
      contacts, blocks, and cluster governance are specified.
- [x] Reconcile this decision with `docs/specs/iinpublic-technical-specifications.md` section 10,
      `docs/TODO.md` item I, and `docs/iinpublic_discovery_design(3).md` before implementation begins.

### A2. Define what "same human" means in the product

The GUI may use familiar wording such as **Your devices**, but protocol and help text must remain
honest:

- A verified link proves that both private keys approved the relationship.
- It does not prove that both devices belong to one physical or legal person.
- Linking publicly correlates the pseudonymous identities.
- Unlinking ends the relationship for future decisions but cannot make observers forget the past
  link.
- Linking must never silently merge history, reputation, contacts, blocks, or private data.

### A3. Define the optional-password contract

Users do not need a username or password to install, open, or use IinPublic. Identity creation
remains automatic and local.

An optional password is only a **local identity lock**:

- [ ] It encrypts/protects the private identity material on this installation.
- [ ] It is never a server login and is never sent to IinPublic, GUN peers, analytics, logs, or crash
      reports.
- [ ] IinPublic stores neither the password nor a server-side reset secret.
- [ ] Each installation has its own password setting; linking devices does not synchronize it.
- [ ] A linked device cannot reveal or reset another device's password.
- [ ] Setting, changing, or removing the password must not change the SEA public identity.
- [ ] Changing or removing protection requires the current password.
- [ ] A forgotten password has no reset flow. The only local fallback is to erase this installation
      and create a new identity.
- [ ] Recovery is not implied by a linked device, an email address, a stage name, or the public SEA
      key.

The current transparent custody encryption uses a locally stored random device secret. That protects
against accidental plaintext exposure but is not the same as user password protection. A reviewed
custody-format migration is required; simply concatenating a password with the existing device
secret is not an acceptable design decision.

### A4. Decide link graph and removal semantics

Mutual pairwise attestations do not automatically define a manageable group. Before the UI claims
that several devices are one group, decide:

- [ ] Whether v1 lists only directly linked identities or computes a transitive connected cluster.
- [ ] Whether an alternative path can keep a device in a cluster after one link is revoked.
- [ ] Who may remove a lost device from a multi-device group.
- [ ] How an offline device learns about a revocation later.
- [ ] Whether removal affects only future grouping or also data-sync authorization.

**Recommended v1 rule:** display and manage direct, mutually verified links only. Do not create
transitive trust or silently publish links among every device in a group. Add cluster governance only
after its authorization and conflict rules are specified.

### A5. Separate identity continuity, data availability, and password recovery

These are three different promises:

- **Identity continuity:** a surviving authorized device may revoke a lost device and continue the
  original identity through a signed control chain.
- **Data availability:** a surviving device retains only the history that was synchronized to it.
- **Password recovery:** unavailable; one device can never reveal or reset another device's local
  password.

- [ ] Decide whether identity continuity is a required product guarantee or a later target.
- [ ] If required, define recovery capabilities and the one-device versus threshold authorization
      policy before presenting a linked phone as a recovery-capable device.
- [ ] Never use `data synchronized` as proof that the receiving device may control the original
      public identity.
- [ ] Never use `authorized to control identity` as permission to copy private data without a
      separate sync consent.
- [ ] Explain that a synchronized phone improves data availability but cannot reconstruct history
      that never reached it.

### A6. Define official-build authentication policy

- [ ] Approve the official Android package name, app-signing certificate digest/lineage, and Play
      Integrity project/configuration.
- [ ] Approve the official Apple Team ID/App ID prefix, bundle identifier, App Attest environment,
      and production/beta channel rules.
- [ ] Decide whether directly distributed Android builds are an official supported channel and what
      evidence tier they must satisfy.
- [ ] Approve the privacy/retention policy for the minimal software-attestation verifier.
- [ ] Decide which operations merely display an authenticity badge and which may optionally require
      an official credential.
- [ ] Keep **Allow compatible builds; show authenticity status** as the recommended default.
- [ ] Document that source availability permits forks but possession of IinPublic's platform signing
      identities and verifier key is what distinguishes official releases.

### A7. Decide whether IinPublic.com may hold optional recovery authority

- [ ] Approve Modes 0–3 from section 19 as distinct opt-in levels.
- [ ] Decide whether the product stops at verification/passkey authentication or permits controller
      recovery.
- [ ] Define the exact signed delegation an identity must publish before the server has any recovery
      authority.
- [ ] Require two independent factors for server-assisted recovery unless a surviving authorized
      device directly approves.
- [ ] Define cooling periods, notifications, cancellation, rate limits, retention, deletion, and
      transparency-log policy.
- [ ] Prohibit TechSupport-only judgment as sufficient proof of identity continuity.
- [ ] Approve independent verifier, recovery, TechSupport DM, announcement, and operator keys.
- [ ] Confirm that local-only operation remains the default and continues during service outages.

## B. Settings Information Architecture

Add one Settings menu row named **Identity & devices**. It should become the single user-facing home
for identity status, optional protection, and linked-device management. Keep **Erase this device** as
a separate danger-zone row so it cannot be confused with unlinking another device.

```text
Settings
  ├─ Profile
  ├─ Appearance
  ├─ …
  ├─ Identity & devices
  │    ├─ Your identity
  │    ├─ Identity protection
  │    ├─ This device
  │    └─ Linked devices
  ├─ Application authenticity
  ├─ Erase this device
  └─ Storage Inspector
```

The existing **Linked devices** page can be evolved into this section rather than adding a second,
competing device screen.

### B1. Your identity card

Show:

- Stage name and avatar.
- Short, human-checkable fingerprint derived from the SEA public key.
- **Copy full identity ID** action.
- Status: `Available on this device`, `Locked`, or `Needs attention`.
- Plain-language note: **"This identity is stored on this device. IinPublic does not keep an account
  copy on a server."**

Do not show the private key, raw recovery material, device secret, or full public key by default.

### B2. Identity protection card

When no password is configured:

```text
Identity password: Not set
IinPublic opens automatically on this device.
[Set identity password]
```

When protection is configured:

```text
Identity password: On
This device asks for your password before using your identity.
[Lock now] [Change password] [Remove password]
```

Do not use **Forgot password?** or **Reset password** labels because no reset exists. An explanatory
link may say **Why can't this password be reset?**

### B3. Required set-password warning

Before accepting a new password, show this warning prominently and require an unchecked
acknowledgement box:

> IinPublic does not store your password or identity on a recovery server. No one—including
> IinPublic—can recover or reset this password. If you forget it, this device's identity and local
> encrypted data may become permanently inaccessible. A linked device cannot unlock this one. You
> can erase this device and start over, but that will not recover the old identity.

The dialog contains:

- New password.
- Confirm password.
- Show/hide control.
- Local strength guidance without arbitrary composition rules.
- `I understand that this password cannot be recovered or reset` acknowledgement.
- **Set password** disabled until confirmation matches and acknowledgement is checked.
- Cancel, which leaves current custody unchanged.

### B4. Unlock screen

When a protected identity is locked:

- Show the stage name/avatar and short identity fingerprint so the user knows what is being
  unlocked.
- Provide password, show/hide, **Unlock**, and **Why can't this password be reset?**
- Keep retry feedback local and non-revealing.
- Apply a local increasing delay after repeated failures; do not destroy data automatically.
- Offer **Erase this device and start over** only through the existing typed-confirmation wipe flow.
- Never offer an email, support ticket, administrator override, security question, or remote reset.

### B5. This device card

Show:

- User-editable device name, for example `Alice's iPhone`.
- Platform/app type and app version.
- `This device` badge.
- Protection state: automatic, password locked, password unlocked, or OS-protected.
- Date identity was created on this installation.
- **Rename device** action.
- **Lock now** when a password is enabled.

Device names are labels, not authenticated hardware claims. Do not publish model, hostname, serial
number, MAC address, or other fingerprinting data merely to populate this screen.

### B6. Linked devices list

Each directly linked row shows:

- User-chosen device name or stage name.
- Coarse platform glyph (`phone`, `desktop app`, `browser`) without unnecessary fingerprinting.
- Short SEA fingerprint.
- Link state: `Waiting for approval`, `Linked`, `Revocation pending`, `Removed`, `Conflicted`, or
  `Invalid`.
- Linked date and, only if privacy-reviewed, coarse last-seen status.
- Overflow actions: **View identity ID**, **Rename locally**, **Remove link**, and **Report lost or
  stolen**.

Empty state:

```text
No linked devices
Link another device you control. Private keys stay on the device that created them.
[Link a device] [Enter or scan a code]
```

### B7. Pairing GUI

**Link a device** on device A:

1. Explain that the action connects two pseudonymous identities and may publicly reveal that they
   are controlled together.
2. Require confirmation before generating the payload.
3. Show a real QR code, a copyable code, expiry countdown, cancel, and regenerate action.
4. After device B responds, show B's name, platform, and short fingerprint on A.
5. Require a final **Approve this device** action on A. Do not complete merely because B entered the
   code.
6. Show `Linked` only after both signatures verify.

**Enter or scan a code** on device B:

1. Scan QR, paste, or type the code.
2. Reject malformed, expired, reused, self-link, and already-revoked payloads inline.
3. Show A's name and short fingerprint before B confirms.
4. Explain what is and is not shared.
5. Show `Waiting for approval on <device A>` until mutual verification finishes.

Before final confirmation, show:

> Linking can reveal that these identities are controlled together. Unlinking later stops future
> use of the link, but it cannot erase copies of the earlier signed relationship held by other
> peers.

### B8. Remove/revoke GUI

Use **Remove link**, not **Delete device**, for a normally available remote device. Confirmation copy:

> Remove the link to <device>? This stops future trust and synchronization through this link. It
> does not erase that device, delete its local data, recall public records, or hide the fact that
> the identities were linked in the past.

For **Report lost or stolen**:

- Explain that IinPublic will publish a signed revocation when a connection is available.
- Mark the device `Revocation pending` until the write is acknowledged locally and observed through
  the supported graph path.
- Stop new sync/authorization immediately on the initiating device.
- Explain that revocation cannot remotely wipe an offline device or destroy its private key.
- Preserve Talks and messages that were validly signed before revocation.

Removing the **current** device is not a row action. The user must use **Erase this device**.

### B9. Data migration and synchronization GUI

Each linked-device row has a **Data on this device** area, but data transfer remains off until both
devices approve it.

For a newly linked phone, offer two clear choices:

```text
How do you want to use this phone?

[Move my data to this phone]
Copy all supported history currently available on the old phone.

[Keep both phones in sync]
Copy the initial history, then synchronize approved changes both ways.

[Link only]
Record the relationship without copying private data.
```

Migration/sync setup shows the included categories and excludes device-local secrets. Both phones
must confirm the categories before transfer begins.

The progress screen shows:

- Preparing encrypted snapshot.
- Per-category item/byte progress.
- Initial snapshot verified.
- Catching up changes made during transfer.
- Final manifest verified on both devices.
- `Migration complete` or `Devices are in sync` only after acknowledgement.
- Resume, retry, cancel, and storage-insufficient states.

Linked-device row actions after setup:

- **Sync now**.
- **Pause sync** / **Resume sync**.
- **Choose data to sync**.
- **Move remaining data to this phone**.
- **View sync details**, including last success and pending changes.
- **Stop syncing**, which does not automatically unlink the identities.

For planned phone replacement, present an ordered checklist:

```text
1. Link new phone                         Complete
2. Copy and verify historical data        Complete
3. Grant continuity authority             Complete / Not supported
4. Revoke old phone                       Ready
5. Erase old phone                        Must be confirmed on old phone
```

For a lost original phone, the surviving phone shows separate results:

- `Identity control`: available only if it already has recovery capability.
- `Historical data`: available through the last successful sync.
- `Unsynchronized old-phone data`: unavailable and not recoverable by IinPublic.
- `Original phone password`: never available or resettable.

### B10. Application authenticity GUI

Add a separate Settings row named **Application authenticity**. Do not place the status inside the
user identity card because software publisher and social identity are independent.

Show:

- Status badge from section 16.1.
- Publisher: `IinPublic official`, community publisher fingerprint/name, or `Unknown`.
- Platform and distribution channel: Google Play, official Android direct distribution, App Store,
  TestFlight, development, or unknown.
- Application ID and shortened signing-identity fingerprint.
- App version/build number.
- Evidence type and last successful verification time.
- Credential expiry and **Verify again** action.
- **What this proves** and **What this does not prove** explanations.
- Link to the official release-manifest/fingerprint page.

Recommended copy for a verified build:

> This installation was verified as an official IinPublic build for this device. This verifies the
> application publisher and build channel. It does not verify the identity or trustworthiness of
> the person using it.

Recommended copy for a community build:

> This is a compatible community build, not an official IinPublic release. Its SEA identities and
> signed messages can still be valid. Review the publisher before granting device recovery or data
> synchronization access.

Recommended copy when attestation is unavailable:

> IinPublic could not obtain fresh platform authentication. This can happen on unsupported devices,
> direct installations, development builds, or while Apple/Google/IinPublic verification services
> are unavailable. It does not by itself mean the application is malicious.

On a linked-device row, show only a compact app badge with its freshness. Expanding the badge opens
the evidence details. Never display official-build status as a badge on the person's public profile,
credit, or reputation.

Add an advanced **Build trust policy**:

- `Allow compatible builds; show status` — default.
- `Warn before sensitive sharing with unverified builds` — recommended for sync/recovery grants.
- `Require official builds for data sync and identity recovery` — optional strict mode.

Changing this policy must not invalidate SEA signatures or erase existing local data.

### B11. Optional IinPublic.com authentication GUI

Add an **Optional IinPublic.com authentication** card beneath Application authenticity or as its own
Settings row. Default state:

```text
IinPublic.com authentication: Off
Your identity is controlled only by keys on your devices.
[Learn about optional authentication]
```

Enrollment presents the four modes with separate consent. Never use a single toggle that silently
grants recovery authority.

For Mode 2, show:

- enrolled passkeys/security keys with user-chosen names;
- last used time and **Remove authenticator**;
- add another passkey/security key;
- signed enrollment receipt and audit history;
- **Disable IinPublic.com authentication**.

For Mode 3, additionally show a prominent **Server-assisted identity continuity: On** warning,
recovery policy, cooling period, notification targets, saved recovery-code status, server recovery
key fingerprint, and **Revoke server recovery authority**.

Required warning:

> This optional service cannot recover your local password or decrypt your device. If you grant
> recovery authority, IinPublic.com may countersign a replacement identity controller only after
> your enrolled recovery policy succeeds. This creates a server trust and metadata relationship
> that local-only users do not have.

TechSupport → **Identity access help** starts with a diagnostic choice:

- Forgot this device's local password.
- Lost a device but still have another linked device.
- Lost every device but enrolled IinPublic.com authentication.
- Lost every device and did not enroll recovery.
- Suspect fraudulent recovery or device addition.

The resulting screen must give the correct outcome immediately. In particular, the first and fourth
choices must not promise a reset. Case status shows automated checks, waiting/cooling period,
operator review, notifications, approved/denied/cancelled, and a signed audit receipt.

## C. Minimum Data and Event Contract

Freeze canonical serialization and signature verification before wiring the GUI to real state.
Every event includes a schema version, event ID, issuer public key, target public key(s), issued time,
monotonic sequence or predecessor hash, and signature over the canonical payload.

### C1. Implement only in the approved delivery stage

- [ ] `LINK_IDENTITY_PROPOSED` or equivalent short-lived pairing record.
- [ ] Mutual `LINK_IDENTITY` attestations.
- [ ] `UNLINK_IDENTITY` revocation that supersedes an earlier attestation.
- [ ] Local device metadata record containing only privacy-reviewed display fields.
- [ ] Local password-protection metadata that reveals no password verifier to the network.
- [ ] Separate mutual `AUTHORIZE_DATA_SYNC` / `REVOKE_DATA_SYNC` consent or equivalent scoped
      authorization; an identity link alone is insufficient.
- [ ] Versioned encrypted sync manifest with source/target device keys, selected data classes,
      snapshot/checkpoint ID, item counts, content hashes, and acknowledgement signatures.
- [ ] Per-record origin/provenance plus update and tombstone events for convergence.
- [ ] Versioned `OfficialBuildCredential` schema, canonical serialization, verifier-key registry,
      expiry, revocation, and device proof-of-possession rules.
- [ ] Separate platform evidence adapters for Play Integrity, Android Key Attestation, and Apple App
      Attest; raw evidence is not a public identity event.
- [ ] Versioned optional-auth enrollment, server-authority delegation/revocation, authenticator
      binding/removal, recovery-request, recovery-cancellation, and controller-replacement schemas.
- [ ] WebAuthn challenge/session records with strict expiry and single-use enforcement.
- [ ] TechSupport recovery-case status envelope containing an opaque case ID and separately signed
      auth-service decision; support messages alone carry no recovery authority.

### C2. Explicitly defer

- `MERGE_IDENTITY` / `UNMERGE_IDENTITY`.
- `TRANSFER_IDENTITY`.
- Public identity-level aggregation or re-authoring of reputation, contacts, blocks, Talks, or Q&A
  across linked identities. Local encrypted replication under B9/WP5 is separate and preserves the
  original author/provenance.
- Public person-cluster identifier.
- After-the-fact server/email/TechSupport continuity when no recovery authority and factors were
  enrolled before key loss.
- Private-key export or transfer as part of ordinary device linking or data synchronization.
- Remote wipe guarantees.

## D. Delivery Work Packages

Each work package ends with documentation, unit tests, and user-visible acceptance tests. Do not
start a later package if an earlier decision gate is still open.

### WP0 — Approve semantics and reconcile specifications

**Outcome:** one authoritative vocabulary and no conflict between the architecture, product spec,
and current implementation.

- [x] Approve A1–A7 through the conservative v1 boundary in
      `docs/architecture/identity-v1-semantics.md`; unprovisioned optional services remain deferred.
- [x] Decide whether v1 links are direct-only (recommended) or transitive.
- [x] Define exactly what linking authorizes: display grouping only, data sync, or both.
- [x] Keep link, data-sync consent, and identity-recovery authority as independently revocable
      capabilities.
- [x] Decide whether one recovery-capable surviving device may continue the original identity.
- [x] Define how an unlink affects pending and completed data transfers.
- [x] Document that the current `identity-links` implementation is `LINK_IDENTITY`, not
      `ADD_DEVICE`.
- [x] Audit the existing recovery-package language. The current browser custody record is wrapped
      by a device-local secret, so documentation must not promise portable recovery unless a tested
      portable format is actually designed.
- [x] Update the technical specification, main TODO, discovery design, and test descriptions to use
      the approved terms.

**Done when:** a reviewer can answer who signs a Talk, what a link proves, what removal does, and
what happens after a forgotten password without consulting application code.

### WP1 — Identity & devices Settings shell

**Outcome:** users can inspect their identity and manage device labels without changing key
custody.

Likely implementation ownership:

- `src/web/ui/ui-manager.ts` — Settings row and section shell.
- `src/web/ui/linked-devices-dialog.ts` — evolve or replace with the consolidated page.
- `src/web/ui/ui-translations.ts` — all labels, warnings, and errors.
- A small local device-metadata service — privacy-minimized names/status.

- [x] Add **Identity & devices** to the Settings drill-down.
- [x] Add identity, protection-status, current-device, and linked-device cards.
- [x] Add copy fingerprint/ID and rename-current-device actions.
- [x] Preserve **Erase this device** as a separate danger-zone item.
- [x] Provide responsive, keyboard-accessible, screen-reader-labelled states.
- [x] Do not expose private material in DOM attributes, clipboard actions, logs, or Storage
      Inspector.

**Done when:** a password-free user can understand where the identity lives, copy the public ID,
rename the device, and reach linking and erase actions without seeing login terminology.

### WP2 — Optional local identity password

**Outcome:** a user can opt into local password protection without changing identity or network
behavior.

Likely implementation ownership:

- `src/web/services/web-gun-service.ts` — versioned custody migration and lock/unlock API.
- `src/shared/p2p-runtime.ts` — new custody-format types and invariants.
- New focused Settings/unlock UI modules instead of adding more logic to `ui-manager.ts`.

- [x] Write a short cryptographic design note and obtain security review before implementation.
      The staged-implementation review and remaining release conditions are recorded in
      `docs/security/local-identity-password-custody-review.md`.
- [x] Choose a memory-hard password KDF where platform support and reviewed dependencies permit;
      otherwise document and benchmark the approved fallback and parameters.
- [x] Define a versioned authenticated-encryption envelope and bind metadata as authenticated data.
- [ ] Migrate from transparent device-secret custody to password custody atomically: decrypt old,
      write and verify new, then remove old. Roll back safely on any failure. The isolated
      coordinator and interruption recovery are implemented and unit-tested; startup/service
      integration remains before this item can be marked complete.
- [ ] Never persist the plaintext password or decrypted SEA private pair.
- [ ] Keep decrypted private material in memory only while unlocked and clear references on lock,
      logout-equivalent lifecycle events, or process exit as far as the runtime permits.
- [ ] Add set, unlock, lock-now, change, and remove-password flows with the exact warning in B3.
- [ ] Require the current password for change/removal.
- [ ] Specify mobile background, desktop minimize/quit, browser refresh, and idle-lock behavior.
- [ ] Ensure failed attempts never corrupt or erase the custody record.
      Wrong-current-password and interrupted legacy-cleanup paths are covered at the coordinator
      layer; service/UI failure injection remains.
- [ ] Verify that public identity, Talks, reputation, and links remain unchanged after every custody
      migration.

**Done when:** fresh installs still open without a password; protected installs require the correct
password after a defined lock boundary; no reset mechanism exists; and setting/changing/removing a
password preserves the SEA public key byte-for-byte.

### WP3 — Complete real multi-device linking

**Outcome:** two installations produce mutually verified signed links through the Settings GUI.

Likely implementation ownership:

- `src/shared/identity-linking.ts` — canonical payloads, state machine, verification.
- `src/web/services/web-identity-link-service.ts` — real graph reads/writes and pending state.
- `src/web/app/app.ts` — service lifecycle wiring.
- Identity & devices UI — real QR, scan/enter, approval, pending, and error states.

- [x] Replace the placeholder QR block with a real encoded QR and add camera scanning where the
      platform permits.
- [x] Wire the existing service into the application; remove mock/local-success behavior.
- [x] Require explicit confirmation on both devices and verify both signatures.
- [x] Store pending operations with expiry and single-use replay protection.
- [x] Handle offline, cancellation, expiry, duplicate, self-link, replay, malformed signature, and
      unsupported schema cases.
- [x] Populate device rows from verified state, not an unauthenticated local display list alone.
- [x] Keep passwords, device secrets, SEA private keys, and decrypted private data out of the pairing
      payload.
- [x] State explicitly whether linking authorizes encrypted data transfer; default to **no** until a
      separate consent step succeeds.

**Done when:** two real installations link only after both approvals; either can independently
verify the relationship; a third party cannot forge it; and no private key moves between devices.

### WP4 — Removal, lost-device response, and convergence

**Outcome:** removing a link has defined local and network effects, including offline behavior.

- [x] Publish and verify signed unlink/revocation events.
- [x] Deny new link trust immediately after local removal; no sync authorization exists yet to
      consume the link.
- [x] Represent pending, graph-acknowledged (`Removed`), conflicted, and invalid revocation states.
- [x] Converge correctly when the remote device was offline and later returns.
- [x] Preserve pre-revocation signed history by publishing revocation at a separate graph root.
- [x] Keep the historical-link privacy warning in the confirmation flow.
- [x] Test device sale: revoke old link, erase old installation, create unrelated new keys.
- [x] Test lost device: surviving device revokes, lost device stays offline, then later reconnects.

**Done when:** the UI never claims that another device was erased; all peers reject future uses that
the approved v1 semantics say are revoked; and valid historical content remains verifiable.

### WP5 — Encrypted migration and continuous two-device sync

**Outcome:** Alice can migrate all supported locally available history to a new phone or keep two
linked phones synchronized without moving private identity keys or passwords.

Likely implementation ownership:

- New shared sync-manifest and convergence module — canonical records, hashes, checkpoints,
  tombstones, and conflict rules.
- New web sync service — encrypted snapshot/delta transfer, resume, acknowledgement, and key
  rotation.
- Identity & devices UI — consent, category selection, progress, status, conflicts, and stop-sync.
- Existing encrypted handoff/archive work — reuse only after its portability and integrity are
  verified; do not assume the current custody export is cross-device recovery.

- [ ] Inventory every supported data category and define whether it is immutable-union,
      mutable-versioned, tombstoned, or device-local.
- [ ] Build a versioned export manifest over all locally available selected records.
- [ ] Encrypt snapshot and delta payloads specifically for the receiving device.
- [ ] Verify sender, receiver, record signatures, per-item hashes, category counts, and final
      manifest before acknowledging success.
- [ ] Re-encrypt imported private data under the receiving device's local custody.
- [ ] Preserve author identity and provenance; never rewrite history as newly authored.
- [ ] Resume safely after app termination, route failure, low battery, or insufficient storage.
- [ ] Make repeated imports idempotent and prevent duplicate Talks/messages/attachments.
- [ ] After the initial snapshot, exchange ordered deltas until both checkpoints agree.
- [ ] Queue offline changes locally and synchronize when both authenticated devices become
      reachable; do not require plaintext or durable private storage on a relay.
- [ ] Add deterministic merge behavior and a user conflict screen for ambiguous concurrent edits.
- [ ] Rotate sync authorization/key material after stop-sync, unlink, or device revocation.
- [ ] Keep already received data on each phone unless its local user explicitly deletes it; never
      promise remote deletion.
- [ ] Gate old-phone erase/revocation behind a successful, verified migration acknowledgement.

**Done when:** a replacement phone contains every supported item present on the old phone at the
final checkpoint; two retained phones converge after offline and concurrent changes; passwords and
private keys never cross; and missing/pruned source data is reported rather than silently omitted.

### WP6 — Separate device and session keys

**Outcome:** transport authentication no longer reuses the SEA identity key.

- [ ] Select the supported transport and authenticated-handshake boundary after the existing
      libp2p/Noise investigation.
- [ ] Generate one non-exported device key per installation.
- [ ] Define SEA-signed device/transport binding records and proof-of-possession requirements.
- [ ] Use ephemeral forward-secret session keys from an established protocol.
- [ ] Bind discovery results to authenticated sessions; never authenticate from advertisements.
- [ ] Migrate without changing visible SEA authorship or link semantics.

**Done when:** a connection proves control of the device key and a valid SEA binding, application
content still verifies under the documented SEA identity rules, and session keys are ephemeral.

### WP7 — Official Android/iOS application authentication

**Outcome:** official mobile releases can present a fresh, device-bound credential that community
forks cannot forge, without making the official verifier an identity or data server.

Likely implementation ownership:

- Android native shell — Play Integrity request and optional hardware key-attestation adapter.
- iOS native shell — App Attest key lifecycle, attestation, and assertion adapter.
- Narrow verifier service — platform validation, anti-replay state, credential signing, expiry, and
  key rotation.
- Shared protocol — `OfficialBuildCredential` verification and device-key proof binding.
- Settings UI — application-authenticity details and build-trust policy.

- [ ] Provision and securely record official Android package/signing identities and Apple Team/App
      IDs outside the public repository.
- [ ] Publish a signed official-build registry and release manifest with supported key rotation.
- [ ] Implement Play Integrity Standard requests with canonical `requestHash` content binding.
- [ ] Validate Android request details, freshness, `PLAY_RECOGNIZED`, package, version policy, and
      official app-signing certificate digest at the verifier.
- [ ] If direct Android distribution is supported, implement and validate the approved alternative
      hardware-backed evidence tier; otherwise label it honestly as attestation unavailable.
- [ ] Implement App Attest per-installation keys, one-time server challenges, attestation-object
      verification, assertions, and counters.
- [ ] Validate Apple RP ID from the approved Team/App ID prefix and bundle ID, plus the configured
      production/development environment.
- [ ] Issue short-lived credentials bound to the IinPublic device public key and require fresh
      proof-of-possession when presented.
- [ ] Add verifier signing-key rotation/revocation and credential expiry handling.
- [ ] Minimize verifier storage and exclude all user content, SEA private material, passwords, and
      sync archives.
- [ ] Add graceful unsupported/offline/service-unavailable states without blocking baseline P2P.
- [ ] Add separate official, official-beta, community, development, and unverified GUI states.
- [ ] Add optional sensitive-operation policy without changing social credit or ordinary SEA
      signature validity.

**Done when:** an official Android/iOS installation can prove a fresh platform-verified credential
bound to its device key; a fork with copied source/package text cannot produce that credential; a
copied credential fails device proof; and compatible community clients still participate under the
user's configured policy.

### WP8 — Optional IinPublic.com authentication (Modes 1–2)

**Outcome:** users may opt into passkey-backed service authentication and TechSupport guidance while
the server remains incapable of replacing an identity controller. Local-only users are unaffected.

- [ ] Implement Mode 1 device challenges as an extension of the software-attestation verifier.
- [ ] Add opaque enrollments, WebAuthn/passkey registration and authentication using a reviewed
      server library.
- [ ] Require fresh, single-use server challenges and device signatures for enrollment changes.
- [ ] Add signed enrollment receipts, authenticator management, audit export, and service deletion.
- [ ] Keep Mode 2 authentication incapable of replacing an identity controller.
- [ ] Add TechSupport **Identity access help** that diagnoses available factors and explains outcomes
      without exposing recovery secrets in support chat or approving controller replacement.
- [ ] Test service outage, DM-key compromise, replay, factor removal, passkey loss, verifier-key
      rotation, and enrollment deletion.
- [ ] Complete security and privacy review before production enrollment.

**Done when:** the server can authenticate enrolled passkeys and device keys without learning local
passwords/private keys; it has no controller-replacement authority; TechSupport accurately reports
whether recovery is possible; and disabling or losing the service does not stop local/P2P use.

### WP9 — Identity continuity and later lifecycle work

Only after WP0–WP8 are stable:

- [ ] Design social-key replacement and rotation.
- [ ] Implement explicit recovery capabilities so an authorized surviving device may revoke a lost
      original phone and, when policy permits, continue the original identity through a signed
      controller chain.
- [ ] Decide whether a single authorized device is sufficient or a threshold/offline recovery key
      is required.
- [ ] Display recovery capability separately from ordinary link and sync status.
- [ ] Design multi-device group governance and transitive membership, if wanted.
- [ ] Design independent personas on one installation.
- [ ] Design portable offline backup/recovery as a separate threat-modelled feature.
- [ ] Evaluate trusted-device, trusted-contact, or threshold recovery separately;
      none is implied by the password feature.
- [ ] Design merge, unmerge, transfer, and retirement.
- [ ] Complete metadata-correlation and app-attestation reviews.

### WP10 — Optional server-assisted continuity and TechSupport recovery (Mode 3)

Only after WP0–WP9 are stable and externally reviewed:

- [ ] Implement signed server-recovery delegation/revocation events accepted only for identities
      that enrolled them before loss.
- [ ] Keep the recovery authority narrower than ordinary identity control and unusable without a
      valid recovery request satisfying policy.
- [ ] Require the approved two-factor or surviving-device policy, cooling period, notifications,
      cancellation, throttling, and old-device revocation.
- [ ] Add a separate HSM/KMS-backed recovery signing role with rotation and emergency revocation.
- [ ] Add scoped, phishing-resistant TechSupport operator authentication and two-person approval.
- [ ] Make every support-visible recovery decision carry a separate auth-service signature and
      signed audit receipt.
- [ ] Deny continuity when no enrolled policy can be satisfied; offer new-identity setup without an
      authoritative same-person claim.
- [ ] Test operator compromise, TechSupport DM/announcement-key compromise, replay, fraudulent
      recovery cancellation, notification failure, transparency-log failure, server-key rotation,
      and recovery-authority revocation.
- [ ] Complete external security, privacy/legal, and operational reviews before enabling Mode 3.

**Done when:** recovery works only for a pre-delegated identity satisfying its enrolled policy;
TechSupport cannot bypass or unilaterally satisfy that policy; every action is delayed/notified and
auditable; and compromise of ordinary TechSupport messaging cannot take over an identity.

## E. Required Acceptance Matrix

### Password-free baseline

- [ ] First run creates an identity without asking for a password.
- [ ] Restart/reload continues normally without password UI.
- [ ] Settings states clearly that no identity password is set.
- [ ] Network requests and persisted graph records contain no password fields.

### Password protection

- [ ] Set-password warning and acknowledgement are mandatory.
- [ ] Correct password unlocks; incorrect password does not.
- [ ] Restart at the defined lock boundary requires the password.
- [ ] Change and remove require the current password.
- [ ] Interrupted set/change/remove leaves one valid recoverable local custody record.
- [ ] SEA public identity is unchanged across all successful operations.
- [ ] Logs, telemetry, DOM, clipboard, crash reports, and network captures contain no password or
      private key.
- [ ] Forgotten-password help never implies that IinPublic support can reset it.
- [ ] Erase-and-start-over produces a different identity and does not claim recovery.

### Linking

- [x] Real QR and manual code represent the same short-lived payload.
- [x] Invalid, expired, replayed, self, and reused codes fail safely.
- [x] Both devices show the other fingerprint and explicitly approve.
- [x] One-sided or forged attestations never display as `Linked`.
- [ ] Linking works whether either device has a local password or neither does.
- [x] A device password never crosses the link.
- [x] Linking alone does not copy private data.
- [x] The privacy warning appears before signed public correlation.

### Migration and two-device synchronization

- [ ] Link-only, one-time migration, and continuous sync are separate explicit choices.
- [ ] Both devices approve the selected data categories.
- [ ] Initial migration includes every supported item present on the source at its snapshot and
      final-delta checkpoints.
- [ ] Imported records preserve stable IDs, original author keys, signatures, timestamps, and
      provenance.
- [ ] Messages, Talks, attachments, and other immutable records deduplicate correctly on retry.
- [ ] Mutable concurrent edits either converge deterministically or appear for user resolution;
      neither version is silently discarded.
- [ ] Deletes/tombstones converge according to the approved retention policy.
- [ ] Sync resumes after either phone is offline, restarted, or disconnected mid-transfer.
- [ ] A verified manifest and per-category counts/hashes gate the `Complete` state.
- [ ] The receiving phone reports source data that is unavailable/pruned instead of claiming a
      complete migration.
- [ ] Passwords, password-derived keys, SEA/device private keys, custody secrets, OS permissions,
      caches, and diagnostics never transfer.
- [ ] Stop-sync, unlink, and revocation prevent future synchronization and rotate authorization/key
      material without claiming to delete already received data remotely.
- [ ] Old-phone erase remains a separate deliberate action after migration verification.

### Removal and lifecycle

- [ ] Either directly linked identity can end its direct link.
- [ ] Offline revocation converges on reconnect.
- [ ] Revoked links cannot authorize new actions covered by the v1 contract.
- [ ] Historical signatures remain verifiable.
- [ ] Removing a link does not pretend to wipe the remote device.
- [ ] Erasing the current device removes local custody and creates a new identity on restart.
- [ ] Reusing a sold device creates keys unrelated to the prior owner.
- [ ] In the current link-only model, losing the original phone correctly reports its SEA identity
      as read-only rather than pretending the linked phone controls it.
- [ ] In the future delegated model, a previously recovery-authorized surviving phone can revoke
      the lost original phone and authorize a replacement through a verifiable signed chain.
- [ ] A surviving phone exposes only data received through its last successful sync; it does not
      claim to reconstruct unsynchronized history.

### Official application authentication

- [ ] Official Android production credentials require a matching fresh request binding,
      `PLAY_RECOGNIZED`, approved package/version policy, and approved app-signing certificate
      digest.
- [ ] Android upload/debug/community signing certificates never satisfy the official production
      policy.
- [ ] The direct-install Android channel, if supported, satisfies its separately documented
      hardware-backed evidence policy and cannot be confused with Google Play verification.
- [ ] Official iOS credentials require a valid App Attest chain, nonce/challenge binding, approved
      Team/App ID plus bundle ID, expected environment, and valid assertion counter.
- [ ] Replayed, expired, wrong-package, wrong-bundle, wrong-signing-key, wrong-device-key, and copied
      credentials fail closed.
- [ ] Reinstall/device migration creates new platform-attestation state without replacing the SEA
      social identity or silently inheriting an old credential.
- [ ] Service outage or unsupported hardware displays `attestation unavailable` and preserves
      baseline open-protocol operation.
- [ ] A community build can identify its own publisher but cannot display a peer-verifiable official
      IinPublic credential.
- [ ] The peer GUI never presents software authenticity as proof of the human, content, reputation,
      or device safety.
- [ ] Verifier logs/storage contain no passwords, SEA private keys, conversations, contacts, Talks,
      profiles, or synchronization archives.

### Optional IinPublic.com authentication and TechSupport recovery

- [ ] Local-only is the default; first run and ordinary use never require an IinPublic.com account.
- [ ] Mode 1, Mode 2, and Mode 3 require separate explicit consent and display their authority.
- [ ] WebAuthn registration/authentication validates RP ID/origin, fresh server challenge,
      signature, user-verification policy, and replay state.
- [ ] The server stores credential public keys/IDs but never receives the authenticator private key.
- [ ] Enabling Mode 2 alone gives the server no authority to replace the social controller.
- [ ] Mode 3 controller replacement is accepted only when the original identity signed a prior
      server-recovery delegation and the enrolled recovery policy succeeds.
- [ ] A surviving authorized device can approve/cancel recovery and receives notifications.
- [ ] Recovery events notify every enrolled device/address and produce signed audit receipts.
- [ ] Cooling periods, attempt throttles, one-time recovery-code rotation, and factor-change alerts
      are enforced.
- [ ] TechSupport DM, announcement, or ordinary operator keys cannot sign recovery authorization.
- [ ] Compromise of the TechSupport support channel alone cannot take over an identity.
- [ ] TechSupport never asks for passwords, private keys, seeds, or custody packages in chat.
- [ ] A claimant with no surviving/enrolled factor is denied original-identity continuity regardless
      of operator opinion.
- [ ] Auth-service outage blocks only optional service actions and never ordinary SEA/P2P use.
- [ ] Revoking server authority from an authorized device prevents future server recovery after the
      revocation converges.
- [ ] Enrollment deletion removes optional private records subject to disclosed security/audit
      retention without claiming to erase public signed events.

### Platforms and accessibility

- [ ] Browser, desktop, Android, and iOS-capable shells follow the same semantics.
- [ ] Keyboard-only and screen-reader flows cover password, QR fallback, approval, and destructive
      confirmations.
- [ ] All new copy is localized at least wherever the current Settings UI is localized.
- [ ] Small screens never hide expiry, warning, cancel, or destructive-action text.

## F. Core Design Rules

1. **SEA key = pseudonymous application/social identity under the approved v1 contract.**
2. **A linked set is a signed relationship, not proof of a physical person.**
3. **Device key = one installation/device after WP5.**
4. **Session key = one secure communication context.**
5. **No password is required to use IinPublic.**
6. **An optional password protects only this installation and cannot be reset by IinPublic.**
7. **Private keys stay on the device that generated them unless a separate, explicitly approved
   recovery design says otherwise.**
8. **Public keys are related only through verified signed events.**
9. **Discovery is not authentication.**
10. **Different pseudonyms remain unlinkable unless the user explicitly links them.**
11. **Unlinking changes future authorization; it cannot erase historical disclosure.**
12. **Linking, data synchronization, and identity-recovery authority require separate consent and
    can be revoked independently.**
13. **Synchronized history preserves its original authorship and provenance.**
14. **Official-build authentication proves publisher/build status, not human identity or content
    trustworthiness.**
15. **Community builds remain distinguishable and interoperable under the user's trust policy.**
16. **IinPublic.com authentication and recovery are optional, pre-enrolled authorities—not a reset
    for local passwords or missing private keys.**
17. **TechSupport can guide and audit recovery but cannot replace enrolled cryptographic proof.**
18. **Use established cryptographic protocols and reviewed primitives rather than inventing custom
    cryptography.**

The staged target remains:

```text
SEA identity key
      |
      | signs application content and approved identity events
      v
social/pseudonymous identity
      |
      | authorizes a future per-installation binding
      v
device key
      |
      | authenticates an established transport
      v
ephemeral session keys
```

The Settings UI can ship before the final key hierarchy, but its language and state model must not
promise capabilities—single-human proof, password reset, portable recovery, remote wipe, merged
identity, or transitive device trust—that the protocol does not yet provide.
