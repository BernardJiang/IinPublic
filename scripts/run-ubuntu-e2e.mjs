#!/usr/bin/env node

import { execFileSync, spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const hostConfig = JSON.parse(
  fs.readFileSync(path.join(repoRoot, 'tests', 'matrix', 'hosts.json'), 'utf8'),
).ubuntu;
const sshHost = process.env.UBUNTU_E2E_SSH_HOST || hostConfig.sshHost;
const display = process.env.UBUNTU_E2E_DISPLAY || hostConfig.display;
const required = process.env.UBUNTU_E2E_REQUIRED === '1';
const preflightOnly = process.argv.includes('--preflight');
const desktopMode = process.argv.includes('--desktop');
const chromiumMode = process.argv.includes('--chromium');
const sshOptions = ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=8'];
const revision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' }).trim();

function shellQuote(value) {
  return `'${String(value).replaceAll("'", `'"'"'`)}'`;
}

function runRemote(script, options = {}) {
  const stdio = options.stdio === 'inherit'
    ? ['pipe', 'inherit', 'inherit']
    : options.stdio || ['pipe', 'pipe', 'pipe'];
  return spawnSync('ssh', [...sshOptions, sshHost, 'sh', '-s'], {
    cwd: repoRoot,
    input: script,
    encoding: options.encoding || 'utf8',
    stdio,
    timeout: options.timeoutMs || 30_000,
  });
}

function resultDetail(result) {
  return result.error?.message || result.stderr?.trim() || `exit ${result.status}`;
}

function skipOrFail(message) {
  const prefix = required ? 'FAIL' : 'SKIP';
  console.error(`[ubuntu-e2e] ${prefix}: ${message}`);
  process.exit(required ? 1 : 0);
}

if (!/^:[0-9]+$/.test(display)) {
  skipOrFail(`invalid X11 display ${JSON.stringify(display)}; no tests started.`);
}
const displayNumber = display.slice(1);

// Mandatory first gate: do not prepare tools, archive, deploy, build, or run tests
// until the SSH endpoint proves reachable and its local desktop is accessible.
const availability = runRemote(`
set -eu
uid=$(id -u)
xauthority="/run/user/$uid/gdm/Xauthority"
test -S ${shellQuote(`/tmp/.X11-unix/X${displayNumber}`)}
test -r "$xauthority"
DISPLAY=${shellQuote(display)} XAUTHORITY="$xauthority" xdpyinfo >/dev/null
python3 - <<'PY'
import json, os, platform, shutil
os_release = {}
with open('/etc/os-release', encoding='utf-8') as handle:
    for line in handle:
        key, separator, value = line.rstrip().partition('=')
        if separator:
            os_release[key] = value.strip('"')
workspace = os.path.join(
    os.path.expanduser('~'),
    ${JSON.stringify(hostConfig.workspaceRoot)},
    ${JSON.stringify(revision)},
)
print(json.dumps({
    'hostname': platform.node(),
    'home': os.path.expanduser('~'),
    'uid': os.getuid(),
    'os': os_release.get('PRETTY_NAME', platform.platform()),
    'osId': os_release.get('ID', ''),
    'architecture': platform.machine(),
    'freeKb': shutil.disk_usage(os.path.expanduser('~')).free // 1024,
    'revisionReady': (
        os.path.isfile(os.path.join(workspace, 'package.json'))
        and os.path.isdir(os.path.join(workspace, 'node_modules'))
        ${desktopMode ? "and os.path.isdir(os.path.join(workspace, 'platforms', 'desktop', 'node_modules'))" : ''}
    ),
}, separators=(',', ':')))
PY
`, { timeoutMs: 15_000 });

if (availability.error || availability.status !== 0) {
  skipOrFail(`SSH host ${sshHost} or display ${display} is unavailable (${resultDetail(availability)}); no tests started.`);
}

let remote;
try {
  remote = JSON.parse(availability.stdout.trim());
} catch {
  skipOrFail(`SSH host ${sshHost} did not return a valid Ubuntu preflight response; no tests started.`);
}
if (remote.osId !== 'ubuntu' || remote.architecture !== 'x86_64') {
  skipOrFail(`expected Ubuntu x86_64 but found ${remote.os} (${remote.architecture}); no tests started.`);
}
if (!remote.revisionReady) {
  // Keep the small Ubuntu worker usable across commits. Only directories with
  // our exact marker and a 40-character Git object name are eligible.
  const prune = runRemote(`
set -eu
root=${shellQuote(`${remote.home}/${hostConfig.workspaceRoot}`)}
if [ -d "$root" ]; then
  for candidate in "$root"/*; do
    [ -d "$candidate" ] || continue
    name=$(basename "$candidate")
    printf '%s' "$name" | grep -Eq '^[0-9a-f]{40}$' || continue
    [ -f "$candidate/.iinpublic-e2e-workspace" ] || continue
    [ "$(cat "$candidate/.iinpublic-e2e-workspace")" = 'iinpublic-ubuntu-e2e-v1' ] || continue
    rm -rf -- "$candidate"
  done
fi
df -Pk ${shellQuote(remote.home)} | awk 'NR == 2 { print $4 }'
`, { timeoutMs: 120_000 });
  if (prune.error || prune.status !== 0) {
    skipOrFail(`could not prune runner-owned Ubuntu workspaces: ${resultDetail(prune)}; no tests started.`);
  }
  const freeAfterPrune = Number(prune.stdout.trim().split(/\s+/).at(-1));
  if (Number.isFinite(freeAfterPrune)) remote.freeKb = freeAfterPrune;
}
const minimumFreeKb = remote.revisionReady ? 750_000 : 2_500_000;
if (Number(remote.freeKb) < minimumFreeKb) {
  skipOrFail(
    `only ${remote.freeKb} KiB is free on ${sshHost}; at least ${minimumFreeKb} KiB is required for ` +
      `${remote.revisionReady ? 'revision reuse' : 'fresh provisioning'}; no tests started.`,
  );
}
console.log(
  `[ubuntu-e2e] available: ${remote.hostname} (${remote.os}, ${remote.architecture}, display ${display}, ${remote.freeKb} KiB free)`,
);

const nodeFolder = `node-v${hostConfig.nodeVersion}-linux-x64`;
const toolsDir = `${remote.home}/iinpublic-tools`;
const nodeDir = `${toolsDir}/${nodeFolder}`;
const nodeExe = `${nodeDir}/bin/node`;
const npmCli = `${nodeDir}/lib/node_modules/npm/bin/npm-cli.js`;
const npxCli = `${nodeDir}/lib/node_modules/npm/bin/npx-cli.js`;
const xauthority = `/run/user/${remote.uid}/gdm/Xauthority`;

const prepareTools = runRemote(`
set -eu
tools=${shellQuote(toolsDir)}
node_dir=${shellQuote(nodeDir)}
if [ ! -x "$node_dir/bin/node" ]; then
  mkdir -p "$tools"
  archive="$tools/${nodeFolder}.tar.xz"
  curl -fL --retry 2 --connect-timeout 15 -o "$archive" ${shellQuote(hostConfig.nodeArchiveUrl)}
  tar -xJf "$archive" -C "$tools"
fi
"$node_dir/bin/node" --version
`, { timeoutMs: 120_000 });
if (prepareTools.error || prepareTools.status !== 0) {
  skipOrFail(`Ubuntu tool preparation failed: ${resultDetail(prepareTools)}`);
}
console.log(`[ubuntu-e2e] runtime: ${prepareTools.stdout.trim()}`);
if (preflightOnly) {
  console.log('[ubuntu-e2e] preflight passed; no tests started.');
  process.exit(0);
}
if (Number(desktopMode) + Number(chromiumMode) !== 1) {
  console.error(
    '[ubuntu-e2e] specify exactly one of --chromium or --desktop ' +
      '(or use the matching npm script).',
  );
  process.exit(2);
}

const shortRevision = revision.slice(0, 12);
const workspace = `${remote.home}/${hostConfig.workspaceRoot}/${revision}`;
const modeName = desktopMode ? 'desktop' : 'chromium';
const runId = `ubuntu-${modeName}-${shortRevision}-${Date.now()}`;
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'iinpublic-ubuntu-e2e-'));
const archivePath = path.join(tempDir, `iinpublic-${shortRevision}.tar.gz`);

