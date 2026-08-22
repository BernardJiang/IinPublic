# stage2/73 — Mutual direct identity linking

Covers identity architecture WP3 and the accepted v1 `LINK_IDENTITY` semantics.

Two isolated browser installations create independent SEA identities. Device A displays a
versioned, expiring pairing code; device B explicitly enters it and publishes one signed
attestation. The UI labels that state **Waiting for approval**. Device A discovers and explicitly
approves B's signed request, publishes the reciprocal signature, and both devices independently
verify the direct link. Reusing the code is rejected. Device B then goes offline as a lost-device
simulation; A immediately removes local trust and publishes a signed unilateral revocation. When B
returns with its original identity, it verifies the event and converges to **Removed** without any
claim that its local data was remotely erased or that identity-owned data was merged. The retired
installation is then erased as a device-sale flow; its Removed row is not offered as a sync target,
and the fresh boot creates an unrelated SEA identity.
