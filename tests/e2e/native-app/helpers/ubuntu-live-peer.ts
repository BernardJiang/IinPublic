/**
 * Makes the real `ubuntu-test` worker a LIVE peer in a Mac-orchestrated shared scenario, closing
 * the gap `environment-availability.ts` documents: Ubuntu (and Windows) previously had only
 * REMOTE-BATCH support (SSH in, build, run entirely on that host, ship a report back) — genuinely
 * useful, but not a peer sharing real-time state with Mac/Android peers in the SAME scenario.
 *
 * Mechanism, mirroring `native-app-android.ts`'s own CDP-attach pattern for a real physical
 * device: launch Ubuntu's already-installed Playwright Chromium binary on its real X11 display
 * (the same one `run-ubuntu-e2e.mjs` already proves out) with a real remote-debugging port, open a
 * local SSH port-forward from this Mac to that port, and `chromium.connectOverCDP()` into it. The
 * DRIVING Playwright process stays entirely on the Mac — every existing host-agnostic test helper
 * (`bootstrapBrowserUserOnOrigin`, `createTagTalkViaEditor`, etc.) works completely unmodified
 * against this browser, exactly as they already do for a real Android WebView, because
 * `page.context().request` and friends issue their HTTP calls from the Mac's own Node process, not
 * from wherever the browser itself runs.
 *
 * The web/gun ports are reached through REVERSE SSH tunnels (`ssh -R`) onto Ubuntu's own loopback,
 * not the Mac's real LAN IP — found necessary the hard way. First attempt pointed Ubuntu's Chrome
 * at the Mac's LAN IP directly; the browser's WebCrypto API only works in a "secure context"
 * (HTTPS, or the special-cased `http://localhost`/`127.0.0.1`), so a plain-HTTP LAN IP made Gun's
 * own SEA shim redirect to `https://` and fail outright (`ERR_SSL_PROTOCOL_ERROR` — this Mac's
 * test server has no TLS). Chrome's own `--unsafely-treat-insecure-origin-as-secure` escape hatch
 * for exactly this shape was tried next (with a dedicated `--user-data-dir`, required for the flag
 * to take effect at all) and STILL left `isSecureContext` false on this Chrome build/version, in
 * both headless and real-X11-display mode — confirmed directly via a minimal CDP-only repro before
 * giving up on it. Reverse-tunneling instead makes Ubuntu's browser navigate to its OWN
 * `127.0.0.1`, which every browser always treats as secure with zero flags — this is what
 * `insecureOrigin` used to mean and what `reverseForwardPorts` replaces it with.
 */
import { chromium, type Browser, type Page } from '@playwright/test';
import { execFile, spawn, type ChildProcess } from 'child_process';
import * as http from 'http';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

const SSH_HOST = process.env.UBUNTU_E2E_SSH_HOST || 'ubuntu-test';
const SSH_OPTIONS = ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=8'];

export type UbuntuBrowserPeer = {
  browser: Browser;
  page: Page;
  close: () => Promise<void>;
};

