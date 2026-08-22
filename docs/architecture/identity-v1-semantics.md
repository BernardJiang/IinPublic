# Identity v1 Semantics

**Status:** Accepted for WP0 on 2026-08-21

**Scope:** The current per-installation SEA model and the delivery boundary through identity
linking/removal. Later delegated device keys, data synchronization, app attestation, optional
IinPublic.com authentication, and controller recovery require their own reviewed work packages.

## Decisions

1. Each installation creates and keeps an independent SEA keypair. The SEA **public key**, not the
   internal user-record UUID, is its IinPublic Identity ID. Talks and current identity-management
   events are signed by that installation's SEA key.
2. A v1 link is a direct, pairwise relationship between two SEA identities. It exists only when
   both identities' `LINK_IDENTITY` attestations verify. Links are not transitive and do not create
   a person/cluster identifier.
3. A verified link proves only that both private keys approved the relationship. It is a user
   assertion that the pseudonymous identities are controlled together, not proof of one physical
   or legal person. Publishing it correlates the identities; unlinking cannot undo that disclosure.
4. Linking authorizes display grouping of the direct relationship only. It does not merge or
   re-author Talks, reputation, contacts, blocks, Q&A, conversations, or private data. It does not
   authorize data transfer or identity recovery.
5. Data migration/sync will require separate mutual, category-scoped authorization. Removing a
   link cancels pending transfer authority and prevents new transfers through that edge. Data
   already received remains on each device unless its local user deletes it; removal is not remote
   wipe.
6. Identity continuity after all controlling keys are lost is unavailable in v1. A linked or
   synchronized device does not control another identity. Delegated recovery-capable device keys
   remain a later WP9 design.
7. An optional identity password, when WP2 is reviewed and implemented, is a local custody lock for
   one installation. It is never sent to a server or another device, does not change the SEA public
   identity, and has no reset path. Forgetting it permits only erasing this installation and starting
   with a new identity.
8. Official-build authentication is outside the v1 identity/linking boundary. The current Android
   and iOS application ID is `com.iinpublic.app`, but no build may claim a peer-verifiable official
   credential until production signing identities, Apple Team/App ID, evidence policy, verifier
   keys, and retention policy are provisioned and reviewed. Compatible builds remain allowed and
   distinguishable; software authenticity never changes SEA signature validity.
9. Local-only operation (service Mode 0) is the v1 default. Modes 1–3 are not granted any authority
   by this decision. IinPublic.com and TechSupport cannot reset local passwords, replace identity
   controllers, or infer continuity without a future pre-enrolled cryptographic delegation.

## Vocabulary

- **Identity / IinPublic Identity ID:** one SEA public key.
- **Installation / this device:** the local app/browser custody boundary. Its editable name is a
  local label, not a hardware claim.
- **Linked identity:** another SEA identity with a direct, mutually verified `LINK_IDENTITY` edge.
- **Remove link / `UNLINK_IDENTITY`:** stop future authorization through a direct edge while
  retaining historical signatures and disclosure.
- **Device key / `ADD_DEVICE` / `REVOKE_DEVICE`:** reserved for the later delegated-device model;
  these terms do not describe current identity links.
- **Data sync authorization:** separate from identity linking and not implemented by WP1.
- **Identity recovery authority:** separate from both linking and sync and unavailable in v1.

## Reviewer answers

- **Who signs a Talk?** The SEA key of the identity that authored it. Linking never rewrites the
  author.
- **What does a link prove?** Both SEA private keys approved a direct public correlation.
- **What does removal do?** It stops future use of that edge and pending transfer authority; it
  does not erase remote data or historical evidence.
- **What happens after a forgotten password?** No reset or linked-device unlock exists. The local
  installation can only be erased and replaced with a new identity.
