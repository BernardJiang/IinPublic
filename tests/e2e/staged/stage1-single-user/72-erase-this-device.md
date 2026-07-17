# stage1/72 — Erase this device

covers: SPEC-19.14  <!-- auto-seeded; refine by hand -->

Covers TODO item **J** (redesign §11, catalog T11).

Single device: the Erase confirm dialog gates the wipe behind a type-`ERASE`
input (button disabled until it matches). Cancel leaves storage and identity
intact. Confirming clears all device storage and reloads to a fresh boot with a
new identity; the prior marker and user id are gone.
