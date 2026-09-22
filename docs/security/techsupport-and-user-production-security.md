# Balanced production security for TechSupport and ordinary users

Status: production security policy and implementation roadmap.

This document answers two operational questions:

1. What protection does a decentralized application actually need?
2. How should IinPublic protect the high-impact TechSupport identity without making ordinary users
   manage infrastructure or cryptographic keys?

The short answer is **proportional security**. Decentralization removes the relay from many trust
decisions, but it does not remove the need to protect the keys that clients trust. The TechSupport
root can affect every user and therefore needs stronger custody than an ordinary identity, whose
compromise normally affects one person.

This policy complements the operational
[TechSupport key custody and rotation runbook](techsupport-key-custody-and-rotation.md) and the
[password-free identity custody v3 design](password-free-identity-custody-v3.md).

## Trust and threat model

IinPublic has four different security boundaries. They must not be treated as one shared secret.

| Boundary | What compromise permits | Required posture |
|---|---|---|
| Public relay / website host | Denial of service, traffic observation, and replacement of the web application served to future browser visits | Harden and monitor it, but keep the TechSupport private key off it |
| TechSupport root | Forging root-authorized support content, reading root-addressed support mail, issuing delegates, and—while the current protocol shares roles—signing announcements | Rarely online; encrypted offline custody; dedicated operator device; tested rotation and backups |
| TechSupport delegate | Answering support questions during a bounded grant | Ordinary device custody; short-lived, scoped, auditable, and revocable grant |
| Ordinary user identity | Acting as that one user and reading data available to that identity | Automatic device-local custody; optional password protection; clear device-link, export, erase, and loss behavior |

A decentralized relay cannot forge a signature merely because it stores or forwards the record.
However, a website visitor executes code delivered by that host. If the host is compromised, it can
serve a modified verifier or steal secrets made available to the page. Installed Android clients
and reviewed packaged releases have a stronger separation from a compromised relay because their
verifier and trust anchors are not downloaded anew on every visit.

## Required baseline for the public website

The production website and relay must run **without** any TechSupport private pair. Leave all of
these variables unset:

```text
TECHSUPPORT_KEY_FILE
TECHSUPPORT_KEY_PASSPHRASE_FILE
TECHSUPPORT_KEY_PASSPHRASE
TECHSUPPORT_SEA_PAIR_JSON
```

The relay already publishes the committed, pre-signed identity and onboarding artifacts without a
private key. A keyless deployment can still host the website, show TechSupport, deliver encrypted
questions, and distribute signed answers and FAQ bundles.

The current on-demand server announcement endpoint is unavailable without a key. That is the
intended production tradeoff until the protocol has a distinct low-impact announcement signer or
accepts an already-signed announcement from an offline/operator client. Do not place the shared
root pair on the server merely to enable this endpoint.

Protect the website as software distribution infrastructure: TLS, prompt security updates,
least-privilege deployment credentials, reviewed/pinned dependencies, restricted production
access, backups, and deployment/audit logs. Content Security Policy and XSS prevention are useful
defense in depth, but they do not turn browser storage into a root-key vault.

## Required baseline for TechSupport

The root key receives strong controls because its blast radius is global, not because every part of
IinPublic needs enterprise infrastructure.

1. Keep the encrypted root vault on one dedicated, patched, full-disk-encrypted operator machine.
2. Store its generated passphrase separately in a password manager; keep two offline encrypted
   backups on different media and test restoration quarterly.
3. Use the root only to issue/revoke delegates, sign controlled artifacts, and rotate trust
   anchors. Do not use it for daily support conversations.
4. Give daily operators short-lived delegate grants tied to their own normal identities. Prefer a
   7–30 day grant, use the shortest practical duration, and revoke it when a device or role changes.
5. Keep a written compromise procedure and rehearse key rotation before an incident.

This is the minimum balanced production posture. It does **not** require an HSM, a security team,
or multi-party ceremonies for an early deployment.

### Browser-root boundary

Production web builds reject and erase the legacy TechSupport root `localStorage` injection. The
public relay also refuses to start when any root vault or legacy plaintext-key setting is present.
Rare production issue/revoke operations use `npm run techsupport:delegate -- issue|revoke`: a
short-lived local Node process decrypts and signs, while the server receives only the signed public
grant.

`scripts/techsupport-agent.js` remains temporarily as a loopback-only development/E2E harness. It
decrypts the root pair and injects it into `localStorage`, where every same-origin script can read
it. OWASP advises against putting sensitive information in `localStorage` because one XSS or
compromised same-origin script can disclose it:
[OWASP HTML5 Security Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/HTML5_Security_Cheat_Sheet.html).

Therefore:

- do not run the root agent on the public VPS or point it at a remote origin (the script refuses
  non-loopback URLs);
- use the encrypted-vault local CLI for production issue/revoke actions; and
- use delegates, not the root agent, for routine support.

Issue/revoke now uses the narrow local signer boundary. Remaining root-only browser operations and
development fixtures must still move to local commands or delegated flows before the legacy
injection key and harness can be deleted. Hardware-backed or non-exportable custody can be added
behind that boundary later. Since the current SEA pair contains both signing (`priv`) and
ECDH/decryption (`epriv`) material in an exportable format, true HSM/OS-keystore custody requires a
versioned protocol or signing API change rather than simply moving the existing JSON into a cloud
secret manager.