async function findUbuntuChromeBinary(): Promise<string> {
  const result = await execFileAsync(
    'ssh',
    [...SSH_OPTIONS, SSH_HOST, "find ~/.cache/ms-playwright/chromium-*/chrome-linux64/chrome 2>/dev/null | head -1"],
    { timeout: 15_000 },
  );
  const binaryPath = result.stdout.trim();
  if (!binaryPath) {
    throw new Error(
      `No Playwright Chromium binary found on ${SSH_HOST} under ~/.cache/ms-playwright — ` +
        'run `npm run test:e2e:ubuntu:chromium` at least once to install it.',
    );
  }
  return binaryPath;
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

async function waitForCdpReady(localPort: number, timeoutMs = 30_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const version = await fetchJson(localPort, '/json/version');
    if (version) return;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Ubuntu Chrome CDP endpoint on local port ${localPort} did not become ready within ${timeoutMs}ms`);
}

/**
 * Launches a real, already-installed Playwright Chromium on `ubuntu-test`'s real X11 display with
 * a remote debugging port, tunnels it to a local port on this Mac, and connects over CDP.
 * `remotePort`/`localPort` (CDP) default to the same value; pass distinct ones if running more
 * than one Ubuntu peer at once (not needed today — this fleet has one Ubuntu worker).
 *
 * `reverseForwardPorts` lists ports this Mac serves on its OWN loopback (typically the native-app
 * web port and its paired Gun port) that should also answer on Ubuntu's loopback at the SAME port
 * number — see this file's header comment for why loopback-to-loopback, not a LAN IP, is what
 * makes the browser's WebCrypto/secure-context checks pass. Callers should navigate the returned
 * `page` to `http://127.0.0.1:<webPort>/...`, never the Mac's real LAN address.
 */
export async function launchUbuntuChromePeer(options: {
  remotePort?: number;
  localPort?: number;
  reverseForwardPorts?: number[];
} = {}): Promise<UbuntuBrowserPeer> {
  const remotePort = options.remotePort ?? 19_444;
  const localPort = options.localPort ?? remotePort;
  const reverseForwardPorts = options.reverseForwardPorts ?? [];

  const chromeBinary = await findUbuntuChromeBinary();

  // Kill any stale instance still bound to this port from a previous interrupted run before
  // starting a fresh one — a leftover process would otherwise make the CDP handshake below
  // silently attach to old, unrelated browser state instead of failing loudly.
  await execFileAsync('ssh', [...SSH_OPTIONS, SSH_HOST, `pkill -f 'remote-debugging-port=${remotePort}' || true`], { timeout: 10_000 }).catch(() => {});

  const profileDir = `/tmp/iinpublic-ubuntu-chrome-profile-${remotePort}`;
  const uid = (await execFileAsync('ssh', [...SSH_OPTIONS, SSH_HOST, 'id -u'], { timeout: 10_000 })).stdout.trim();
  const display = process.env.UBUNTU_E2E_DISPLAY || ':1';
  const xauthority = `/run/user/${uid}/gdm/Xauthority`;
  const launchCommand =
    `rm -rf ${profileDir}; ` +
    `DISPLAY=${display} XAUTHORITY=${xauthority} nohup ${chromeBinary} --remote-debugging-port=${remotePort} ` +
    `--remote-debugging-address=127.0.0.1 --no-sandbox --user-data-dir=${profileDir} about:blank ` +
    `> /tmp/iinpublic-ubuntu-chrome-${remotePort}.log 2>&1 & disown; echo launched`;
  const launch = await execFileAsync('ssh', [...SSH_OPTIONS, SSH_HOST, launchCommand], { timeout: 15_000 });
  if (!launch.stdout.includes('launched')) {
    throw new Error(`Failed to launch Ubuntu Chrome: ${launch.stdout}${launch.stderr}`);
  }

  let tunnel: ChildProcess | undefined;
  let browser: Browser | undefined;
  try {
    const forwardArgs = [
      '-L', `${localPort}:127.0.0.1:${remotePort}`,
      ...reverseForwardPorts.flatMap((port) => ['-R', `${port}:127.0.0.1:${port}`]),
    ];
    tunnel = spawn('ssh', ['-N', ...forwardArgs, ...SSH_OPTIONS, SSH_HOST], { stdio: 'ignore' });
    const tunnelExitPromise = new Promise<never>((_resolve, reject) => {
      tunnel!.once('exit', (code) => reject(new Error(`SSH tunnel to ${SSH_HOST} exited early (code ${code})`)));
    });
    await Promise.race([waitForCdpReady(localPort), tunnelExitPromise]).catch(async (error) => {
      // The tunnel racing a fast exit is the common real failure mode (wrong host/port); surface
      // it directly instead of the generic "did not become ready" timeout.
      throw error;
    });

    browser = await chromium.connectOverCDP(`http://127.0.0.1:${localPort}`);
    const context = browser.contexts()[0] ?? await browser.newContext();
    const page = context.pages()[0] ?? await context.newPage();

    const cleanup = async (): Promise<void> => {
      await browser?.close().catch(() => {});
      tunnel?.kill();
      await execFileAsync('ssh', [...SSH_OPTIONS, SSH_HOST, `pkill -f 'remote-debugging-port=${remotePort}' || true; rm -rf ${profileDir}`], { timeout: 10_000 }).catch(() => {});
    };

    return { browser, page, close: cleanup };
  } catch (error) {
    tunnel?.kill();
    await browser?.close().catch(() => {});
    await execFileAsync('ssh', [...SSH_OPTIONS, SSH_HOST, `pkill -f 'remote-debugging-port=${remotePort}' || true; rm -rf ${profileDir}`], { timeout: 10_000 }).catch(() => {});
    throw error;
  }
}
