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

### Android release signing (added 2026-09-22)

`android/app/build.gradle`'s `release` build type only signs the APK when
`IINPUBLIC_ANDROID_KEYSTORE` is set in the environment — left unset,
`./gradlew assembleRelease` still builds, just unsigned (same as before this
config existed). The release keystore itself (`secrets/android-release.keystore`,
gitignored, 4096-bit RSA, ~30-year validity) and its passphrase
(`secrets/android-release.keystore.passphrase`) must be preserved indefinitely —
losing them means no future release can update an already-installed app; back
both up somewhere durable outside this machine (a password manager entry
holding the passphrase plus an encrypted copy of the keystore file is enough).

```bash
cd android
IINPUBLIC_ANDROID_KEYSTORE="$(pwd)/../secrets/android-release.keystore" \
IINPUBLIC_ANDROID_KEYSTORE_PASSWORD="$(cat ../secrets/android-release.keystore.passphrase)" \
IINPUBLIC_ANDROID_KEY_ALIAS="iinpublic-release" \
./gradlew assembleRelease
```

Output lands at `android/app/build/outputs/apk/release/app-release.apk`. The
stager's android auto-discovery only looks at the `debug` output dir, so stage
a release build with an explicit path:
`node scripts/stage-app-download.mjs android android/app/build/outputs/apk/release/app-release.apk`.
Verify signing before publishing:
`apksigner verify --print-certs <path-to-apk>` should show the `CN=IinPublic`
certificate, not a debug-keystore identity.

Desktop installers built on this Mac are ad-hoc signed on macOS (see
`platforms/desktop/afterPack.js`'s doc comment — this is the project's normal,
accepted state, not a gap to fix) and unsigned on Windows/Linux — no paid
code-signing certificate is set up for those yet, so first-run OS warnings
(Gatekeeper "unidentified developer", SmartScreen) are expected.

After building, push new-version artifacts straight to `~/IinPublic/public/downloads/`
on the VPS (`scp`, matching the `IinPublic-<version>-<platform>.<ext>` naming
`stage-app-download.mjs` produces) and regenerate that directory's manifest
remotely — no rebuild/restart of the running service is needed for a
downloads-only update:
```bash
ssh ovh "cd ~/IinPublic && node -e \"require('./scripts/lib/sha256sums').generateManifestForDir('public/downloads', 'SHA256SUMS')\""
```

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
