/**
 * Windows counterpart to `ubuntu-live-peer.ts` — same mechanism, same reverse-tunnel fix for the
 * same WebCrypto/secure-context trap (see that file's header comment for the full story: a plain
 * LAN IP over HTTP isn't a "secure context", so Gun's SEA shim redirects to https:// and fails;
 * reverse SSH tunnels make the remote browser navigate to its OWN 127.0.0.1 instead, which is
 * always secure). Ported straight over rather than re-discovered, since the underlying browser
 * behavior isn't platform-specific.
 *
 * One real, confirmed-not-assumed difference from the Ubuntu version: `nohup chrome & disown`
 * (Linux) genuinely detaches a process from its launching SSH session. The Windows equivalents
 * tried, in order, did NOT: `Start-Process` (still tied to the session — verified alive
 * mid-session, gone the instant a fresh SSH call checked for it), `Invoke-CimMethod ...
 * Win32_Process Create` (same result), and `schtasks /create ... /run` (task reported "Running"
 * but no chrome.exe process ever showed up in a process listing, and cleanup needed extra
 * schtasks bookkeeping regardless). OpenSSH on Windows appears to tear down the whole logon
 * session — and everything under it — the moment the initiating channel closes, regardless of how
 * the child was spawned.
 *
 * Fix: don't fight it — keep the LAUNCHING ssh connection open as a long-lived local child process
 * for the peer's whole lifetime, running chrome in the foreground of that remote session (the same
 * way `native-app-android.ts`/`run-windows-e2e.mjs` already keep long remote sessions open for
 * multi-minute operations). Closing/killing that local ssh child then cleanly tears down the
 * remote chrome too — the exact "problem" above, now the desired cleanup mechanism.
 *
 * Two more real, confirmed-not-assumed gotchas along the way:
 * - Plain `& chrome.exe args` returns instantly regardless of the above — a documented
 *   PowerShell/Windows quirk where the call operator does not block for Win32 GUI-subsystem
 *   executables (chrome.exe is one, even headless) the way it does for console apps.
 *   `Start-Process -PassThru` + `Wait-Process -Id $proc.Id` blocks on the specific PID directly,
 *   sidestepping that subsystem-detection behavior.
 * - `'--user-data-dir=' + $profileDir` as a runtime PowerShell string concatenation INSIDE the
 *   `-ArgumentList` array made chrome exit near-instantly with
 *   `"Multiple targets are not supported in headless mode."` on stderr (confirmed by redirecting
 *   `-RedirectStandardError` to a file and reading it back) — Start-Process's own argument
 *   marshalling appears to split that concatenated value oddly. Building the full
 *   `--user-data-dir=<path>` argument as ONE literal string in this file (no runtime `+` inside
 *   the remote script) fixed it outright.
 */
import { chromium, type Browser, type Page } from '@playwright/test';
import { execFile, spawn, type ChildProcess } from 'child_process';
import * as fs from 'fs';
import * as http from 'http';
import * as path from 'path';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

const repoRoot = path.resolve(__dirname, '..', '..', '..', '..');
const hostsConfig = JSON.parse(fs.readFileSync(path.join(repoRoot, 'tests', 'matrix', 'hosts.json'), 'utf8')) as {
  windows: { sshHost: string };
};
const SSH_HOST = process.env.WINDOWS_E2E_SSH_HOST || hostsConfig.windows.sshHost;
const SSH_OPTIONS = ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=8'];

export type WindowsBrowserPeer = {
  browser: Browser;
  page: Page;
  close: () => Promise<void>;
};

function encodePowerShell(script: string): string {
  return Buffer.from(script, 'utf16le').toString('base64');
}

async function runPowerShell(script: string, timeoutMs = 30_000): Promise<{ stdout: string; stderr: string }> {
  return execFileAsync('ssh', [...SSH_OPTIONS, SSH_HOST, 'powershell.exe', '-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', encodePowerShell(script)], { timeout: timeoutMs });
}

async function findWindowsChromeBinary(): Promise<string> {
  const { stdout } = await runPowerShell(
    `(Get-ChildItem -Path (Join-Path $env:USERPROFILE "AppData\\Local\\ms-playwright") -Directory -Filter 'chromium-*' -ErrorAction SilentlyContinue | Select-Object -First 1 | ForEach-Object { Get-ChildItem -Path $_.FullName -Recurse -Filter chrome.exe -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty FullName })`,
    15_000,
  );
  const binaryPath = stdout.trim();
  if (!binaryPath) {
    throw new Error(
      `No Playwright Chromium binary found on ${SSH_HOST} under %USERPROFILE%\\AppData\\Local\\ms-playwright — ` +
        'run `npm run test:e2e:windows` at least once to install it.',
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
  throw new Error(`Windows Chrome CDP endpoint on local port ${localPort} did not become ready within ${timeoutMs}ms`);
}

/**
 * Kills exactly one process by PID via `taskkill /F /PID` — deliberately NOT a blanket
 * `taskkill /IM chrome.exe`, which would also kill the machine owner's own everyday Chrome if
 * they have one open, and NOT `Get-CimInstance Win32_Process -Filter "..."`, which silently
 * matched zero processes in testing despite real ones existing (confirmed via `tasklist`
 * showing several while the CIM filter returned nothing) — a WQL-quoting issue never fully
 * root-caused, sidestepped by using a precise, known PID instead of a filter.
 */
// This session saw the SSH client itself intermittently exit non-zero on an otherwise-correct
// remote command (a connection-level hiccup, not a logic bug — reproduced manually on the Ubuntu
// worker: an identical command failed once via SSH and immediately succeeded on retry, confirmed
// by checking the process was actually gone). A cleanup step that silently eats one failed
// attempt can leave a real Chrome process running on the shared Windows worker indefinitely, so
// this retries rather than swallowing the first error like a plain `.catch(() => {})` would.
async function killByPid(pid: number): Promise<void> {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      await execFileAsync('ssh', [...SSH_OPTIONS, SSH_HOST, 'taskkill', '/F', '/PID', String(pid)], { timeout: 10_000 });
      return;
    } catch (error) {
      if (attempt === 3) console.log(`[windows-live-peer] cleanup failed after 3 attempts (PID ${pid} may still be running): ${String(error)}`);
      else await new Promise((resolve) => setTimeout(resolve, 1_000 * attempt));
    }
  }
}

