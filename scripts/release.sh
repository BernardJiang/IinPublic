#!/usr/bin/env bash
#
# Release procedure — one command, stops at the first failure.
#
#   npm run release              # full release
#   npm run release -- --no-deploy   # tests + bump + builds only (no push, no VPS, no tag)
#
# Steps:
#   1. preflight   clean tree, HEAD contains origin/dev, signing secrets, SDK tools, VPS reachable
#                  and on `dev` with no tracked edits
#   2. test:all    type-check, lint, jest, both builds, every e2e phase — must exit 0
#   3. bump        npm version patch (syncs Android/desktop/iOS), commit "release: <v>"
#   4. build       build:production, then signed Android .aab (Play) + .apk (website download)
#   5. verify      both artifacts signed with CN=IinPublic, versionName == <v>, 16 KB page aligned
#   6. push        origin/dev fast-forwarded to HEAD, tag v<v>, current branch pushed
#   7. deploy      VPS: ff to origin/dev, stop service, npm ci, build:production, start
#   8. check       https://iinpublic.com/api/downloads reports <v>; APK published to downloads
#
# Artifacts land in dist/release/<v>/ (gitignored). The .aab is uploaded to Play Console by hand.
# Log of the run: dist/release/<v>/release.log (and test:all's own phase logs).
#
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

DEPLOY=1
for arg in "$@"; do
  case "$arg" in
    --no-deploy) DEPLOY=0 ;;
    *) echo "unknown option: $arg" >&2; exit 2 ;;
  esac
done

VPS_HOST="${RELEASE_VPS_HOST:-ovh}"
VPS_DIR="${RELEASE_VPS_DIR:-IinPublic}"
SITE_URL="${RELEASE_SITE_URL:-https://iinpublic.com}"
DEPLOY_BRANCH="${RELEASE_DEPLOY_BRANCH:-dev}"
SECRETS="${RELEASE_SECRETS_DIR:-$ROOT/secrets}"

step() { printf '\n\033[1m[release] ── %s ──\033[0m\n' "$*"; }
die()  { printf '\033[31m[release] FAILED: %s\033[0m\n' "$*" >&2; exit 1; }
START=$(date +%s)

# ─── 1. preflight ──────────────────────────────────────────────────────────────────────────
step "1/8 preflight"
[ -z "$(git status --porcelain --untracked-files=no)" ] || die "working tree has uncommitted changes"
BRANCH="$(git branch --show-current)"
[ -n "$BRANCH" ] || die "detached HEAD"
git fetch origin --quiet
git merge-base --is-ancestor "origin/$DEPLOY_BRANCH" HEAD \
  || die "HEAD does not contain origin/$DEPLOY_BRANCH — merge it first so the deploy is a fast-forward"

for f in android-release.keystore android-release.keystore.passphrase; do
  [ -s "$SECRETS/$f" ] || die "missing $SECRETS/$f"
done
SDK="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-$HOME/Library/Android/sdk}}"
APKSIGNER="$(ls -d "$SDK"/build-tools/*/apksigner 2>/dev/null | sort -V | tail -1)"
AAPT="$(ls -d "$SDK"/build-tools/*/aapt 2>/dev/null | sort -V | tail -1)"
[ -x "$APKSIGNER" ] || die "apksigner not found under $SDK/build-tools"
command -v jarsigner >/dev/null || die "jarsigner not found (install a JDK)"

if [ "$DEPLOY" = 1 ]; then
  ssh -o BatchMode=yes -o ConnectTimeout=10 "$VPS_HOST" true || die "cannot ssh $VPS_HOST"
  VPS_BRANCH="$(ssh "$VPS_HOST" "cd ~/$VPS_DIR && git branch --show-current")"
  [ "$VPS_BRANCH" = "$DEPLOY_BRANCH" ] || die "VPS is on '$VPS_BRANCH', expected '$DEPLOY_BRANCH'"
  VPS_DIRTY="$(ssh "$VPS_HOST" "cd ~/$VPS_DIR && git status --porcelain --untracked-files=no")"
  [ -z "$VPS_DIRTY" ] || die "VPS tree has tracked edits:\n$VPS_DIRTY"
fi
echo "[release] branch $BRANCH @ $(git rev-parse --short HEAD), version $(node -p 'require("./package.json").version')"

# ─── 2. all tests ──────────────────────────────────────────────────────────────────────────
step "2/8 npm run test:all (must pass)"
npm run test:all || die "test:all failed — nothing was bumped, built for release, pushed or deployed"

# ─── 3. version bump ───────────────────────────────────────────────────────────────────────
step "3/8 version bump"
npm version patch --no-git-tag-version >/dev/null
npm run --silent version:check
VERSION="$(node -p 'require("./package.json").version')"
OUT="$ROOT/dist/release/$VERSION"
git commit -aqm "release: $VERSION" || die "version commit failed"
echo "[release] version $VERSION"

# ─── 4. builds ─────────────────────────────────────────────────────────────────────────────
step "4/8 production web/server build"
npm run build:production

