# Local Identity Password Custody Design

Status: **Proposed — security review required before implementation**

Scope: WP2, local password protection for an installation's SEA identity keypair

Last updated: 2026-08-21

## Decision summary

IinPublic should continue to work without a password. When a user opts into local
password protection, a reviewed Argon2id implementation should derive an
encryption key from the password and a random salt. That key should protect the
serialized SEA keypair with AES-256-GCM and authenticated metadata.

This proposal does not change identity-linking semantics, add account recovery,
or make identities portable. Implementation must wait for security review of the
KDF library, parameter profiles, storage adapter, migration procedure, and test
vectors.

## Current state and limits

`web-gun-service.ts` currently stores a `webcrypto-device-key-v1` envelope in
`localStorage`. The envelope uses AES-GCM and a PBKDF2-SHA-256 key derived from a
random device secret that is also stored in `localStorage` under a different key.
This avoids leaving the SEA private key as plain JSON, but it does not protect the
key from an attacker who can read the application's origin storage. In
particular, active XSS can read both the wrapped key and its wrapping secret.

The current `exportKeyRecoveryPackage()` output contains the wrapped record but
not the device secret. It therefore cannot normally be imported on another
device and must not be described to users as a portable backup or recovery
package.

The password-free baseline remains supported. This proposal improves optional
at-rest protection against copied storage; it cannot make decrypted browser
memory safe from active script execution, a compromised browser profile, or a
compromised operating system.

## Security goals

- Keep password-free identity creation and normal use unchanged.
- Make a copied password-protected custody record expensive to attack offline.
- Detect modification of the ciphertext and all security-relevant metadata.
- Never overwrite the only decryptable keypair during set, change, remove, or
  migration operations.
- Preserve the SEA public identity byte-for-byte through every custody change.
- Avoid storing the password, a reusable derived key, or a separate password
  verifier.
- Fail closed when the KDF implementation or required secure storage operation is
  unavailable.

## Non-goals

- Cloud accounts, password reset, escrow, or recovery by IinPublic.
- Cross-device identity portability or backup.
- Protection against malicious code executing in the application origin while
  the identity is unlocked.
- Guaranteed zeroization of JavaScript strings or objects.
- Native keychain and secure-enclave integration. Those remain separate platform
  adapters and security reviews.

## Threat model

The password envelope is intended to resist offline theft of the custody
database without the password, accidental disclosure of browser storage or
diagnostic archives, and undetected alteration of the envelope.

It is not intended to resist XSS or a malicious dependency running while the
user enters the password, an attacker controlling the browser or operating
system, malware capturing the password, or weak passwords subjected to an
offline guessing attack.

Local throttling may improve the normal UI experience, but it does not slow an
attacker who has copied the envelope. KDF cost and password quality are the
offline defenses.

## Proposed v2 envelope

The persisted record should use an explicit, versioned schema. Binary fields are
base64-encoded bytes, not implementation-dependent strings.

```ts
interface PasswordKeyCustodyRecordV2 {
  version: 2;
  format: 'password-aead-v2';
  protection: 'password';
  custodyId: string; // 128 random bits, base64url
  publicIdentity: string;
  kdf: {
    name: 'Argon2id';
    profile: string;
    salt: string; // 16 random bytes, base64
    memoryKiB: number;
    iterations: number;
    parallelism: number;
    outputBytes: 32;
  };
  aead: {
    name: 'AES-256-GCM';
    iv: string; // 12 random bytes, base64
    tagBits: 128;
  };
  ciphertext: string;
  createdAt: string;
  updatedAt: string;
}
```

The plaintext is a canonical serialization of the SEA keypair plus a schema
identifier. On decrypt, the service must derive the public identity again and
compare it byte-for-byte with `publicIdentity` before accepting the keypair.

