# IinPublic VPS Installation & Deployment Guide

## Final architecture

``` text
Internet
   |
   | HTTPS / WSS :443
   v
Caddy
   |
   | HTTP localhost:8080
   v
IinPublic
   +-- production web SPA
   +-- Node.js server
   +-- GUN relay
   +-- P2P functionality

Internet
   |
   | STUN/TURN :3478 (UDP+TCP) — WebRTC relay fallback, §13
   v
coturn

Domain/DNS: Squarespace
Public site: https://www.iinpublic.com
```

The VPS is primarily a web/relay/bootstrap server, not a large user-file
store.

## 1. Install Node.js on Ubuntu VPS

``` bash
sudo apt update
sudo apt install -y curl ca-certificates
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
sudo apt install -y nodejs

node --version
npm --version
```

Do not run project dependency installation with `sudo npm install`.

## 2. Clone IinPublic and select the correct branch

``` bash
cd ~
git clone YOUR_REPOSITORY_URL IinPublic
cd IinPublic

git fetch origin
git branch -a
git switch YOUR_BRANCH
git pull
```

To make the VPS exactly match a remote branch when local changes do not
matter:

``` bash
git fetch origin
git switch YOUR_BRANCH
git reset --hard origin/YOUR_BRANCH
```

## 3. Install dependencies

If `package-lock.json` exists:

``` bash
npm ci
```

`npm install` is also suitable during development.

## 4. Development mode

Normal development:

``` bash
npm run dev
```

When running behind an HTTPS reverse proxy:

``` bash
IINPUBLIC_TLS_TERMINATED_BY_PROXY=1 npm run dev
```

Development uses approximately:

``` text
Webpack frontend :3001
Node/GUN backend :8080
```

Do not use `npm run dev` for the permanent public deployment. It uses
development behavior including `reset-dev-data.js`, `DEV_GUN_FRESH=1`,
`tsx watch`, and webpack-dev-server.

## 5. Build and test production

``` bash
cd ~/IinPublic
npm run build:production
IINPUBLIC_TLS_TERMINATED_BY_PROXY=1 npm start
```

The production start configuration uses:

``` text
NODE_ENV=production
RELAY_ONLY_HUB=1
STAR_SERVER_PERSISTENCE=ephemeral
```

The production server listens on port 8080.

From another SSH session verify:

``` bash
curl -I http://127.0.0.1:8080/
```

Expected:

``` text
HTTP/1.1 200 OK
```

Do not use `https://YOUR_VPS_IP:8080`. Port 8080 intentionally speaks
HTTP:

``` text
Browser --HTTPS--> Caddy :443 --HTTP--> IinPublic :8080
```

## 6. Run IinPublic with systemd

Create:

``` bash
sudo nano /etc/systemd/system/iinpublic.service
```

Contents:

``` ini
[Unit]
Description=IinPublic production server
After=network.target

[Service]
Type=simple
User=ubuntu
WorkingDirectory=/home/ubuntu/IinPublic
Environment=IINPUBLIC_TLS_TERMINATED_BY_PROXY=1
ExecStart=/usr/bin/npm start
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

Enable it:

``` bash
sudo systemctl daemon-reload
sudo systemctl enable --now iinpublic
sudo systemctl status iinpublic
```

Useful commands:

``` bash
sudo systemctl start iinpublic
sudo systemctl stop iinpublic
sudo systemctl restart iinpublic
sudo systemctl status iinpublic
journalctl -u iinpublic -f
```

Once systemd manages production, normally do not run `npm start`
manually.

## 7. Install Caddy

``` bash
sudo apt update
sudo apt install -y caddy
sudo nano /etc/caddy/Caddyfile
```

Use:

``` caddy
iinpublic.com, www.iinpublic.com {
    reverse_proxy 127.0.0.1:8080
}
```

Validate and restart:

``` bash
sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl restart caddy
sudo systemctl status caddy
```

Verify listeners:

``` bash
sudo ss -ltnp | grep -E ':80|:443|:8080'
```

Expected:

``` text
:80    Caddy
:443   Caddy
:8080  IinPublic/Node
```

Test the redirect:

``` bash
curl -I -H "Host: iinpublic.com" http://127.0.0.1
```

Expected:

``` text
HTTP/1.1 308 Permanent Redirect
Location: https://iinpublic.com/
Server: Caddy
```

## 8. Point Squarespace DNS to the VPS

Squarespace can remain the domain registrar/DNS provider. This is a DNS
change, not a URL redirect.

Remove the old website `www` record if it points to the previous host,
such as:

``` text
CNAME  www  -> www.iinpublic.com.ghs.googlehosted.com
```

Create:

``` text
Type:  A
Host:  @
Value: YOUR_VPS_IP
```

and:

``` text
Type:  CNAME
Host:  www
Value: iinpublic.com
```

Final web records:

``` text
@      A       YOUR_VPS_IP
www    CNAME   iinpublic.com
```

Do not delete unrelated MX/TXT records used for email, SPF, DKIM, or
verification.

## 9. Verify DNS

``` bash
dig +short iinpublic.com
dig +short www.iinpublic.com
```

The root should resolve to the VPS. `www` may show `iinpublic.com.`
followed by the same IP.

Check for obsolete IPv6 records too:

``` bash
dig +short AAAA iinpublic.com
dig +short AAAA www.iinpublic.com
```

If IPv6 is not configured, these should normally return nothing.

## 10. Enable HTTPS

After DNS points to the VPS:

``` bash
sudo systemctl restart caddy
sudo journalctl -u caddy -f
```

Caddy automatically performs ACME validation and obtains/renews Let's
Encrypt certificates for `iinpublic.com` and `www.iinpublic.com`.

Look for:

``` text
certificate obtained successfully
```

Then visit:

``` text
https://iinpublic.com
https://www.iinpublic.com
```

## 11. Take IinPublic offline

Temporarily stop it:

``` bash
sudo systemctl stop iinpublic
```

Bring it back:

``` bash
sudo systemctl start iinpublic
```

Prevent startup after reboot:

``` bash
sudo systemctl disable --now iinpublic
```

Re-enable:

``` bash
sudo systemctl enable --now iinpublic
```

Normally leave Caddy and DNS unchanged during a temporary shutdown.

## 12. Deploy future updates

The normal update workflow is:

``` bash
cd ~/IinPublic
git pull
npm ci
npm run build:production
sudo systemctl restart iinpublic
```

Verify:

``` bash
sudo systemctl status iinpublic
curl -I http://127.0.0.1:8080/
```

Then test `https://www.iinpublic.com`.

