# Mixed-browser E2E matrix

These opt-in specs launch different browser engines in the same Playwright test
so they exercise actual cross-engine peer communication rather than running one
scenario independently in each project.

Run the current mixed-browser slice with:

```bash
npm run test:e2e:mixed-browsers
```

Current coverage: `chromium-alice` creates a one-question matching Talk,
`webkit-bob` answers it, and the resulting thread delivers one message in each
direction. `npm run test:e2e:macos-firefox` additionally uses the installed stable
Firefox release for Chromium ↔ Firefox and Firefox ↔ WebKit matched threads, with
messages verified in both directions. On the Windows worker, the matrix runner
launches installed Microsoft Edge and Playwright Firefox simultaneously and verifies
the same bidirectional matched thread.

`03-reconnect-and-restart.spec.ts` covers reconnect and restart persistence across a
Chromium ↔ WebKit pairing: `chromium-alice` goes offline via `context().setOffline(true)`
while `webkit-bob` sends a message, then coming back online proves the message still
arrives (state convergence through the offline-mailbox/Gun-sync path, not a live
DataChannel); a subsequent `page.reload()` proves `chromium-alice`'s identity and the
matched conversation's message history survive a simulated app restart (same
IndexedDB/localStorage, mirroring `stage2-two-user/40-blocklist-persist-restart.spec.ts`'s
established single-engine pattern).
