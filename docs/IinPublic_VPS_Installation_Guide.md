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