Normally there is no need to change Squarespace DNS or Caddy again.

## 13. Set up a TURN server for WebRTC NAT traversal

### Why this exists

WebRTC connections try, in order: host candidates (same machine/LAN), STUN-derived candidates
(NAT traversal via public STUN servers), then TURN relay as the last resort. Without a TURN
server, that last step doesn't exist — two devices whose NAT/router combination can't connect
via host or STUN candidates alone simply fail to form a P2P session, with nothing to fall back
to. This was diagnosed live (2026-09-03): three phones on the same home WiFi, one pair connected
fine via STUN, another pair got a `WebRTC connection timeout` with no fallback available. Router
NAT-hairpin support is inconsistent across hardware, and it's genuinely common for it to work
for one device on a network and not another — this isn't a misconfiguration to hunt down so much
as a fact of life WebRTC deployments handle by having a TURN relay as backup.

This is a text-first app (talks, tags, chat messages) — TURN is the fallback path, not the
default one, so bandwidth stays small even under heavy fallback use. See "Bandwidth and abuse
ceiling" below for the actual limits configured.

### Install coturn

``` bash
sudo apt update
sudo apt install -y coturn
```

The package auto-enables and starts the systemd service immediately with an unconfigured
default config — stop it before it sits exposed with no real auth:

``` bash
sudo systemctl stop coturn
```

### Generate a shared secret

``` bash
openssl rand -hex 32
```

Save this value — it goes in two places below, and must match exactly in both. Never commit it
to the repo.

### Configure `/etc/turnserver.conf`

Back up the package default first, then write:

``` bash
sudo cp /etc/turnserver.conf /etc/turnserver.conf.orig-backup
sudo nano /etc/turnserver.conf
```

``` ini
listening-port=3478
external-ip=YOUR_VPS_IP
listening-ip=0.0.0.0
realm=iinpublic.com

# Time-limited credentials only (coturn's "TURN REST API" convention) — matches
# src/server/services/turn-credentials.ts, which mints credentials this secret verifies.
use-auth-secret
static-auth-secret=YOUR_GENERATED_SECRET

# Narrow relay port range — default is 49152-65535, far more than this app's scale needs.
min-port=49160
max-port=49223

# Refuse to relay to private/loopback ranges (SSRF prevention — otherwise the TURN server
# could be abused to reach services on the VPS's own internal network).
denied-peer-ip=0.0.0.0-0.255.255.255
denied-peer-ip=10.0.0.0-10.255.255.255
denied-peer-ip=100.64.0.0-100.127.255.255
denied-peer-ip=127.0.0.0-127.255.255.255
denied-peer-ip=169.254.0.0-169.254.255.255
denied-peer-ip=172.16.0.0-172.31.255.255
denied-peer-ip=192.0.0.0-192.0.0.255
denied-peer-ip=192.168.0.0-192.168.255.255
denied-peer-ip=198.18.0.0-198.19.255.255

# Bandwidth/abuse ceiling — see "Bandwidth and abuse ceiling" below.
total-quota=100
bps-capacity=0
user-quota=12

no-multicast-peers
no-cli
no-stdout-log
syslog
```

