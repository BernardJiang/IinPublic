# x3-identity-linking

covers: SPEC-3.1  <!-- auto-seeded; refine by hand -->

Two real installations with independent SEA identities establish a direct link only after both
signed attestations verify. The scenario rejects one-sided claims and confirms that removing the
link supersedes it for future decisions without merging identity-owned data or erasing historical
signatures.

The browser-to-browser protocol and GUI are exercised by `stage2/73`. X3 now runs that protocol
through a clean desktop website profile and the real Android shell/embedded-node HTTP relay. It
checks a cancelled one-sided request, mutual approval, replay rejection, stable identities,
Android force-stop/relaunch durability, and unlink/revocation convergence.

The test is intentionally opt-in because it clears the selected app profile. Run
`npm run test:e2e:x3-android`; the runner checks ADB availability before building, installs the
current APK with a bounded timeout, and then executes the two X3 cases.