AES-GCM additional authenticated data (AAD) must be a canonical serialization of
all non-ciphertext fields that affect interpretation: schema version, format,
protection mode, custody ID, public identity, KDF fields, AEAD fields, and
timestamps. The serializer needs fixed field ordering and UTF-8 encoding, with
published test vectors. A fresh salt and IV are mandatory for every encryption,
including password changes.

Before using parameters from a record, the implementation must validate them
against reviewed lower and upper bounds. Lower bounds prevent accepting weak
records; upper bounds prevent a modified record from causing excessive memory or
CPU use.

## KDF choice and parameter gate

Argon2id is the proposed KDF. Web Crypto currently exposes PBKDF2 but not
Argon2id, so this requires a pinned, reviewed implementation—likely a small
WebAssembly adapter—and supply-chain review.

Proposed bounds for review:

- minimum accepted profile: 19,456 KiB memory, 2 iterations, parallelism 1;
- candidate shipping profile: 65,536 KiB memory, 3 iterations, parallelism 1,
  increased to parallelism 4 only where the implementation genuinely supports it;
- 16-byte random salt and 32-byte derived key; and
- benchmark target of roughly 250–750 ms on supported platform classes, with no
  automatic reduction below the reviewed minimum.

The exact library, artifact pinning, profiles, and upper bounds must be approved
in security review. If Argon2id cannot initialize, the password feature must
remain unavailable. There must be no silent downgrade to the existing
150,000-iteration PBKDF2 format. Any PBKDF2 compatibility profile needs a
separate decision and must meet current reviewed guidance.

## Password handling

- Accept paste and password-manager input and provide a temporary show/hide
  control.
- Normalize the entered value with Unicode NFC, then encode it as UTF-8 for the
  KDF. Do not trim, lowercase, or otherwise transform it.
- Permit at least 64 Unicode code points and reject only unreasonably large input
  needed to protect the UI from resource abuse.
- Do not impose character-class composition rules.
- Show local strength guidance before creation. Minimum length and any local
  compromised-password blocklist are security-review decisions because this
  envelope is exposed to offline guessing.
- Confirm the password during set/change operations. Do not persist hints or a
  separate verifier.
- Explain before activation that there is no reset: forgetting the password can
  permanently make locally encrypted data inaccessible.

Authentication failures should return one generic result for wrong passwords,
modified envelopes, and invalid key material. Diagnostic logs must not contain
passwords, derived keys, plaintext keypairs, ciphertext, or differentiating
details exposed to untrusted callers.

## Unlock lifecycle

The decrypted SEA keypair should exist only for the active runtime session. It
must not be copied back to persistent plaintext storage. Logout, explicit lock,
identity deletion, or replacement should release all service references and ask
Gun/SEA adapters to discard authenticated state.

JavaScript does not guarantee memory zeroization. Implementations should minimize
copies, keep derived key material in byte buffers, overwrite those buffers on a
best-effort basis, and document that active scripts and memory inspection remain
outside the guarantee.

The product decision for background locking needs to be explicit. The initial
release may lock on reload and explicit logout rather than promise reliable
mobile background timers. Later idle/background locking must be tested for
interrupted writes and operating-system lifecycle events.

## Storage and atomic replacement

V2 custody should sit behind a storage adapter with compare-and-swap replacement:

```ts
interface IdentityCustodyStore {
  readActive(): Promise<CustodyRecord | null>;
  replaceActive(
    expectedCustodyId: string | null,
    next: CustodyRecord,
  ): Promise<void>;
  deleteActive(expectedCustodyId: string): Promise<void>;
}
```

The browser adapter should use IndexedDB so `replaceActive` can commit the active
record and migration marker in one transaction. Native adapters may use their
platform's equivalent transactional primitive. Separate `localStorage` writes
are not a sufficient atomic replacement mechanism.

The existing v1 record remains readable during migration, but it is not deleted
until the v2 record has committed and independently decrypted to the same public
identity.

## Operations

### Set a password

