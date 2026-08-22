# Local Identity Password Custody Security Review

Date: 2026-08-22

Scope: WP2 design gate for browser-local password protection of the SEA private keypair

Verdict: **approved for staged implementation with release conditions**

## Review outcome

The proposed envelope structure, AES-256-GCM use, authenticated metadata, identity
re-derivation, compare-and-swap storage boundary, and no-reset product semantics are
suitable for staged implementation.

The proposed Argon2id dependency is not approved for v2. Web Crypto does not expose
Argon2id, and the Argon2 implementation in the most suitable zero-dependency JavaScript
candidate is explicitly outside its 2022 independent audit scope. The reviewed fallback
is scrypt from exactly pinned `@noble/hashes@1.8.0`. Scrypt was inside that library's
independent Cure53 review scope at v1.0; the relevant post-audit scrypt/PBKDF path diff was
inspected and the approved output is locked by a deterministic end-to-end vector. The
package has no runtime dependencies, version 1.x supports the project's Node baseline,
and OWASP recommends scrypt when an acceptable Argon2id implementation is unavailable.

## Approved v2 decisions

- KDF profile: `scrypt-64m-p2-v1`, `N=65,536`, `r=8`, `p=2`, 16-byte salt,
  32-byte output, with an explicit allocation ceiling.
- Dependency: exact `@noble/hashes@1.8.0`; no semver range. Updates require dependency
  diff review, vectors, benchmarks, and a normal repository review.
- AEAD: Web Crypto AES-256-GCM, a fresh 96-bit IV per write, 128-bit tag.
- Encoding: fixed-order JSON encoded as UTF-8. All interpretation-affecting fields except
  ciphertext are authenticated as AAD.
- Password input: reject ill-formed UTF-16, normalize NFC, accept 15–1,024 Unicode code
  points, and impose no character-class rules.
- Record validation: accept only an exact named parameter profile before KDF allocation.
- Failure surface: wrong passwords, tampering, malformed records, and identity mismatch
  produce the same public failure result and no secret-bearing diagnostics.
- Runtime boundary: first release locks on reload, explicit lock, identity deletion or
  replacement, and process exit. It makes no untested idle/background-lock promise.
- Storage: browser active-record replacement uses one IndexedDB read-write transaction
  with a custody-ID compare-and-swap guard. Legacy localStorage data remains authoritative
  until the committed v2 record is read back and verified.
- Recovery: v2 export/import is out of scope. The password cannot be reset by IinPublic.

## Evidence reviewed

- RFC 9106 recommends Argon2id and a 64 MiB memory-constrained profile, supporting the
  original preference but not overriding implementation-review requirements.
- OWASP's Password Storage Cheat Sheet recommends Argon2id first and lists
  `N=2^16, r=8, p=2` among its equivalent scrypt profiles when Argon2id is unavailable.
- The noble-hashes project documents the Cure53 audit scope, zero-dependency design,
  browser support, scrypt vectors/fuzzing, and version compatibility.
- The v1.0-to-v1.8 package diff adds stricter numeric/allocation checks, explicit
  endianness handling, and buffer cleanup to the scrypt path without changing the
  approved-profile result captured by the repository's deterministic vector.
- A local three-run benchmark of the pinned package and approved profile measured
  183 ms, 181 ms, and 185 ms on the development Apple Silicon host.
- IndexedDB provides transaction-scoped atomicity for active-record and migration-marker
  updates. Native adapters are not covered by this browser review.

## Release conditions

Staged implementation may proceed, but the Settings feature must remain unavailable in
production until all of these pass:

1. deterministic KDF/AAD/decrypt vectors and record-field tamper tests;
2. wrong-password, malformed-input, identity-substitution, and allocation-bound tests;
3. crash injection across set/change/remove and legacy migration steps;
4. concurrent-tab compare-and-swap tests;
5. desktop, mobile-web, Android-shell, and iOS-shell performance/memory benchmarks;
6. UI accessibility, narrow-screen, secret-leakage, and exact-warning tests; and
7. a final code review of the implemented storage adapter and lifecycle cleanup.

This review does not claim protection from active XSS, malicious dependencies executing
while unlocked, browser/OS compromise, password capture, or guaranteed JavaScript memory
zeroization.