Revocations are also published as separately keyed, root-signed tombstones. Clients reconcile the
mutable current slot, tombstone history, embedded-node relay reads, live Gun updates, and their
verified local cache monotonically. This prevents an older signed grant from restoring authority
after a client has seen—or can discover—the tombstone. A transport that withholds every newer
record can still present a stale view; independent recovery authority/checkpoints are the OPEN-29
solution to that availability/freshness limit.

## Balanced defaults for ordinary users

Normal users should not see or manage raw private keys during normal use.

- **Website default:** use the implemented non-extractable WebCrypto wrapping key in IndexedDB.
  This protects against casual storage copying, but not malicious same-origin JavaScript or an
  already-compromised operating system.
- **Android default:** use the implemented Android Keystore wrapping key and app-private
  ciphertext. Record hardware-backing availability honestly rather than requiring it on every
  supported phone.
- **Optional stronger protection:** offer the existing local password-custody mode to users with a
  shared computer or higher threat level. The password is local and cannot be reset by the relay.
- **Multiple devices:** use explicit, mutually approved device linking and re-custody imported data
  to the receiving device. Never synchronize the device wrapping secret.
- **Loss:** explain that erasing the final authorized device without an export or linked device
  loses the identity. TechSupport can explain options but cannot manufacture the missing key or
  override identity continuity.
- **Usability:** do not require routine key rotation, HSMs, seed phrases, or manual fingerprints
  from ordinary users. Reserve warnings and advanced controls for export, linking, password
  changes, erasure, and suspected compromise.

This gives ordinary users strong automatic local custody without transferring ownership to the
server. It also states the browser limit honestly: a non-extractable wrapper prevents key export,
but code running in the same origin may still ask the key to decrypt while the application is
open.

## Incident response

| Event | Immediate response | Long-term response |
|---|---|---|
| Relay or website compromised, no root key present | Remove it from service, rotate deployment/SSH credentials, preserve logs, and rebuild from a known-good release; do not open a root session against it | Review the served code and notify users if a malicious web build may have run |
| Encrypted root vault copied, passphrase not exposed | Preserve evidence and assess passphrase/device exposure | Rotate if there is material uncertainty; improve physical separation |
| Delegate device/key stolen | Revoke the grant, end its opt-in session where possible, and audit its signed activity | Issue a new bounded grant only to a clean identity/device |
| Root pair or unlocked root environment exposed | Stop all root use, isolate the host, rotate related deployment credentials, and generate a new root on a clean offline machine | Prepare/activate/retire trust anchors, re-sign artifacts, review suspect signatures, and require client updates |
| Ordinary user device stolen | Use a surviving linked device to revoke it where supported; otherwise treat that identity as exposed | Create a new identity if no authorized device/recovery path survives; TechSupport must not impersonate the old identity |

A stolen asymmetric root key cannot be made secret again by changing a password. Clients must stop
trusting its public key. Existing clients that have not received a new trust-anchor release may
continue accepting it, so compromise response includes client rollout, not only server changes.
NIST recommends ceasing new protection with a compromised key, revoking it, limiting each key's
purpose and lifetime, and retaining traceability:
[NIST SP 800-57 Part 1 Rev. 5](https://csrc.nist.gov/pubs/sp/800/57/pt1/r5/final).

## Proportional roadmap

### Now — required before normal public operation

- Keyless website/relay.
- Encrypted root vault, separate passphrase, offline backups, and tested staged rotation.
- Root used only for rare control operations; delegates used for normal support.
- Browser v3 and Android Keystore custody remain the ordinary-user defaults.
- Written response for relay, delegate, root, and user-device compromise.

### Before TechSupport becomes high-volume or high-trust

- Finish moving remaining root-only operations and test fixtures off root `localStorage` injection.
- Split the offline root/delegation authority, DM/decryption operator role, and online announcement
  signer in a versioned protocol.
- Pin an independent offline recovery authority—or a small threshold of recovery keys—before an
  emergency occurs, so clients can authenticate a root replacement without trusting the stolen
  root or relay.
- Tighten CSP, remove `unsafe-eval` where feasible, and add release-integrity monitoring.

### Only when scale, regulation, staffing, or threat level justifies it

- Hardware tokens, TPM/Secure Enclave integration, HSM/KMS signing, or threshold approval.
- Two-person approval for root rotation and recovery changes.
- Centralized security monitoring and formal external audits.

OWASP's general guidance is the same proportional pattern: least privilege, limited lifetimes,
revocation, rotation, and auditability rather than one unrestricted shared secret:
[OWASP Secrets Management Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Secrets_Management_Cheat_Sheet.html).

## Decision

IinPublic does not need maximum enterprise security around every user. It does need a small number
of non-negotiable controls around the TechSupport root because decentralization makes that key a
client-side authority with a broad blast radius. The balanced design is:

**keyless relay + cold root + short-lived delegates + automatic device custody for users + honest
loss behavior.**

More expensive controls are deferred until the product's scale or risk makes them worthwhile.
