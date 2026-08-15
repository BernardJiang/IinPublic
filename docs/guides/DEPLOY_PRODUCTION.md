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

The root `package.json` is the single release-version source. Use `npm version
patch` (or `minor`/`major`) to bump it; the npm version hook synchronizes the
desktop, Android, and iOS metadata. CI runs `npm run version:check` and rejects
version drift.

To test local installer downloads, first build the artifact, then stage it with
`npm run downloads:stage -- windows` (or `mac`, `linux`, `android`, `ios`). The
stager accepts only an artifact built for the current root version and copies it
to ignored `public/downloads/`. The server also ignores any older files left in
that directory. Supported extensions are `.dmg`, `.exe`, `.AppImage`, `.deb`,
`.apk`, and `.ipa`.

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

URLs may contain a `{version}` placeholder, for example
`https://downloads.iinpublic.com/{version}/IinPublic-Windows.exe`.
Only `https://` hosted download URLs are accepted.

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