/**
 * Launches a real, already-installed Playwright Chromium on `windows-test`, tunnels its remote
 * debugging port to this Mac, and connects over CDP. See `ubuntu-live-peer.ts` for the
 * `reverseForwardPorts` contract (same meaning here): callers should navigate the returned `page`
 * to `http://127.0.0.1:<webPort>/...`, never the Mac's real LAN address.
 */
export async function launchWindowsChromePeer(options: {
  remotePort?: number;
  localPort?: number;
  reverseForwardPorts?: number[];
  /** 'edge' launches the installed Microsoft Edge instead of Playwright's Chromium. */
  browser?: 'chromium' | 'edge';
} = {}): Promise<WindowsBrowserPeer> {
  const remotePort = options.remotePort ?? 19_555;
  const localPort = options.localPort ?? remotePort;
  const reverseForwardPorts = options.reverseForwardPorts ?? [];

  const chromeBinary = options.browser === 'edge'
    ? 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
    : await findWindowsChromeBinary();

  const remoteTempProfileDir = `$env:TEMP\\iinpublic-windows-chrome-profile-${remotePort}`;
  // Runs in the FOREGROUND of this remote session on purpose (see header comment) — the launcher
  // process below is kept alive for this peer's whole lifetime instead of backgrounding here.
  // Prints "PID:<n>" as its first line so this Mac-side code knows exactly which process to
  // taskkill at cleanup (see killByPid's doc comment for why not a name/filter-based kill).
  const launchScript = `
$profileDir = "${remoteTempProfileDir}"
if (Test-Path $profileDir) { Remove-Item -LiteralPath $profileDir -Recurse -Force -ErrorAction SilentlyContinue }
$proc = Start-Process -FilePath "${chromeBinary}" -PassThru -ArgumentList @(
  '--headless=new',
  '--no-first-run',
  '--remote-debugging-port=${remotePort}',
  '--remote-debugging-address=127.0.0.1',
  "--user-data-dir=$profileDir"
)
Write-Output ("PID:" + $proc.Id)
Wait-Process -Id $proc.Id
`;
  let launcher: ChildProcess | undefined;
  let tunnel: ChildProcess | undefined;
  let browser: Browser | undefined;
  let remotePid: number | undefined;
  try {
    launcher = spawn('ssh', [...SSH_OPTIONS, SSH_HOST, 'powershell.exe', '-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', encodePowerShell(launchScript)], { stdio: ['ignore', 'pipe', 'ignore'] });
    launcher.stdout?.on('data', (chunk) => {
      const match = String(chunk).match(/PID:(\d+)/);
      if (match) remotePid = Number(match[1]);
    });
    const launcherExitPromise = new Promise<never>((_resolve, reject) => {
      launcher!.once('exit', (code) => reject(new Error(`Windows Chrome launcher SSH session to ${SSH_HOST} exited early (code ${code})`)));
    });

    const forwardArgs = [
      '-L', `${localPort}:127.0.0.1:${remotePort}`,
      ...reverseForwardPorts.flatMap((port) => ['-R', `${port}:127.0.0.1:${port}`]),
    ];
    tunnel = spawn('ssh', ['-N', ...forwardArgs, ...SSH_OPTIONS, SSH_HOST], { stdio: 'ignore' });
    const tunnelExitPromise = new Promise<never>((_resolve, reject) => {
      tunnel!.once('exit', (code) => reject(new Error(`SSH tunnel to ${SSH_HOST} exited early (code ${code})`)));
    });

    await Promise.race([waitForCdpReady(localPort), launcherExitPromise, tunnelExitPromise]);

    browser = await chromium.connectOverCDP(`http://127.0.0.1:${localPort}`);
    const context = browser.contexts()[0] ?? await browser.newContext();
    const page = context.pages()[0] ?? await context.newPage();

    const cleanup = async (): Promise<void> => {
      await browser?.close().catch(() => {});
      tunnel?.kill();
      launcher?.kill();
      if (remotePid) await killByPid(remotePid);
    };

    return { browser, page, close: cleanup };
  } catch (error) {
    tunnel?.kill();
    launcher?.kill();
    await browser?.close().catch(() => {});
    if (remotePid) await killByPid(remotePid);
    throw error;
  }
}
