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

### Desktop auto-update manifest (added 2026-09-27, docs/TODO.md OPEN-33)

Electron's in-app auto-updater (`platforms/desktop/main.js`'s `autoUpdater`,
already wired: `autoDownload: true`, checks on launch and periodically) reads
`build.publish` in `platforms/desktop/package.json`, now `{ provider: "generic",
url: "https://www.iinpublic.com/downloads/" }` — it needs `latest.yml` (Windows),
`latest-mac.yml` (macOS), or `latest-linux.yml` (Linux) reachable at that same
URL, alongside the exact filename electron-builder itself produced (**not**
`downloads:stage`'s renamed `IinPublic-<version>-<platform>.<ext>` copy — the
auto-updater and the app's own `/downloads` page use two different, coexisting
filenames for the same release). After building a desktop installer, stage its
update manifest too:

```bash
npm run downloads:stage-autoupdate -- mac      # or windows, linux
```

This reads `platforms/desktop/dist/latest*.yml` directly (the real source of
truth for what electron-builder actually named things — never re-derives or
assumes a naming pattern) and copies it plus every file it references into
`public/downloads/`, failing loudly if a referenced file is missing rather than
silently shipping a broken auto-update path.

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
(or from the repo root: `npm run android:build:release`, with the same three
env vars set — it also runs `mobile:stage` first, same as `npm run
android:build` does for the debug APK.)

Output lands at `android/app/build/outputs/apk/release/app-release.apk`. The
stager's android auto-discovery only looks at the `debug` output dir, so stage
a release build with an explicit path:
`node scripts/stage-app-download.mjs android android/app/build/outputs/apk/release/app-release.apk`.
Verify signing before publishing:
`apksigner verify --print-certs <path-to-apk>` should show the `CN=IinPublic`
certificate, not a debug-keystore identity. `apksigner verify --min-sdk-version
21 --verbose` should additionally report `Verified using v1 scheme (JAR
signing): true` — AGP drops v1 signing above minSdk 24 by default
(`android/app/build.gradle`'s `enableV1Signing true`/`enableV2Signing true`
override this; without it some vendor installers reject the APK with "The
installation package does not contain any certificates" even though it
verifies fine with `adb install`/Google Play — found 2026-09-26).

### Google Play submission (Android App Bundle)

Play Console requires an `.aab` (Android App Bundle) upload, not the sideload
APK above — the APK above is for direct/website distribution only (this repo's
own `/downloads` page) and is never uploaded to Play.

```bash
cd android
IINPUBLIC_ANDROID_KEYSTORE="$(pwd)/../secrets/android-release.keystore" \
IINPUBLIC_ANDROID_KEYSTORE_PASSWORD="$(cat ../secrets/android-release.keystore.passphrase)" \
IINPUBLIC_ANDROID_KEY_ALIAS="iinpublic-release" \
./gradlew bundleRelease
```
(or `npm run android:bundle:release` from the repo root, same env vars, runs
`mobile:stage` first.)

Output lands at `android/app/build/outputs/bundle/release/app-release.aab`.
Verify it's signed with the real release key (not unsigned/debug) before
uploading: `jarsigner -verify -verbose -certs app-release.aab` should print
`jar verified` and show the `CN=IinPublic` certificate — `apksigner` does not
operate on `.aab` files directly, only on the APKs Play/`bundletool` later
generate from one. The "PKIX path building failed... unable to find valid
certification path" warning `jarsigner` also prints is expected and harmless:
an Android app-signing key is self-signed by design and is never meant to
chain to a public CA root; Android's own package-manager verification (and
Play's) doesn't use PKIX/browser-style trust chains at all.

On first upload, enroll in **Play App Signing** (Play Console's default and
recommended path since 2021): upload this `.aab` signed with the key above as
the "upload key," and Google re-signs the distributed APKs with its own
managed app-signing key. Keep `secrets/android-release.keystore` regardless —
it remains the upload key for every future release and is what
`apksigner`/`jarsigner` verify against locally; losing it means Play Console's
key-reset process, not a full republish, so it's still worth the same
indefinite backup treatment as any other release key (see above).

A Play Store listing additionally requires, outside this repo: a privacy
policy URL, the Data Safety form (what data the app collects/shares — see
`docs/guides/PLAY_STORE_SUBMISSION.md` for a first-draft answer set grounded
in this app's actual code), the content rating questionnaire, and
permission-usage justifications for sensitive runtime permissions (camera,
location, nearby devices) in the Console's app content section.

### Android distribution channel strategy (decided 2026-09-28)

Both the website's sideload `.apk` (`downloads:stage -- android`) and the
Play Store's `.aab`-derived install share one fixed `applicationId
"com.iinpublic.app"` (`android/app/build.gradle`) — there is no flavor split
between them. Once Play App Signing is enrolled (mandatory for all new apps
since 2021, see above), the two are signed with **different** certificates:
the website's copy with `secrets/android-release.keystore` directly, the Play
copy re-signed by Google's own managed key. Same `applicationId` + different
certificate is exactly the case Android refuses to let coexist — a device
with one already installed will reject installing the other
(`INSTALL_FAILED_UPDATE_INCOMPATIBLE`) until the first is uninstalled, and
because this is a local-first app, uninstalling loses that device's identity/
keys/contacts unless explicitly moved first (see below).

This has no bearing on networking: peer discovery, matching, and chat all run
over the same relay hub and Gun.js protocol regardless of which channel a
device installed from — a sideloaded user and a Play Store user find and
talk to each other exactly like any other two devices. The channel only
affects how one phone installs the app, never who it can reach afterward.

**Decision: Play Store becomes the one primary Android channel.** The
website's `/downloads` page keeps offering the `.apk`, but only as a
secondary "direct install" option (testers, anyone who can't use Play) —
not the path ordinary users are steered toward. Revisit this default if
Play rejection/review risk, F-Droid-style distribution, or a real
sideload-only user base ever makes a second first-class channel worth the
cost below. Not yet implemented: no copy change has been made to the
`/downloads` page or its banners to actually reflect "Play is primary" —
this section records the decision; the messaging update is a separate,
still-open task.

**Backup plan A — separate `applicationId` for the sideload build**, if
true side-by-side coexistence on one device is ever wanted (e.g.
`com.iinpublic.app.direct`, the common "direct download" vs. "store" variant
pattern). They'd become two fully independent apps with no install
conflict — but also two separate local identities with nothing shared
between them unless a user manually links devices; not a free upgrade path,
just a coexistence one.

**Backup plan B — a documented device-linking migration path** for anyone
who already sideloaded and wants to move to the Play Store copy: open
Linked Devices in the sideloaded app (`linked-devices-dialog.ts` /
`WebIdentityLinkService` / `WebDeviceHandoffService` — the existing QR-code
device-linking feature) → link a new device → install the Play Store
version → confirm the link → only then uninstall the sideload install.
Nothing in the app currently tells a user this is the right sequence —
worth a short in-app or FAQ note once Play is actually live and this
scenario can occur for real.

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
