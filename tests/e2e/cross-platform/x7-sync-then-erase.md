# x7-sync-then-erase

covers: SPEC-19.14, docs/TODO.md item J, spec §11.2/§11.3

Same-machine two-installation encrypted handoff, but cross-platform: a hosted website
tab and a native webapp (Electron/embedded-node) on the same computer, linked, syncing
a device's data before erase, exactly like the ordinary-browser proof in
`stage2-two-user/74-device-handoff-transfer.spec.ts` (read that spec's own companion
`.md` for the full step-by-step — the mechanism under test is identical). Blocked only
on a real native-shell CI runner (docs/TODO.md Priority 3), not on the handoff protocol
itself.