TLS/DTLS TURN (port 5349) is deliberately not enabled here — that's about firewall/DPI evasion,
not NAT traversal, which isn't the problem being solved. Caddy already holds a Let's Encrypt
cert for this domain if TURNS is ever needed later; reuse it rather than provisioning a separate
one.

Lock down the file (it holds the shared secret):

``` bash
sudo chown root:root /etc/turnserver.conf
sudo chmod 640 /etc/turnserver.conf
sudo chgrp turnserver /etc/turnserver.conf
```

Start it:

``` bash
sudo systemctl start coturn
sudo systemctl status coturn
```

Verify it's listening and check for config errors:

``` bash
sudo journalctl -u coturn --no-pager -n 40
sudo ss -tlnp | grep 3478
sudo ss -ulnp | grep 3478
```

Warnings about a missing TLS certificate file are expected and harmless — TLS/DTLS wasn't
configured on purpose (see above).

### Wire the same secret into IinPublic

Add to `/etc/systemd/system/iinpublic.service`'s `[Service]` block, alongside the existing
`Environment=IINPUBLIC_TLS_TERMINATED_BY_PROXY=1` line:

``` ini
Environment=TURN_SHARED_SECRET=YOUR_GENERATED_SECRET
Environment=TURN_SERVER_HOST=YOUR_VPS_IP
```

(`TURN_SERVER_PORT` only needs setting if coturn isn't on the default 3478.) Then:

``` bash
sudo systemctl daemon-reload
sudo systemctl restart iinpublic
```

### Verify end-to-end

``` bash
curl -sS http://127.0.0.1:8080/api/turn-credentials
```

Expect `{"username":"...","credential":"...","ttl":3600,"urls":["turn:YOUR_VPS_IP:3478?transport=udp","turn:YOUR_VPS_IP:3478?transport=tcp"]}`.
An empty `{"urls":[]}` means `TURN_SHARED_SECRET`/`TURN_SERVER_HOST` aren't set on the running
process — check the systemd unit and confirm `daemon-reload` + `restart` actually happened.

To test the credentials actually authenticate against coturn (not just that the endpoint
returns something), use the credentials from the response above with coturn's own test client:

``` bash
turnutils_uclient -t -T -u USERNAME_FROM_RESPONSE -w CREDENTIAL_FROM_RESPONSE YOUR_VPS_IP
```

A successful allocation confirms the shared secret matches on both sides and coturn is actually
relaying.

### Rotating the secret

Generate a new secret with `openssl rand -hex 32`, update it in **both**
`/etc/turnserver.conf`'s `static-auth-secret` and the systemd unit's
`TURN_SHARED_SECRET`, then:

``` bash
sudo systemctl restart coturn
sudo systemctl daemon-reload
sudo systemctl restart iinpublic
```

Credentials already handed to a connected client stay valid until their TTL (default 1h)
expires — this isn't a hard cutover, just a bounded overlap window.

### Bandwidth and abuse ceiling

`total-quota=100` / `user-quota=12` caps concurrent relayed allocations (not raw bandwidth) —
generous headroom over this deployment's actual scale, a hard ceiling regardless of how many
credentials get minted. `/api/turn-credentials` has no auth beyond what the rest of the app
already has (none — it's a public P2P app), matching the existing security model: the real
protection against abuse is the short credential TTL plus this quota, not gatekeeping who can
ask for credentials. Raise the quota if legitimate concurrent usage ever needs it; there's no
reason to raise it preemptively.

## Troubleshooting

### `https://IP:8080` gives an SSL/protocol error

Expected. Port 8080 is HTTP-only; use the HTTPS domain through Caddy.

### Site stays at "Connecting to IinPublic network..."

Use browser Developer Tools -\> Console and Network. Check failed GUN,
WebSocket, API, `ws:` and `wss:` requests. Verify IinPublic is running
and Caddy proxies to 8080.

### Caddy cannot obtain a certificate

Verify DNS first:

``` bash
dig +short iinpublic.com
dig +short www.iinpublic.com
```

Then:

``` bash
sudo systemctl restart caddy
sudo journalctl -u caddy -n 100 --no-pager
```

### Ctrl+C does not stop manually started Node

``` bash
ps -ef | grep 'dist/server/server/index.js' | grep -v grep
kill PID
```

If necessary:

``` bash
kill -9 PID
```

For production, prefer systemd start/stop/restart commands.

### Some device pairs can message each other, others can't ("WebRTC connection timeout")

Signaling can succeed (both devices exchange offer/answer/ICE candidates fine) while the actual
peer connection still times out — that's STUN-only NAT traversal failing for that specific
pair, with no TURN relay configured as a fallback. See §13 above. Confirm the TURN server is
actually reachable and returning credentials:

``` bash
curl -sS http://127.0.0.1:8080/api/turn-credentials
sudo systemctl status coturn
```

If `/api/turn-credentials` returns `{"urls":[]}`, the relay's `TURN_SHARED_SECRET`/
`TURN_SERVER_HOST` env vars aren't set — check the systemd unit.