step "4/8 signed Android .aab + .apk"
export IINPUBLIC_ANDROID_KEYSTORE="$SECRETS/android-release.keystore"
export IINPUBLIC_ANDROID_KEYSTORE_PASSWORD="$(cat "$SECRETS/android-release.keystore.passphrase")"
export IINPUBLIC_ANDROID_KEY_ALIAS="iinpublic-release"
npm run android:bundle:release
(cd android && ./gradlew --quiet assembleRelease)
mkdir -p "$OUT"
cp android/app/build/outputs/bundle/release/app-release.aab "$OUT/IinPublic-$VERSION.aab"
cp android/app/build/outputs/apk/release/app-release.apk   "$OUT/IinPublic-$VERSION-android.apk"

# ─── 5. verify artifacts ───────────────────────────────────────────────────────────────────
step "5/8 verify signatures + version"
# Capture first: `cmd | grep -q` under pipefail fails on SIGPIPE when grep exits early.
AAB_SIG="$(jarsigner -verify -verbose -certs "$OUT/IinPublic-$VERSION.aab" 2>&1 || true)"
grep -q "jar verified" <<<"$AAB_SIG" || die ".aab signature not verified"
grep -q "CN=IinPublic" <<<"$AAB_SIG" || die ".aab not signed with the IinPublic release key"
APK_SIG="$("$APKSIGNER" verify --print-certs "$OUT/IinPublic-$VERSION-android.apk" 2>&1)" \
  || die ".apk signature not verified: $APK_SIG"
grep -q "CN=IinPublic" <<<"$APK_SIG" || die ".apk not signed with the IinPublic release key"
if [ -x "$AAPT" ]; then
  APK_VER="$("$AAPT" dump badging "$OUT/IinPublic-$VERSION-android.apk" | sed -n "s/.*versionName='\([^']*\)'.*/\1/p")"
  [ "$APK_VER" = "$VERSION" ] || die ".apk versionName '$APK_VER' != $VERSION"
fi
# Google Play rejects 64-bit native code without 16 KB page support (libnode, native-lib, libc++).
bash scripts/check-android-16kb.sh "$OUT/IinPublic-$VERSION.aab" "$OUT/IinPublic-$VERSION-android.apk" \
  || die "native libraries are not 16 KB page aligned (scripts/check-android-16kb.sh)"
(cd "$OUT" && shasum -a 256 IinPublic-* > SHA256SUMS)
ls -lh "$OUT"

if [ "$DEPLOY" = 0 ]; then
  step "done (--no-deploy): artifacts in $OUT; commit 'release: $VERSION' is local only"
  exit 0
fi

# ─── 6. push ───────────────────────────────────────────────────────────────────────────────
step "6/8 push"
git tag -a "v$VERSION" -m "release $VERSION"
git push origin "HEAD:$DEPLOY_BRANCH"
git push origin "HEAD:$BRANCH"
git push origin "v$VERSION"

# ─── 7. deploy ─────────────────────────────────────────────────────────────────────────────
step "7/8 deploy to $VPS_HOST"
# Each step on its own under `set -e` (no `| tail` hiding a failure — 2026-10-03 outage);
# the service is stopped before `npm ci` (ENOTEMPTY on node_modules while running).
ssh "$VPS_HOST" "bash -s" <<EOF
set -euo pipefail
cd ~/$VPS_DIR
git fetch origin --quiet
git merge --ff-only origin/$DEPLOY_BRANCH
v=\$(node -p 'require("./package.json").version')
[ "\$v" = "$VERSION" ] || { echo "VPS checked out \$v, expected $VERSION"; exit 1; }
sudo systemctl stop iinpublic
npm ci --no-audit --no-fund
npm run build:production
sudo systemctl start iinpublic
EOF

# ─── 8. live check + APK download ──────────────────────────────────────────────────────────
step "8/8 live check"
scp -q "$OUT/IinPublic-$VERSION-android.apk" "$VPS_HOST:$VPS_DIR/public/downloads/"
ssh "$VPS_HOST" "cd ~/$VPS_DIR && node -e \"require('./scripts/lib/sha256sums').generateManifestForDir('public/downloads', 'SHA256SUMS')\""
ok=0
for _ in $(seq 1 30); do
  body="$(ssh "$VPS_HOST" "curl -fsS $SITE_URL/api/downloads" 2>/dev/null || true)"
  if echo "$body" | grep -q "\"version\":\"$VERSION\""; then ok=1; break; fi
  sleep 4
done
[ "$ok" = 1 ] || die "$SITE_URL/api/downloads does not report $VERSION (last: ${body:-none})"
echo "$body" | grep -q "android" || echo "[release] warning: /api/downloads lists no android file"
ssh "$VPS_HOST" "systemctl is-active iinpublic" >/dev/null || die "iinpublic service not active"

END=$(date +%s)
step "released $VERSION in $(( (END-START)/60 ))m$(( (END-START)%60 ))s"
echo "  live:  $SITE_URL  (/api/downloads reports $VERSION)"
echo "  Play:  upload $OUT/IinPublic-$VERSION.aab in Play Console (versionCode $(sed -n 's/.*versionCode \([0-9]*\).*/\1/p' android/app/build.gradle))"
