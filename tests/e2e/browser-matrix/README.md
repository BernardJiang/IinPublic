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
the same bidirectional matched thread. A three-peer topology, reconnect, and restart
persistence remain subsequent slices.
