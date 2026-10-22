# Product owner TODO

This is the short companion to `docs/TODO.md`. It contains only work that cannot be completed by
the coding agent because it requires physical movement or handling, an owner decision, privileged
machine access, credentials, hardware acquisition, or an independent reviewer. The canonical issue
status remains in `docs/TODO.md`; check an item here only after its evidence is recorded there.

## Current owner actions

- [ ] **OPEN-81 G7 — Carry the Android field matrix.** After the automated bench build is installed,
  carry at least two vendor-distinct phones through a walking route and a real transit/subway route.
  Include genuine GPS loss, a screen-off background receiver, stopping an outing before a delayed
  reply, and revisiting the same peer for a repeated encounter. Record route conditions, phones,
  timestamps and whether every late/repeated result appears exactly once in the ended outing.
- [ ] **OPEN-76 — Long unplugged battery run.** After the agent adds the measurement harness,
  physically unplug at least three charged phones and run the supplied idle/active scenarios for
  the documented duration. Record start/end charge, Android battery statistics, screen state,
  radios, ambient conditions and any vendor battery restrictions. Reconnect the phones afterward
  so the agent can collect and analyze the retained artifacts. The automated bench work is ready;
  pay particular attention to the online phone's BLE scan churn recorded in the 2026-10-22 report.
- [ ] **OPEN-77 — Release-key custody ceremony.** Put the K3 and K4 vault/passphrase halves in
  separate durable offline backups, prove each restoration, and remove development-machine working
  copies when the release ceremony no longer needs them. Do not send keys or passphrases in chat.

## Product decisions — deliberately deferred

- [ ] **OPEN-70 credit/reputation:** choose signed-manifest thresholds for Contacts, Talks, Me-tab
  answers and block count; decide how website, desktop and iOS clients without platform attestation
  participate. Promote the issue before implementation.
- [ ] **OPEN-70 block count:** confirm promotion of the privacy-preserving once-per-reputable-pair
  count before implementation.
- [ ] **OPEN-28:** decide whether to promote the separate TechSupport authority protocol.
- [ ] **Deferred product directions:** promote and scope any item in `docs/TODO.md`'s Deferred
  product decisions section before implementation.

## Access, hardware and external help — deferred

- [ ] **OPEN-03 / OPEN-04:** grant narrowly scoped noninteractive macOS permission for the existing
  `pmset` sleep and `pfctl` loopback/port firewall test helpers if these tests are promoted.
- [ ] **OPEN-07:** select and provide access to a trusted Windows code-signing identity.
- [ ] **OPEN-10:** have the Ubuntu host administrator install the missing Playwright WebKit system
  dependencies with sudo.
- [ ] **OPEN-12:** register and harden the Mac, Windows and Ubuntu CI runners and provide the
  repository access needed by their native jobs.
- [ ] **OPEN-21 / OPEN-22 / OPEN-24:** provide suitable iPhones and any additional certification
  hardware before promoting iOS, Wi-Fi Aware or the full certification matrix.
- [ ] **OPEN-25 / OPEN-26:** engage independent transport and custody security reviewers when those
  reviews are promoted.
