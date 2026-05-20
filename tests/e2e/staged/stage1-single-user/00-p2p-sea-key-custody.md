# P2P roadmap P3 — SEA key custody and relay storage boundaries

Verifies that browser SEA private keys are stored as an encrypted custody record instead of raw
`iinpublic_keypair` localStorage, and that the non-production relay/storage debug surface reports
only public identity policy plus a clean private-key/plaintext scan.
