# TechSupport production key custody and rotation

This runbook is the production contract for the TechSupport root key. The private SEA fields
(`priv` and `epriv`) must never enter the repository, client bundle, relay environment, shell
history, logs, issue tracker, or chat. The relay publishes committed signed artifacts and therefore
does not need the private key during normal operation.

The security rationale, balanced controls for ordinary users, and staged hardening roadmap are in
[`techsupport-and-user-production-security.md`](techsupport-and-user-production-security.md).

## Custody model

- Keep the primary encrypted vault on a dedicated operator machine. Do not place it on the public
  relay/VPS. Until the local signer boundary replaces browser `localStorage` injection, use the
  root only from a reviewed/pinned local application build for short control operations; use
  delegates for routine support.
- Keep at least two offline encrypted backups on different media, with one in a different physical
  location. Test a restore and signing verification at least quarterly.
- Store the vault passphrase separately in the team's password manager. For automation, inject it
  through a secret manager or a mode-`600` passphrase file. Do not put a literal passphrase in a
  command argument because process listings and shell history can expose it.
- Give vault and passphrase files mode `600`; the tooling refuses group/other-readable private
  files on POSIX systems. The gitignored `secrets/` directory is the standard local location.
- Use delegated TechSupport grants for additional operators. Do not copy the root vault to phones
  or general-purpose staff devices.

The vault format is versioned `iinpublic-techsupport-key-v1`. It encrypts the complete SEA pair
with AES-256-GCM, authenticates its public metadata as additional data, and derives the encryption
key with scrypt (`N=32768`, `r=8`, `p=1`, random 128-bit salt). Every new vault also receives a
random 96-bit GCM IV. Only the public key, encryption public key, creation time, algorithm
parameters, and ciphertext are visible without the passphrase.

## Initial generation and migration

Create a strong passphrase file outside synchronized folders, then generate a fresh vault:

```bash
mkdir -p secrets
chmod 700 secrets
printf '%s\n' 'use-a-password-manager-generated-passphrase' > secrets/techsupport-master.passphrase
chmod 600 secrets/techsupport-master.passphrase
export TECHSUPPORT_KEY_PASSPHRASE_FILE="$PWD/secrets/techsupport-master.passphrase"
npm run techsupport:key -- generate --out secrets/techsupport-master.key.json
npm run techsupport:key -- verify --key secrets/techsupport-master.key.json
```

The command prints only the public key and its SHA-256 fingerprint. Compare that fingerprint over
an independent channel before changing trust anchors.

To migrate an existing `TECHSUPPORT_SEA_PAIR_JSON` from `.env.local`, set the passphrase source and
run the import command. It reads the legacy variable without printing it:

```bash
npm run techsupport:key -- import --out secrets/techsupport-master.key.json
```

Or import a mode-`600` plaintext JSON file with `--from`. After `verify` succeeds and backups have
been tested, remove the plaintext source from `.env.local` and secure-delete or physically destroy
the old plaintext copy according to the storage medium's procedures. Configure normal tools with:

```bash
TECHSUPPORT_KEY_FILE=secrets/techsupport-master.key.json
TECHSUPPORT_KEY_PASSPHRASE_FILE=secrets/techsupport-master.passphrase
```

`TECHSUPPORT_SEA_PAIR_JSON` remains supported only so existing developer environments can migrate;
it is not an approved production storage method.

## Rotation procedure

Rotation is deliberately staged across releases. Never jump straight to activation: old clients
pin their compiled trust list and would reject the new identity and signatures.

### 1. Prepare an overlap release

Generate and back up a new vault, then add its public key to both trusted lists while leaving the
old key current:

```bash
export TECHSUPPORT_KEY_PASSPHRASE_FILE="$PWD/secrets/new-techsupport.passphrase"
npm run techsupport:key -- rotation prepare --key secrets/new-techsupport.key.json
git diff -- src/shared/techsupport-trust-anchors.json
```

Review, test, commit, and deploy this release to every supported client channel. The old artifacts
continue to be signed by the old current key, while overlap-aware clients accept either key.

### 2. Activate and re-sign

After the prepare release reaches the minimum supported client population, activate the new key:

```bash
npm run techsupport:key -- rotation activate --key secrets/new-techsupport.key.json
git diff -- src/shared/techsupport-trust-anchors.json src/shared/techsupport-*.signed.json
npm run health
```

Activation refuses a key that was not prepared, moves it to the front of both trust lists, builds
the shared server modules, and re-signs the identity, greeting, support acknowledgement, and
onboarding-tip artifacts. If a build or signer fails, it restores all five tracked files. Review
and deploy the activation release. Retain both vaults and both anchors during the rollback window.

### 3. Retire the old key

Only after telemetry/support policy says the old client versions are outside the supported window,
remove the old anchor. The exact-key confirmation prevents accidental retirement:

```bash
npm run techsupport:key -- rotation retire --pub '<old-public-key>' --confirm '<old-public-key>'
```

The command refuses to retire a current key. Review, test, commit, and deploy the retirement
release, then archive the old encrypted vault offline for the retention period. Do not delete it
until incident-response and rollback policy permit.

## Rollback and compromise response

- Before retirement, rollback is another activation: run `rotation activate` with the old vault,
  review the restored signatures, and deploy. Both keys are already trusted by overlap clients.
- If the active private key may be compromised, stop every root-key agent, preserve relevant audit
  logs, generate a new vault on a known-clean machine, and perform prepare/activate as quickly as
  the supported client window permits. A release that does not yet trust the emergency key cannot
  authenticate it; there is intentionally no relay-side bypass.
- If only a delegate device is compromised, revoke its delegate grant. Do not rotate the root key
  unless evidence indicates the root vault was exposed.
- Record who performed each phase, the reviewed fingerprints, release identifiers, backup-restore
  result, and exact times in the private operations log. Never record private key material.

## Current protocol boundary

The config has separate `dm` and `announcement` roles so the trust model can split them later, but
the current signed TechSupport identity advertises and self-signs one SEA pair. Consequently this
tool rotates both roles together and rejects partial role changes. Splitting the keys requires a
versioned identity-record protocol change that binds a distinct announcement signer to the DM
identity; manually putting different current keys in the two roles would break verification.
