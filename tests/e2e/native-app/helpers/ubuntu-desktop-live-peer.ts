/**
 * Makes the real packaged Ubuntu Electron app (not just a browser) a LIVE peer in a
 * Mac-orchestrated shared scenario — the desktop-app counterpart to `ubuntu-live-peer.ts`.
 *
 * Unlike the browser peer, this does NOT need a reverse tunnel for the WebCrypto/secure-context
 * trap: `launchNativeUser` (native-app.ts) configures the LOCAL macOS Electron app the same way —
 * `IINPUBLIC_HUB_GUN_URL` env var, no navigation to an HTTP origin at all (the app's own UI loads
 * from its bundled local files) — so the same env-var mechanism works here pointed at the Mac's
 * real LAN Gun URL directly, exactly like every Android spec already does for `hubGunUrl`.
 *
 * Mechanism: deploy the current git revision to `ubuntu-test` (same git-archive-over-scp pattern
 * `run-ubuntu-e2e.mjs` already uses, same revision-keyed workspace so a build either script
 * triggers is reusable by the other), build the AppImage (`npm run dist:linux`, with the same
 * dependency-hash-stamp caching `run-ubuntu-e2e.mjs` uses so a repeat run with unchanged
 * `package-lock.json` files skips `npm ci`), extract it, and launch the packaged
 * `iinpublic-desktop` executable with `--remote-debugging-port` — Electron apps are Chromium
 * under the hood and honor this switch even when packaged, confirmed by connecting to it exactly
 * like any other CDP target. `nohup ... & disown` genuinely detaches on Linux (already proven by
 * `ubuntu-live-peer.ts`'s own browser peer — unlike Windows, no long-lived-session workaround
 * needed here).
 */
import { chromium, type Browser, type Page } from '@playwright/test';
import { execFile, execFileSync, spawn, type ChildProcess } from 'child_process';
import * as fs from 'fs';
import * as http from 'http';
import * as os from 'os';
import * as path from 'path';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

const repoRoot = path.resolve(__dirname, '..', '..', '..', '..');
const hostsConfig = JSON.parse(fs.readFileSync(path.join(repoRoot, 'tests', 'matrix', 'hosts.json'), 'utf8')) as {
  ubuntu: { sshHost: string; workspaceRoot: string; nodeVersion: string; nodeArchiveUrl: string };
};
const SSH_HOST = process.env.UBUNTU_E2E_SSH_HOST || hostsConfig.ubuntu.sshHost;
const SSH_OPTIONS = ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=8'];

export type UbuntuDesktopPeer = {
  browser: Browser;
  page: Page;
  close: () => Promise<void>;
  /**
   * Kills the packaged app process (as if quit/crashed) and relaunches it on the SAME profile
   * directory, then re-attaches over CDP. `browser`/`page` are replaced with the new instances.
   */
  restart: () => Promise<void>;
};

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

/** Runs a multi-line shell script on the remote host by piping it to `sh -s` over SSH stdin —
 *  avoids the arg-length/quoting limits of passing a whole script as a single SSH argument. */
async function runRemoteWithInput(script: string, timeoutMs: number): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    // bash, not sh (dash on this Ubuntu) — the launch script below uses `disown`, a bash builtin
    // not available in dash. Confirmed via a real run: `sh: 8: disown: not found`.
    const child = spawn('ssh', [...SSH_OPTIONS, SSH_HOST, 'bash', '-s'], { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => { child.kill(); reject(new Error(`Remote command timed out after ${timeoutMs}ms`)); }, timeoutMs);
    child.stdout.on('data', (d: Buffer) => { stdout += d.toString(); });
    child.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });
    child.on('exit', (code: number) => {
      clearTimeout(timer);
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`Remote command exited ${code}: ${stderr.slice(0, 2000)}`));
    });
    child.on('error', (error: Error) => { clearTimeout(timer); reject(error); });
    child.stdin.write(script);
    child.stdin.end();
  });
}

function fetchJson(port: number, requestPath: string, timeoutMs = 1_000): Promise<unknown | undefined> {
  return new Promise((resolve) => {
    const request = http.get({ host: '127.0.0.1', port, path: requestPath, timeout: timeoutMs }, (response) => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => { body += chunk; });
      response.on('end', () => {
        if (response.statusCode !== 200) { resolve(undefined); return; }
        try { resolve(JSON.parse(body)); } catch { resolve(undefined); }
      });
    });
    request.once('error', () => resolve(undefined));
    request.once('timeout', () => { request.destroy(); resolve(undefined); });
  });
}

