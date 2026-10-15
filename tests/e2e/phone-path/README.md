# Phone-path journeys

User journeys run through **phone-like embedded nodes** instead of straight against the hub, so
the route a real Android phone takes is tested on every run without a phone:

```
browser (stands in for the WebView) → embedded node (scripts/e2e-phone-node.mjs) → hub
```

Each phone node runs `dist/server/node-app/embedded-node.js` — the program the Android app boots —
in the production relay mode (`explicit-http`), at the release room capacity, with a fresh data
dir, and with mDNS LAN discovery off (so the phones meet only through the hub, and real phones on the
Wi-Fi cannot leak data in; `PHONE_NODE_LAN_DISCOVERY=1` turns it on), and with `globalThis.crypto` hidden (`scripts/e2e-phone-runtime.cjs`) because Node 18 on the
phone has no global WebCrypto. There are two phone nodes ("phoneA", "phoneB") so that "the other
user" really is on another device and can only learn things through the hub.

```bash
npm run test:e2e:phone-path            # builds dist/, then runs these specs
npm run test:e2e:phone-path:slow-hub   # same, with 400 ms added to every hub API call
```

Specs 03 and 05 start extra phone nodes of their own (`startPhoneNode`, ports 18190–18199): one
whose hub is down, and one restarted on the same data dir.

Debugging: `PHONE_PATH_CONSOLE=1` prints browser errors and failing requests,
`PHONE_PATH_CONSOLE=all` every console line, `PHONE_PATH_TRACE_API=1` every room API response,
`PHONE_PATH_SERVER_LOGS=1` the hub's and phone nodes' logs. Each room move prints a `[timing]` line.

See `docs/testing/journey-coverage.md` for which use cases these cover and the rules for adding
journeys (assert on the other user's side; one journey per bug found on a device).