1. Unlock and validate the current password-free v1 envelope.
2. Confirm the derived SEA public identity matches the stored identity.
3. Create a fresh v2 envelope from the in-memory keypair.
4. Commit it through `replaceActive` without modifying the v1 record.
5. Read the committed v2 record back, decrypt it, and compare both the keypair
   and public identity.
6. Record migration completion, then remove the v1 record and its device secret.
7. On failure, leave or restore the known-good v1 record and discard v2.

### Change a password

1. Decrypt and validate the active v2 envelope with the current password.
2. Create a new envelope with a fresh salt and IV using the new password.
3. Atomically replace the active record using its `custodyId` as a compare-and-swap
   guard.
4. Read back, decrypt, and verify the same public identity before success.

### Remove a password

1. Decrypt and validate the v2 envelope with the current password.
2. Create a fresh password-free device envelope using the reviewed v1 successor
   format and secure random device secret.
3. Atomically replace the active record and verify it before removing v2.

Removing a password does not delete the identity or data. It lowers local
at-rest protection and must require explicit confirmation. If the password-free
successor is not approved, removal must remain unavailable instead of silently
falling back to a co-located `localStorage` secret.

### Interrupted migration recovery

On startup, the store examines the active record and migration marker in one
read transaction. It accepts only a record that decrypts and reproduces the
expected public identity. If a committed v2 record is valid, migration can finish
cleaning up v1. Otherwise the untouched v1 record remains authoritative. Cleanup
must be idempotent after termination at every numbered step.

## Export and recovery boundary

Do not expose v2 export/import as a recovery feature in WP2. Although a
password-wrapped blob could be copied, a supported recovery flow also requires
version compatibility, integrity UX, lost-file warnings, collision behavior,
data reattachment semantics, and destructive-path tests. That belongs to a
separate accepted design.

The current `exportKeyRecoveryPackage()` and `importKeyRecoveryPackage()` methods
should be deprecated or renamed internally so they cannot accidentally become a
user-facing recovery promise.

## Required tests before release

- Published deterministic KDF, canonical-AAD, and decrypt test vectors.
- Round-trip tests across every approved Argon2id profile and platform adapter.
- Wrong-password, truncated, malformed, and every-field tamper tests.
- Parameter lower/upper-bound and allocation-denial tests.
- Salt and IV uniqueness tests across repeated set/change operations.
- Public-identity mismatch and substituted-keypair rejection tests.
- Set/change/remove crash tests with termination injected at every storage step.
- Concurrent-tab compare-and-swap tests.
- Legacy v1 migration and rollback tests using production-shaped fixtures.
- Reload, logout, explicit-lock, and deletion lifecycle tests.
- Assertions that logs and analytics never receive secret material.
- Accessibility and narrow-screen tests for all password dialogs and warnings.
- Benchmarks on the supported desktop, mobile-web, and native platform matrix.

## Security-review checklist

- Approve the Argon2id implementation, artifact pinning, and update policy.
- Approve named KDF profiles, benchmark evidence, and parameter bounds.
- Approve canonical encoding, AAD construction, and cryptographic test vectors.
- Review IndexedDB/native transactional adapters and interrupted migration.
- Decide password minimums, strength guidance, and local throttling behavior.
- Decide lock lifecycle and the password-free successor envelope.
- Confirm export/recovery remains out of scope and user copy is accurate.
- Threat-model XSS and dependency compromise separately from at-rest custody.

## References

- [RFC 9106: Argon2 Memory-Hard Function](https://www.rfc-editor.org/rfc/rfc9106.html)
- [OWASP Password Storage Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html)
- [W3C Web Cryptography API Level 2](https://www.w3.org/TR/webcrypto-2/)
- [NIST SP 800-63B](https://pages.nist.gov/800-63-4/sp800-63b.html)
- [OWASP HTML5 Security Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/HTML5_Security_Cheat_Sheet.html)
