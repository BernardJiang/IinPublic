# stage2/73 — Mutual direct identity linking

Covers identity architecture WP3 and the accepted v1 `LINK_IDENTITY` semantics.

Two isolated browser installations create independent SEA identities. Device A displays a
versioned, expiring pairing code; device B explicitly enters it and publishes one signed
attestation. The UI labels that state **Waiting for approval**. Device A discovers and explicitly
approves B's signed request, publishes the reciprocal signature, and both devices independently
verify the direct link. Reusing the code is rejected. A signed revocation later converges without
claiming to erase the other installation or merge either identity's data.