try {
  execFileSync('git', ['archive', '--format=tar.gz', '--output', archivePath, revision], {
    cwd: repoRoot,
    stdio: 'inherit',
  });
  const createWorkspace = runRemote(`
set -eu
workspace=${shellQuote(workspace)}
mkdir -p "$workspace"
printf '%s' 'iinpublic-ubuntu-e2e-v1' > "$workspace/.iinpublic-e2e-workspace"
`, { timeoutMs: 30_000 });
  if (createWorkspace.error || createWorkspace.status !== 0) {
    throw new Error(`could not create remote workspace: ${resultDetail(createWorkspace)}`);
  }
  execFileSync(
    'scp',
    [...sshOptions, archivePath, `${sshHost}:${workspace}/source.tar.gz`],
    { cwd: repoRoot, stdio: 'inherit', timeout: 120_000 },
  );
} finally {
  fs.rmSync(tempDir, { recursive: true, force: true });
}

const displayEnvironment = `
export DISPLAY=${shellQuote(display)}
export XAUTHORITY=${shellQuote(xauthority)}
export XDG_RUNTIME_DIR=${shellQuote(`/run/user/${remote.uid}`)}
export DBUS_SESSION_BUS_ADDRESS=${shellQuote(`unix:path=/run/user/${remote.uid}/bus`)}
export ELECTRON_OZONE_PLATFORM_HINT=x11
`;