async function waitForCdpReady(localPort: number, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const version = await fetchJson(localPort, '/json/version');
    if (version) return;
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  throw new Error(`Ubuntu desktop app CDP endpoint on local port ${localPort} did not become ready within ${timeoutMs}ms`);
}

/**
 * Builds (or reuses a cached build of) the Linux AppImage on `ubuntu-test`, extracts it, and
 * launches the packaged executable pointed at `hubGunUrl` with a remote debugging port. Returns
 * a CDP-connected `browser`/`page` for the app's single window, plus a `close()` that kills the
 * remote process by PID and removes its extracted install/profile directories.
 */
export async function launchUbuntuDesktopPeer(options: {
  hubGunUrl: string;
  remotePort?: number;
  localPort?: number;
  buildTimeoutMs?: number;
}): Promise<UbuntuDesktopPeer> {
  const remotePort = options.remotePort ?? 19_666;
  const localPort = options.localPort ?? remotePort;
  const buildTimeoutMs = options.buildTimeoutMs ?? 20 * 60_000;

  const revision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' }).trim();
  const nodeFolder = `node-v${hostsConfig.ubuntu.nodeVersion}-linux-x64`;

  // Availability + tool prep (mirrors run-ubuntu-e2e.mjs's own gate, trimmed to what this
  // helper needs — the full script's X11/display checks aren't relevant to a headless CDP peer).
  const remoteHomeResult = await runRemoteWithInput('echo "$HOME"', 15_000);
  const remoteHome = remoteHomeResult.stdout.trim();
  const toolsDir = `${remoteHome}/iinpublic-tools`;
  const nodeDir = `${toolsDir}/${nodeFolder}`;
  const nodeExe = `${nodeDir}/bin/node`;
  const npmCli = `${nodeDir}/lib/node_modules/npm/bin/npm-cli.js`;
  const workspace = `${remoteHome}/${hostsConfig.ubuntu.workspaceRoot}/${revision}`;

  await runRemoteWithInput(`
set -eu
node_dir=${shellQuote(nodeDir)}
if [ ! -x "$node_dir/bin/node" ]; then
  mkdir -p ${shellQuote(toolsDir)}
  archive=${shellQuote(`${toolsDir}/${nodeFolder}.tar.xz`)}
  curl -fL --retry 2 --connect-timeout 15 -o "$archive" ${shellQuote(hostsConfig.ubuntu.nodeArchiveUrl)}
  tar -xJf "$archive" -C ${shellQuote(toolsDir)}
fi
mkdir -p ${shellQuote(workspace)}
`, 120_000);

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'iinpublic-ubuntu-desktop-live-peer-'));
  const archivePath = path.join(tempDir, `iinpublic-${revision.slice(0, 12)}.tar.gz`);
  try {
    execFileSync('git', ['archive', '--format=tar.gz', '--output', archivePath, revision], { cwd: repoRoot, stdio: 'inherit' });
    execFileSync('scp', [...SSH_OPTIONS, archivePath, `${SSH_HOST}:${workspace}/source.tar.gz`], { cwd: repoRoot, stdio: 'inherit', timeout: 120_000 });
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }

  console.log('[ubuntu-desktop-live-peer] building AppImage on ubuntu-test (npm ci is skipped when unchanged — can take several minutes on a cold cache)');
  const buildResult = await runRemoteWithInput(`
set -eu
export PATH=${shellQuote(nodeDir)}/bin:"$PATH"
export npm_config_cache=${shellQuote(`${remoteHome}/.npm`)}
workspace=${shellQuote(workspace)}
cd "$workspace"
if [ ! -f package.json ]; then tar -xzf source.tar.gz; fi
rm -f -- source.tar.gz

root_hash=$(sha256sum package-lock.json | awk '{print $1}')
root_stamp=.iinpublic-dependencies.sha256
if [ -d node_modules ] && [ -f "$root_stamp" ] && [ "$(cat "$root_stamp")" = "$root_hash" ]; then
  echo '[ubuntu-desktop-live-peer] reusing verified root dependencies'
else
  ${shellQuote(nodeExe)} ${shellQuote(npmCli)} ci --no-audit --no-fund
  printf '%s' "$root_hash" > "$root_stamp"
fi
${shellQuote(nodeExe)} ${shellQuote(npmCli)} run build:embedded
${shellQuote(nodeExe)} ${shellQuote(npmCli)} run desktop:stage-deps

cd "$workspace/platforms/desktop"
desktop_hash=$(sha256sum package-lock.json | awk '{print $1}')
desktop_stamp=.iinpublic-dependencies.sha256
if [ -d node_modules ] && [ -f "$desktop_stamp" ] && [ "$(cat "$desktop_stamp")" = "$desktop_hash" ]; then
  echo '[ubuntu-desktop-live-peer] reusing verified desktop dependencies'
else
  ${shellQuote(nodeExe)} ${shellQuote(npmCli)} ci --no-audit --no-fund
  printf '%s' "$desktop_hash" > "$desktop_stamp"
fi
${shellQuote(nodeExe)} ${shellQuote(npmCli)} run dist:linux

appimage=$(find "$workspace/platforms/desktop/dist" -maxdepth 1 -type f -name '*.AppImage' -print -quit)
if [ -z "$appimage" ]; then echo 'AppImage was not produced' >&2; exit 1; fi
echo "APPIMAGE:$appimage"
`, buildTimeoutMs);
  const appimageMatch = buildResult.stdout.match(/APPIMAGE:(.+)/);
  const appimagePath = appimageMatch?.[1]?.trim();
  if (!appimagePath) throw new Error(`AppImage build did not report a path: ${buildResult.stdout}${buildResult.stderr}`);
  console.log(`[ubuntu-desktop-live-peer] built: ${appimagePath}`);

  const installDir = `${workspace}/live-peer-install-${remotePort}`;
  const profileDir = `${workspace}/live-peer-profile-${remotePort}`;
  await runRemoteWithInput(`
set -eu
rm -rf ${shellQuote(installDir)} ${shellQuote(profileDir)}
mkdir -p ${shellQuote(installDir)}
cp ${shellQuote(appimagePath)} ${shellQuote(`${installDir}/IinPublic.AppImage`)}
chmod +x ${shellQuote(`${installDir}/IinPublic.AppImage`)}
cd ${shellQuote(installDir)}
./IinPublic.AppImage --appimage-extract >/dev/null
`, 60_000);
  const installedExe = `${installDir}/squashfs-root/iinpublic-desktop`;

  await runRemoteWithInput(`pkill -f 'remote-debugging-port=${remotePort}' || true`, 10_000).catch(() => {});

  // Unlike a bare Chromium binary, Electron has no true headless mode — a real run confirmed
  // `ERROR:ozone_platform_x11.cc ... Missing X server or $DISPLAY / The platform failed to
  // initialize. Exiting.` Needs the real X11 display, same DISPLAY/XAUTHORITY pattern
  // `run-ubuntu-e2e.mjs` already proves out for this worker's own desktop-app test.
  const uidResult = await runRemoteWithInput('id -u', 10_000);
  const uid = uidResult.stdout.trim();
  const display = process.env.UBUNTU_E2E_DISPLAY || ':1';
  const xauthority = `/run/user/${uid}/gdm/Xauthority`;

  const launchScript = `
set -eu
export DISPLAY=${shellQuote(display)}
export XAUTHORITY=${shellQuote(xauthority)}
export IINPUBLIC_LOCAL_PORT=${remotePort + 10_000}
export IINPUBLIC_HUB_GUN_URL=${shellQuote(options.hubGunUrl)}
export IINPUBLIC_USER_DATA_DIR=${shellQuote(profileDir)}
export IINPUBLIC_LAN_DISCOVERY_ENABLED=0
# AppImage extraction can't preserve root ownership on chrome-sandbox; --no-sandbox is
# appropriate for this disposable test profile (same reasoning run-ubuntu-e2e.mjs's own
# desktop-app test already documents).
export ELECTRON_DISABLE_SANDBOX=1
nohup ${shellQuote(installedExe)} --remote-debugging-port=${remotePort} --no-sandbox \
  > ${shellQuote(`/tmp/iinpublic-ubuntu-desktop-${remotePort}.log`)} 2>&1 & disown
echo launched
`;
  const launchApp = async (): Promise<void> => {
    const launch = await runRemoteWithInput(launchScript, 15_000);
    if (!launch.stdout.includes('launched')) {
      throw new Error(`Failed to launch Ubuntu desktop app: ${launch.stdout}${launch.stderr}`);
    }
  };
  await launchApp();

  let tunnel: ChildProcess | undefined;
  let browser: Browser | undefined;
  const attach = async (): Promise<{ browser: Browser; page: Page }> => {
    await waitForCdpReady(localPort, 60_000);
    const attached = await chromium.connectOverCDP(`http://127.0.0.1:${localPort}`);
    browser = attached;
    const context = attached.contexts()[0] ?? await attached.newContext();
    const page = context.pages()[0] ?? await context.newPage();
    return { browser: attached, page };
  };
  try {
    tunnel = spawn('ssh', ['-N', '-L', `${localPort}:127.0.0.1:${remotePort}`, ...SSH_OPTIONS, SSH_HOST], { stdio: 'ignore' });
    const tunnelExitPromise = new Promise<never>((_resolve, reject) => {
      tunnel!.once('exit', (code) => reject(new Error(`SSH tunnel to ${SSH_HOST} exited early (code ${code})`)));
    });
    const first = await Promise.race([attach(), tunnelExitPromise]);

    const peer: UbuntuDesktopPeer = {
      browser: first.browser,
      page: first.page,
      close: async () => {
        await browser?.close().catch(() => {});
        tunnel?.kill();
        await killRemoteInstance(remotePort, installDir, profileDir);
      },
      restart: async () => {
        await browser?.close().catch(() => {});
        await killRemoteProcess(remotePort);
        await launchApp();
        const next = await attach();
        peer.browser = next.browser;
        peer.page = next.page;
      },
    };
    return peer;
  } catch (error) {
    tunnel?.kill();
    await browser?.close().catch(() => {});
    await killRemoteInstance(remotePort, installDir, profileDir);
    throw error;
  }
}

