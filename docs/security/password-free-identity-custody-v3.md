# Password-free identity custody v3 — implementation design

Status: **browser rollout implemented and cross-engine restart verified; native adapters and
external review still open**.

## Why v3 exists

The original password-free `webcrypto-device-key-v1` record derives its AES wrapping key from a
random secret stored beside the ciphertext in localStorage. It prevents casual plaintext exposure
but offers little separation to an attacker who can copy the origin's complete storage.

Browser v3 instead generates an AES-256-GCM `CryptoKey` with `extractable: false`, stores that
opaque key and the encrypted SEA pair together in IndexedDB, and never serializes raw AES key
bytes into application data. WebCrypto defines `CryptoKey` as serializable and explicitly calls
out IndexedDB as the expected persistence mechanism. It also makes the boundary clear:
non-extractable prevents `exportKey`, but injected same-origin code can still *use* the key, and
the specification does not guarantee hardware-backed or encrypted-at-rest browser storage.

Primary platform references:

- [W3C Web Cryptography Level 2 — key storage and security considerations](https://www.w3.org/TR/webcrypto-2/#concepts-key-storage)
- [W3C Web Cryptography Level 2 — CryptoKey serialization](https://www.w3.org/TR/webcrypto-2/#cryptokey-interface-serialization)
- [W3C Indexed Database API](https://www.w3.org/TR/IndexedDB/)
- [Android Keystore system](https://developer.android.com/privacy-and-security/keystore)
- [Apple Keychain Services](https://developer.apple.com/documentation/security/keychain-services)

## Browser record and key

`BrowserNonExtractableKeyCustodyRecordV3` contains only:

- version, format, provider, and protection identifiers;
- a random 128-bit custody ID;
- the public SEA identity (`pub`, `epub`);
- a random 96-bit AES-GCM IV and fixed 128-bit authentication tag setting;
- ciphertext and canonical timestamps.

Every public metadata field is authenticated as AES-GCM additional data. The plaintext is a
schema-tagged object containing exactly `pub`, `epub`, `priv`, and `epriv`. Decryption checks that
the plaintext public fields equal the authenticated metadata. Validation rejects unknown fields,
non-canonical base64/timestamps, wrong algorithms/usages, extractable keys, and malformed records.
All unlock failures collapse to one generic message.

The IndexedDB row contains `{ record, wrappingKey }` in one transaction. The wrapping key must be
a non-extractable 256-bit AES-GCM secret key with exactly `encrypt` and `decrypt` usages. Custody-ID
compare-and-swap guards prevent two tabs from silently replacing one another.

## Migration transaction

`BrowserPasswordFreeCustodyManager.migrateFrom()` implements copy → verify → delete:

1. decrypt/read the v1 source;
2. create and preflight a v3 candidate;
3. commit record and non-extractable key atomically to IndexedDB;
4. read/decrypt the committed row and compare every SEA field;
5. only then remove the matching v1 source.

If step 4 fails, the new candidate is deleted (or the prior v3 row is restored). If source cleanup
fails, both valid copies remain; a later invocation verifies they are byte-identical and resumes
cleanup. A conflicting v1/v3 identity is a hard failure, never an overwrite.

## Native provider boundary

Native shells must not pretend IndexedDB is an OS keystore. The next slice will expose the same
write/read/verify/remove contract through narrow native bridges:

- Android: an Android Keystore AES wrapping key whose material remains non-exportable; ciphertext
  and public metadata may live in app-private storage. Record whether secure hardware actually
  backs the generated key rather than claiming it universally.
- macOS/iOS: a Keychain-protected wrapping secret or key reference with an explicit accessibility
  class. Secure Enclave is not automatically suitable for arbitrary AES wrapping and must not be
  claimed unless the chosen algorithm and device path genuinely use it.
- Electron on Windows/Linux: select and review an OS credential-store adapter before enabling v3;
  do not silently fall back to a plaintext file.

## Rollout status and remaining gates

- Completed: browser startup and password removal use the v3 manager while retaining v1 until
  copy/read-back verification and falling back to v1 only when a browser cannot persist CryptoKey.
- Completed: erase-device and stage-reset database removal include v3.
- Completed: Chromium, Firefox, and WebKit tests close and relaunch a persistent browser profile,
  prove the exact private pair survives, and prove the wrapping key remains non-extractable.
- Completed 2026-09-19: `NativeCustodyBridge` contract (`src/shared/native-custody-bridge.ts`) and
  `NativePasswordFreeCustodyManager`; Android Keystore AES-256-GCM adapter (public identity bound as
  AAD, reports hardware backing from `KeyInfo`) verified on three physical phones by
  `tests/e2e/native-app/18-android-keystore-custody.spec.ts` (no WebView plaintext, ciphertext-only
  prefs, identity survives force-stop).
- Written, not yet built/run: Apple Keychain (`AppleCustodyBridge.swift`, after-first-unlock, this
  device only) and Electron macOS `safeStorage` (`platforms/desktop/custody.js`, verified by spec 22; Windows/Linux
  refused until a provider is reviewed).
- Decide the Windows/Linux desktop provider.
- Obtain external security review before checking the parent TODO item complete.