const testActions = desktopMode
  ? `
${shellQuote(nodeExe)} ${shellQuote(npmCli)} run build:embedded
${shellQuote(nodeExe)} ${shellQuote(npmCli)} run desktop:stage-deps

cd "$workspace/platforms/desktop"
desktop_hash=$(sha256sum package-lock.json | awk '{print $1}')
if [ -d node_modules ] && [ -f .iinpublic-dependencies.sha256 ] && [ "$(cat .iinpublic-dependencies.sha256)" = "$desktop_hash" ]; then
  echo '[ubuntu-e2e] reusing verified desktop dependencies'
else
  ${shellQuote(nodeExe)} ${shellQuote(npmCli)} ci --no-audit --no-fund
  printf '%s' "$desktop_hash" > .iinpublic-dependencies.sha256
fi
${shellQuote(nodeExe)} ${shellQuote(npmCli)} run dist:linux

appimage=$(find "$workspace/platforms/desktop/dist" -maxdepth 1 -type f -name '*.AppImage' -print -quit)
if [ -z "$appimage" ]; then
  echo '[ubuntu-e2e] AppImage was not produced' >&2
  exit 1
fi
app_hash=$(sha256sum "$appimage" | awk '{print $1}')
app_size=$(stat -c '%s' "$appimage")
echo "[ubuntu-e2e] built AppImage: $(basename "$appimage") ($app_size bytes, sha256 $app_hash)"

install_dir=$(mktemp -d "$workspace/desktop-test-install.XXXXXX")
cp "$appimage" "$install_dir/IinPublic.AppImage"
chmod +x "$install_dir/IinPublic.AppImage"
cd "$install_dir"
./IinPublic.AppImage --appimage-extract >/dev/null
installed_executable="$install_dir/squashfs-root/iinpublic-desktop"
if [ ! -x "$installed_executable" ]; then
  echo "[ubuntu-e2e] extracted executable was not found at $installed_executable" >&2
  find "$install_dir/squashfs-root" -maxdepth 2 -type f -perm -u+x -print >&2 || true
  exit 1
fi
echo "[ubuntu-e2e] testing packaged executable: $installed_executable"

${displayEnvironment}
# AppImage extraction cannot preserve root ownership on chrome-sandbox. The
# disposable test profile and single-user worker make Electron's documented
# no-sandbox mode appropriate for this package-verification launch.
export ELECTRON_DISABLE_SANDBOX=1
export IINPUBLIC_DESKTOP_EXECUTABLE="$installed_executable"
export E2E_GUN_MEMORY_ONLY=1
export E2E_STATIC_WEB=1
export E2E_VIDEO=off
export E2E_BLOB=1
export E2E_RUN_ID=${shellQuote(runId)}
export PW_WORKERS=1
cd "$workspace"
${shellQuote(nodeExe)} ${shellQuote(npxCli)} playwright test --config tests/e2e/native-app/playwright.config.ts tests/e2e/native-app/01-desktop-app-boots.spec.ts
`
  : `
echo '[ubuntu-e2e] ensuring Playwright Chromium is installed (5 minute timeout)'
timeout --signal=TERM --kill-after=15s 300s ${shellQuote(nodeExe)} ${shellQuote(npxCli)} playwright install chromium
${shellQuote(nodeExe)} ${shellQuote(npmCli)} run build:embedded
${displayEnvironment}
export E2E_GUN_MEMORY_ONLY=1
export E2E_STATIC_WEB=1
export E2E_VIDEO=off
export E2E_BLOB=1
export E2E_RUN_ID=${shellQuote(runId)}
export PW_WORKERS=1
cd "$workspace"
${shellQuote(nodeExe)} ${shellQuote(npxCli)} playwright test tests/e2e/platform-smoke --project=chromium --grep @smoke
`;