/** Kills the app process only (profile and install stay) and waits until it is confirmed gone. */
async function killRemoteProcess(remotePort: number): Promise<void> {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    await execFileAsync('ssh', [...SSH_OPTIONS, SSH_HOST, `pkill -f 'remote-debugging-port=${remotePort}' || true`], { timeout: 15_000 }).catch(() => {});
    await new Promise((resolve) => setTimeout(resolve, 1_500));
    if (!(await remoteProcessStillRunning(remotePort))) return;
  }
  throw new Error(`Ubuntu desktop app on remote port ${remotePort} would not stop`);
}

/** True when a process matching this debug port is still alive on the remote host. */
async function remoteProcessStillRunning(remotePort: number): Promise<boolean> {
  try {
    // pgrep exits 1 (no match) or 0 (match) — either is a clean, meaningful answer, unlike the
    // pkill call below which this file's own cleanup treats with suspicion (see doc comment).
    await execFileAsync('ssh', [...SSH_OPTIONS, SSH_HOST, `pgrep -f 'remote-debugging-port=${remotePort}'`], { timeout: 10_000 });
    return true;
  } catch {
    return false;
  }
}

/**
 * Deliberately a plain SSH-argument command via `execFileAsync`, NOT `runRemoteWithInput`'s
 * stdin-piped `bash -s` — a real run showed the piped form can report success (exit 0, no
 * thrown error) while the remote process was left running regardless, root cause never fully
 * pinned down (suspected stdin-flush timing on a freshly-opened SSH channel). The plain-argument
 * form, identical in spirit to `ubuntu-live-peer.ts`'s own (already-reliable) cleanup, was
 * confirmed working by hand.
 *
 * Also verifies rather than trusting SSH's own exit code: this session repeatedly saw the SSH
 * CLIENT report exit 255 on a command that had, confirmed by hand immediately after, already
 * fully and correctly executed remotely (`pkill ... || true` — a `|| true` makes the remote shell
 * always exit 0, so 255 here can only be a connection-teardown-level client quirk, not the remote
 * command failing). Retrying on a misreported "failure" wastes time and can't help; checking
 * whether the process is ACTUALLY still there afterward is what actually tells the truth.
 */
async function killRemoteInstance(remotePort: number, installDir: string, profileDir: string): Promise<void> {
  const command = `pkill -f 'remote-debugging-port=${remotePort}' || true; rm -rf ${shellQuote(installDir)} ${shellQuote(profileDir)}`;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    await execFileAsync('ssh', [...SSH_OPTIONS, SSH_HOST, command], { timeout: 15_000 }).catch(() => {});
    if (!(await remoteProcessStillRunning(remotePort))) return;
    if (attempt === 3) console.log(`[ubuntu-desktop-live-peer] cleanup failed after 3 attempts (remote port ${remotePort} is confirmed still running)`);
    else await new Promise((resolve) => setTimeout(resolve, 1_000 * attempt));
  }
}
