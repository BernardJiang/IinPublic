# Official build identifiers (public data)

Per `docs/IinPublic Identity & Key Architecture TODO.md` §16.2 ("Official release signing is the
first boundary"). Everything in this file is intentionally public — it's what lets a peer or the
attestation verifier confirm a build is genuinely official, not a secret.

## Android

- **Package name (applicationId):** `com.iinpublic.app` — `android/app/build.gradle`.
- **Official release-signing certificate SHA-256 digest:**
  `6B:35:AB:4B:43:E8:56:FF:38:57:96:C5:B0:EE:EA:FA:E4:CA:A8:C8:96:4A:EC:95:CD:BB:54:F0:3D:33:92:5A`
  — extracted 2026-09-29 via `keytool -list -v -keystore secrets/android-release.keystore`
  (signature algorithm SHA384withRSA, 4096-bit RSA key). This is the digest the attestation
  verifier checks a submitted Key Attestation certificate chain's `attestationApplicationId`
  signature-digest set against (`src/server/routes/attestation-routes.ts`).
- **Signing key custody:** `secrets/android-release.keystore` (gitignored), documented in
  `docs/guides/DEPLOY_PRODUCTION.md`. If this key is ever rotated, this digest must be updated
  here **and** the verifier redeployed — a stale digest here means every future official build
  fails attestation, not a security hole, so this is safe to get wrong in the fail-closed
  direction but must be kept current for the feature to keep working.

## Google Hardware Attestation Root certificates

Trust anchors for verifying an Android Key Attestation certificate chain terminates at a genuine
Google-issued root (§16.3: "Verify the certificate chain, Google attestation root..."). Committed
as a static file rather than fetched live at verification time — a security-critical trust anchor
should not depend on a live network call succeeding, and Google's roots are meant to be extremely
long-lived (the two below don't expire until 2035 and 2042).

**File:** `src/server/security/google-hardware-attestation-roots.pem` (2 certs, concatenated).

Fetched 2026-09-29 from `https://android.googleapis.com/attestation/root` (Google's own live
JSON endpoint, documented at
[developer.android.com/privacy-and-security/security-key-attestation](https://developer.android.com/privacy-and-security/security-key-attestation)),
then independently verified to parse as well-formed, self-signed X.509 certs with the expected
Google/Android branding before committing (`openssl x509 -noout -subject -issuer -dates
-fingerprint -sha256`):

| # | Subject | Not before | Not after | SHA-256 fingerprint |
|---|---|---|---|---|
| 1 | `serialNumber=f92009e853b6b045` (legacy RSA root) | 2022-03-20 | 2042-03-15 | `CE:DB:1C:B6:DC:89:6A:E5:EC:79:73:48:BC:E9:28:67:53:C2:B3:8E:E7:1C:E0:FB:E3:4A:9A:12:48:80:0D:FC` |
| 2 | `CN=Key Attestation CA1, O=Google LLC` (current EC root) | 2025-07-17 | 2035-07-15 | `6D:9D:B4:CE:6C:5C:0B:29:31:66:D0:89:86:E0:57:74:A8:77:6C:EB:52:5D:9E:43:29:52:0D:E1:2B:A4:BC:C0` |

**Revocation:** Google publishes a live CRL-equivalent at
`https://android.googleapis.com/attestation/status` (JSON, keyed by cert serial number). The
verifier should check a submitted chain's leaf/intermediate serials against this before issuing a
credential — unlike the roots, this genuinely needs to be a live check (revocations are meant to
propagate quickly), so it's the one live external dependency the verifier intentionally has, with
its own documented fail-mode (§16.5: "If the verifier is unavailable, continue normal open-protocol
operation with the correct lower-confidence label" — the same principle applies if the revocation
check itself is unreachable: don't fail the whole feature, don't silently treat unreachable as
"not revoked" either — degrade to `officially-signed-unavailable`).

**Refresh policy:** review whether Google has published a new root during any future key-rotation
review (§16.2's own rotation-review cadence) — not on any automated schedule, since roots rotate
on a timescale of years, not days.

## Key Attestation extension schema (reference, not data)

For `src/server/routes/attestation-routes.ts`'s implementers, not itself a pinned value:

- Key Attestation extension OID: `1.3.6.1.4.1.11129.2.1.17` (the `KeyDescription` ASN.1 SEQUENCE,
  embedded in the leaf certificate of an attestation chain).
- `attestationApplicationId` is **not** a separate top-level extension/OID — it's tag `[709]`
  EXPLICIT OCTET_STRING nested inside the `AuthorizationList` (itself nested inside
  `KeyDescription.softwareEnforced` or `.hardwareEnforced`), containing a further DER-encoded
  `SEQUENCE { packageName OCTET_STRING, signatureDigests SET OF OCTET_STRING }`. Confirmed against
  [source.android.com/docs/security/features/keystore/attestation](https://source.android.com/docs/security/features/keystore/attestation)
  2026-09-29 — the original plan assumed this was a separate OID (`...2.1.29`); that was wrong and
  corrected here before implementation, not after.
- `attestationSecurityLevel` (top-level field in `KeyDescription`, not in the `AuthorizationList`):
  `SecurityLevel ::= ENUMERATED { Software(0), TrustedEnvironment(1), StrongBox(2) }` — maps
  directly to the `OfficialBuildCredential.evidenceTier` the verifier issues.