const remoteRun = runRemote(`
set -eu
export PATH=${shellQuote(`${nodeDir}/bin`)}:"$PATH"
export npm_config_cache=${shellQuote(`${remote.home}/.npm`)}
workspace=${shellQuote(workspace)}
cd "$workspace"
if [ ! -f package.json ]; then
  tar -xzf source.tar.gz
fi
rm -f -- source.tar.gz

install_dir=''
cleanup() {
  if [ -n "$install_dir" ]; then rm -rf -- "$install_dir"; fi
  ${desktopMode ? 'rm -rf -- "$workspace/platforms/desktop/dist" "$workspace/platforms/desktop/.prod-deps-staging"' : ':'}
}
trap cleanup EXIT INT TERM

root_hash=$(sha256sum package-lock.json | awk '{print $1}')
if [ -d node_modules ] && [ -f .iinpublic-dependencies.sha256 ] && [ "$(cat .iinpublic-dependencies.sha256)" = "$root_hash" ]; then
  echo '[ubuntu-e2e] reusing verified root dependencies'
else
  ${shellQuote(nodeExe)} ${shellQuote(npmCli)} ci --no-audit --no-fund
  printf '%s' "$root_hash" > .iinpublic-dependencies.sha256
fi

${testActions}
`, { stdio: 'inherit', timeoutMs: 45 * 60_000 });

const localBlobDir = path.join(repoRoot, 'blob-report', runId);
fs.mkdirSync(localBlobDir, { recursive: true });
const collect = spawnSync(
  'scp',
  [...sshOptions, `${sshHost}:${workspace}/blob-report/${runId}/*/*.zip`, localBlobDir],
  { cwd: repoRoot, encoding: 'utf8', timeout: 120_000 },
);
if (collect.status === 0 && fs.readdirSync(localBlobDir).some((name) => name.endsWith('.zip'))) {
  const merge = spawnSync(
    path.join(repoRoot, 'node_modules', '.bin', 'playwright'),
    ['merge-reports', '--reporter', 'html', localBlobDir],
    { cwd: repoRoot, stdio: 'inherit', timeout: 120_000 },
  );
  if (merge.status !== 0) console.error('[ubuntu-e2e] result merge failed; raw blob report retained');
} else {
  console.error(`[ubuntu-e2e] no blob report collected: ${collect.stderr?.trim() || 'remote test did not emit one'}`);
}

if (remoteRun.error || remoteRun.status !== 0) {
  console.error(`[ubuntu-e2e] remote test failed (${remoteRun.error?.message || `exit ${remoteRun.status}`})`);
  process.exit(1);
}
console.log(
  `[ubuntu-e2e] ${desktopMode ? 'packaged desktop executable' : 'Chromium platform smoke'} passed on ` +
    `${remote.hostname}; report: ${path.join(repoRoot, 'playwright-report', 'index.html')}`,
);
