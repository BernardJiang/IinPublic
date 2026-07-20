# LAN HTTPS (dev)

Serve the dev app over HTTPS on your local network so other devices (a Windows
PC, a phone) can reach it in a **secure context**. This is required because
Gun.js SEA uses WebCrypto, which browsers only expose over `https://` (or
`localhost`). Without it, SEA force-redirects `http://192.168.x.x` → `https://…`
to a port that isn't listening, so remote clients can't connect at all.

## One-time setup on the Mac mini (the host)

```bash
# 1. Generate a self-signed cert with your LAN IP baked into the SAN.
#    Re-run this whenever your LAN IP changes.
./scripts/gen-dev-cert.sh
#    (force a specific IP if auto-detect is wrong:)
#    LAN_IP=192.168.1.42 ./scripts/gen-dev-cert.sh

# 2. Start the dev servers as usual — they auto-detect certs/dev-*.pem.
npm run dev
```

When the cert is present you'll see `🔒 HTTPS enabled for LAN` in the server log,
and the webpack dev server serves over `https://` too. Delete `certs/` (or run
`npm run dev` without generating a cert) to go back to plain HTTP.

## On the Windows PC (the client)

The cert is self-signed, so each **origin** must be trusted once. In the
browser, visit each of these and click through the warning
(**Advanced → Proceed**):

1. `https://<mac-lan-ip>:8080`  ← the API / Gun / Socket.IO backend
2. `https://<mac-lan-ip>:3001`  ← the app UI

You must accept **both** — the page is on `:3001` but it calls `:8080`, and the
browser blocks calls to an untrusted cert silently. After accepting, load
`https://<mac-lan-ip>:3001` and it works.

> Tip: to avoid the click-through warnings entirely, use `mkcert` instead —
> generate a locally-trusted cert and install its root CA on the Windows PC.
> The server/webpack wiring here works with any key/cert pair (point at them
> with `TLS_KEY_PATH` / `TLS_CERT_PATH`).

## Notes

- `NODE_ENV=production` disables the dev-cert path on the server (production is
  expected to terminate TLS upstream).
- `certs/` is gitignored — certs are per-machine and must never be committed.
- No Gun library source is patched; the SEA https-redirect now simply succeeds
  because a real HTTPS listener exists.
