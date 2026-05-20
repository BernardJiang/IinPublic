**Features tested:** P2 permissioned local node supervisor, permission disclosures, signed pairing, identity binding, local-only data controls

1. Starts a clean single-user session.
2. Verifies the local node supervisor starts stopped and lists storage, bandwidth, battery, background, local-port, and delete/stop disclosures.
3. Verifies browser-to-local-node discovery requires signed session pairing.
4. Starts the node, binds separate web and node identities with a proof, and confirms the Settings inspector renders the supervisor state.
5. Wipes local node state and confirms the supervisor reports `wiped`.
