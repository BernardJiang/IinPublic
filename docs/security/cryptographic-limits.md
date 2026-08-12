# Cryptographic limits and private-conversation roadmap

IinPublic currently uses Gun SEA identities, signatures and ECDH-derived pair encryption (`sea-ecdh-v1`). This authenticates an object to a SEA key and hides pair payloads from relays when endpoints and keys are uncompromised. It does not provide a reviewed modern messaging protocol.

Current limitations:

- A long-lived SEA encryption-key compromise can expose ciphertext protected by that pair secret; there is no forward secrecy or post-compromise security guarantee.
- Static identity keys do not provide automatic per-message key rotation, skipped-message keys or a cryptographic transcript designed for asynchronous multi-device delivery.
- SEA identity proves control of a key, not a legal person, device integrity or prevention of multiple identities.
- Metadata such as timing, approximate size, endpoints, rooms and delivery attempts may remain visible to transports or relays.
- Device backup/recovery and multi-device person semantics are not yet defined; claims must not imply seamless secure device linking.

Before advertising high-assurance private conversations, evaluate a well-reviewed ratcheting protocol through a clean adapter boundary. The evaluation must cover authenticated session setup tied to SEA identity, forward secrecy, post-compromise recovery, out-of-order delivery, multi-device sessions, key verification UX, migration, test vectors and an external review. Do not invent a new ratchet or copy proprietary implementations/wire formats.
