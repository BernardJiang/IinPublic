# Attestation verifier key custody and rotation

This is the production contract for the software-attestation verifier's signing key (§16.5,
`docs/IinPublic Identity & Key Architecture TODO.md`). The private key must never enter the
repository, client bundle, shell history, logs, issue tracker, or chat. It signs
`OfficialBuildCredential`s (short-lived, per-device, refreshed roughly daily) — a compromise here
lets an attacker forge "official build" badges, but does not expose any user's SEA identity,
messages, or the TechSupport channel. See §16.8 for why this is a deliberately separate key from
those, not shared infrastructure.

## Custody model

Same model as `techsupport-key-custody-and-rotation.md`, applied to this key:

- Vault + passphrase live in the gitignored `secrets/` directory
  (`secrets/attestation-verifier.key.json` + `secrets/attestation-verifier.key.passphrase`), mode
  `600` — the tooling refuses to read either file if permissions are looser.
- The vault format is `iinpublic-attestation-verifier-key-v1`: a Node.js `crypto` P-256 EC keypair
  (PEM-encoded SPKI/PKCS8, **not** a SEA pair — see §16.8), encrypted with AES-256-GCM, public
  metadata authenticated as additional data, scrypt KDF (`N=32768, r=8, p=1`, random 128-bit
  salt), random 96-bit GCM IV per vault. Only the public key, creation time, algorithm parameters,
  and ciphertext are visible without the passphrase.
- Unlike the TechSupport key (signs once, republishes a static blob — no live signing at
  runtime), this key **is** used for live, per-request signing by the verifier route
  (`src/server/routes/attestation-routes.ts`), so it must be loadable by the running server
  process — `ATTESTATION_VERIFIER_KEY_FILE` +
  `ATTESTATION_VERIFIER_KEY_PASSPHRASE_FILE`/`ATTESTATION_VERIFIER_KEY_PASSPHRASE` env vars at
  boot, same convention as every other secret this codebase loads.
- Keep at least one offline encrypted backup on separate media. Test a restore + `npm run
  attestation:key -- verify` at least quarterly.

## Generation

```bash
mkdir -p secrets && chmod 700 secrets
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))" > secrets/attestation-verifier.key.passphrase
chmod 600 secrets/attestation-verifier.key.passphrase
ATTESTATION_VERIFIER_KEY_PASSPHRASE_FILE="$(pwd)/secrets/attestation-verifier.key.passphrase" \
  npm run attestation:key -- generate --out secrets/attestation-verifier.key.json
```

Done for this deployment 2026-09-29 (Part B of scenario 2's implementation). Public key
fingerprint (`verifierKeyId`) recorded in the generation output at the time — re-derive with
`npm run attestation:key -- inspect --key secrets/attestation-verifier.key.json` rather than
trusting a copy pasted somewhere else, since that's the one value peers actually need to match a
credential against.

## Rotation — not yet implemented, deliberately

`scripts/techsupport-key-tool.js`'s `rotation prepare/activate/retire` subcommands (trust-anchor
JSON, overlap window, re-signing committed artifacts) have no equivalent here yet, because there's
nothing published for a rotation to roll over — `GET /api/attestation/verifier-keys` (Part C)
doesn't exist yet, so no peer has ever seen this key's public half. Build rotation tooling
alongside that route, not before it; a rotation mechanism for a key nobody trusts yet is dead
code. Once live: the shape should match §16.5's own requirement ("Publish verifier public keys
and a signed verifier-key rotation/revocation chain") — an overlap list of currently-trusted
`verifierKeyId`s a peer accepts, the same "prepare (dual-trust) → activate (flip current) →
retire (drop old)" three-step flow as the TechSupport key, so a credential signed just before
rotation doesn't suddenly fail verification mid-rollout.

## Compromise response

If this key is suspected compromised: generate a new key immediately (above), but do **not**
retire the old `verifierKeyId` from peers' trusted set until every device holding a credential
signed by it has had time to refresh (credentials are short-lived — 24h per Part C's design — so
this window is naturally short, unlike a SEA identity compromise). Revoking the old key
immediately would just make every device relying on an about-to-expire-anyway credential briefly
show a lower trust label, which is the correct fail-safe behavior (§16.5: never silently upgrade,
degrade honestly), not an emergency.
