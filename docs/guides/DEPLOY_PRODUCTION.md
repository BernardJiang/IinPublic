# Publish IinPublic at iinpublic.com

The production service is one long-running Node.js process. It serves the web
client, the Express API, Socket.IO, the Gun relay, health checks, and optional
native-app download links from one HTTPS origin.

## Local production check

```bash
npm ci
npm run build:production
PORT=8080 npm start
```

The server refuses to start without HTTPS. Generate the local certificate first
with `./scripts/gen-dev-cert.sh`, then open `https://localhost:8080` and check
`https://localhost:8080/health`.

To test local installer downloads, place signed release files in
`public/downloads/`. Supported extensions are `.dmg`, `.exe`, `.AppImage`,
`.deb`, `.apk`, and `.ipa`. The directory is intentionally ignored by Git.

## Container check

```bash
docker build -t iinpublic .
docker run --init --rm -p 8080:8080 \
  -v "$PWD/certs:/app/certs:ro" iinpublic
```

The image contains both `dist/web` and `dist/server`; its health check calls
`/health`.

## Render deployment

`render.yaml` describes a first public deployment from the `dev` branch. Link
the GitHub repository as a Render Blueprint. Render builds the Dockerfile,
keeps WebSocket traffic on the same service, and provisions HTTPS.

The Blueprint starts on Render's free instance for a no-cost cutover test.
Before inviting normal users, change `plan` to `starter` or another always-on
instance type so the relay does not sleep.

Set installer URLs in the Render environment when signed release assets are
hosted outside the container:

- `IINPUBLIC_DOWNLOAD_MAC_URL`
- `IINPUBLIC_DOWNLOAD_WINDOWS_URL`
- `IINPUBLIC_DOWNLOAD_LINUX_URL`
- `IINPUBLIC_DOWNLOAD_ANDROID_URL`
- `IINPUBLIC_DOWNLOAD_IOS_URL`

Do not publish unsigned desktop installers, debug APKs, or unsigned iOS builds
as end-user releases.

## Domain cutover

The current `www` record points to `ghs.googlehosted.com`. After Render reports
the service healthy and provides its `*.onrender.com` hostname:

1. Add `www.iinpublic.com` as the service's custom domain in Render.
2. In Squarespace Domains DNS, replace the existing `www` CNAME with the exact
   Render hostname.
3. Remove conflicting `AAAA` records, if any.
4. Verify the custom domain in Render and wait for its TLS certificate.
5. Confirm `/health`, `/`, `/gun`, Socket.IO, and `/api/downloads` over HTTPS.

Keep the old DNS value recorded until the final health check succeeds so the
change can be rolled back quickly.
