/**
 * Makes the real INSTALLED Windows Electron app (NSIS installer, silent install) a LIVE peer in a
 * Mac-orchestrated shared scenario — the desktop-app counterpart to `windows-live-peer.ts`, and the
 * Windows counterpart to `ubuntu-desktop-live-peer.ts`.
 *
 * Mechanism: deploy the current git revision to `windows-test` (same git-archive-over-scp,
 * revision-keyed workspace and dependency-hash caching as `scripts/run-windows-e2e.mjs`), build the
 * NSIS installer, silently install it into a per-peer directory, and launch the INSTALLED
 * executable with `--remote-debugging-port` plus the same `IINPUBLIC_*` environment the other
 * desktop peers use. As `windows-live-peer.ts` documents, OpenSSH on Windows tears down everything
 * under the logon session when the initiating channel closes, so the launching ssh connection is
 * kept open for the peer's whole lifetime with the app in the foreground (`Wait-Process`); closing
 * it is the cleanup mechanism, backed by a PID-scoped `taskkill` (never a blanket image-name kill).
 * The app loads its UI from bundled files, so `hubGunUrl` is the Mac's real LAN Gun URL (no reverse
 * tunnel needed).
 */
import { chromium, type Browser, type Page } from '@playwright/test';
import { execFile, execFileSync, spawn, type ChildProcess } from 'child_process';
import * as dgram from 'dgram';
import * as fs from 'fs';
import * as http from 'http';
import * as os from 'os';
import * as path from 'path';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

const repoRoot = path.resolve(__dirname, '..', '..', '..', '..');
const hostsConfig = JSON.parse(fs.readFileSync(path.join(repoRoot, 'tests', 'matrix', 'hosts.json'), 'utf8')) as {
  windows: { sshHost: string; wakeOnLanMac?: string; workspaceRoot: string; nodeVersion: string; nodeArchiveUrl: string };
};
const SSH_HOST = process.env.WINDOWS_E2E_SSH_HOST || hostsConfig.windows.sshHost;
const SSH_OPTIONS = ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=8'];

export type WindowsDesktopPeer = {
  browser: Browser;
  page: Page;
  close: () => Promise<void>;
  /** Kills the app process and relaunches it on the same profile; `browser`/`page` are replaced. */
  restart: () => Promise<void>;
  /**
   * Real host suspend (S3) with a wake-timer scheduled task, then waits for SSH to return and
   * re-attaches to the SAME still-running app process. Requires `interactive: true` (the app must
   * live in the console session, not under the SSH logon that sleep tears down).
   */
  sleepAndWake: (sleepSeconds?: number) => Promise<void>;
};

/** Broadcasts a Wake-on-LAN magic packet. The scheduled wake timer alone did not wake this host. */
async function sendWakeOnLan(mac: string): Promise<void> {
  const macBytes = Buffer.from(mac.replace(/[:-]/g, ''), 'hex');
  if (macBytes.length !== 6) throw new Error(`Invalid Wake-on-LAN MAC: ${mac}`);
  const packet = Buffer.concat([Buffer.alloc(6, 0xff), ...Array.from({ length: 16 }, () => macBytes)]);
  const socket = dgram.createSocket('udp4');
  await new Promise<void>((resolve, reject) => {
    socket.bind(() => {
      socket.setBroadcast(true);
      let pending = 2;
      for (const port of [9, 7]) {
        socket.send(packet, port, '255.255.255.255', (error) => {
          if (error) reject(error);
          else if (--pending === 0) resolve();
        });
      }
    });
  });
  socket.close();
}

function encodePowerShell(script: string): string {
  return Buffer.from(script, 'utf16le').toString('base64');
}

function powerShellArgs(script: string): string[] {
  return [...SSH_OPTIONS, SSH_HOST, 'powershell.exe', '-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', encodePowerShell(script)];
}

async function runPowerShell(script: string, timeoutMs = 30_000): Promise<{ stdout: string; stderr: string }> {
  try {
    return await execFileAsync('ssh', powerShellArgs(script), { timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024 });
  } catch (error) {
    const failure = error as { stdout?: string; stderr?: string; code?: unknown };
    throw new Error(`Remote PowerShell failed (exit ${String(failure.code)}):\n--- stdout tail ---\n${String(failure.stdout ?? '').slice(-2500)}\n--- stderr tail ---\n${String(failure.stderr ?? '').slice(-1500)}`);
  }
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
    if (await fetchJson(localPort, '/json/version')) return;
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  throw new Error(`Windows desktop app CDP endpoint on local port ${localPort} did not become ready within ${timeoutMs}ms`);
}

async function killByPid(pid: number): Promise<void> {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      await execFileAsync('ssh', [...SSH_OPTIONS, SSH_HOST, 'taskkill', '/F', '/T', '/PID', String(pid)], { timeout: 10_000 });
      return;
    } catch (error) {
      // taskkill exits 128 when the PID is already gone — that is success for cleanup.
      if (String(error).includes('not found') || String(error).includes('128')) return;
      if (attempt === 3) console.log(`[windows-desktop-live-peer] cleanup failed after 3 attempts (PID ${pid} may still be running): ${String(error)}`);
      else await new Promise((resolve) => setTimeout(resolve, 1_000 * attempt));
    }
  }
}

export async function launchWindowsDesktopPeer(options: {
  hubGunUrl: string;
  remotePort?: number;
  localPort?: number;
  buildTimeoutMs?: number;
  /** Launch the installed app in the logged-on console session via a scheduled task. */
  interactive?: boolean;
}): Promise<WindowsDesktopPeer> {
  const remotePort = options.remotePort ?? 19_777;
  const localPort = options.localPort ?? remotePort;
  const buildTimeoutMs = options.buildTimeoutMs ?? 40 * 60_000;

  const revision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' }).trim();
  const nodeFolder = `node-v${hostsConfig.windows.nodeVersion}-win-x64`;

  const profile = JSON.parse((await runPowerShell(`[pscustomobject]@{ userProfile = $env:USERPROFILE } | ConvertTo-Json -Compress`, 15_000)).stdout.trim()) as { userProfile: string };
  const toolsDir = `${profile.userProfile}\\iinpublic-tools`;
  const nodeDir = `${toolsDir}\\${nodeFolder}`;
  const npmCmd = `${nodeDir}\\npm.cmd`;
  const workspace = `${profile.userProfile}\\${hostsConfig.windows.workspaceRoot}\\${revision}`;

  await runPowerShell(`
$ErrorActionPreference = 'Stop'
if (-not (Test-Path '${nodeDir}\\node.exe')) {
  New-Item -ItemType Directory -Force -Path '${toolsDir}' | Out-Null
  $zip = Join-Path '${toolsDir}' '${nodeFolder}.zip'
  & curl.exe -fL --retry 2 --connect-timeout 15 -o $zip '${hostsConfig.windows.nodeArchiveUrl}'
  Expand-Archive -Path $zip -DestinationPath '${toolsDir}' -Force
}
New-Item -ItemType Directory -Force -Path '${workspace}' | Out-Null
`, 120_000);

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'iinpublic-windows-desktop-live-peer-'));
  const archivePath = path.join(tempDir, `iinpublic-${revision.slice(0, 12)}.zip`);
  try {
    execFileSync('git', ['archive', '--format=zip', '--output', archivePath, revision], { cwd: repoRoot, stdio: 'inherit' });
    execFileSync('scp', ['-q', ...SSH_OPTIONS, archivePath, `${SSH_HOST}:${workspace.replace(/\\/g, '/')}/source.zip`], { stdio: 'inherit', timeout: 120_000 });
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }

  const installDir = `${workspace}\\live-peer-install-${remotePort}`;
  const profileDir = `${workspace}\\live-peer-profile-${remotePort}`;
  const installedExe = `${installDir}\\IinPublic.exe`;

  console.log('[windows-desktop-live-peer] building + installing the NSIS installer on windows-test (dependency installs are skipped when unchanged)');
  const build = await runPowerShell(`
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$env:Path = '${nodeDir};' + $env:Path
$workspace = '${workspace}'
Set-Location $workspace
if (-not (Test-Path (Join-Path $workspace 'package.json'))) {
  Expand-Archive -Path (Join-Path $workspace 'source.zip') -DestinationPath $workspace -Force
}
function Install-IfChanged($dir) {
  Push-Location $dir
  $hash = (Get-FileHash -Algorithm SHA256 -Path 'package-lock.json').Hash
  $stamp = '.iinpublic-dependencies.sha256'
  if (-not ((Test-Path 'node_modules') -and (Test-Path $stamp) -and ((Get-Content -Raw $stamp).Trim() -eq $hash))) {
    & '${npmCmd}' ci --no-audit --no-fund
    if ($LASTEXITCODE -ne 0) { Pop-Location; exit $LASTEXITCODE }
    Set-Content -NoNewline -Path $stamp -Value $hash
  }
  Pop-Location
}
Install-IfChanged $workspace
& '${npmCmd}' run build:embedded
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
& '${npmCmd}' run desktop:stage-deps
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
Install-IfChanged (Join-Path $workspace 'platforms\\desktop')
Push-Location (Join-Path $workspace 'platforms\\desktop')
& '${npmCmd}' run dist:win
$packageExit = $LASTEXITCODE
Pop-Location
if ($packageExit -ne 0) { exit $packageExit }
$installer = Get-ChildItem -Path (Join-Path $workspace 'platforms\\desktop\\dist') -File -Filter '*.exe' |
  Where-Object { $_.Name -like '*Setup*' } | Sort-Object LastWriteTimeUtc | Select-Object -Last 1
if (-not $installer) { throw 'Windows NSIS installer was not produced' }
if (Test-Path '${installDir}') { Remove-Item -LiteralPath '${installDir}' -Recurse -Force }
if (Test-Path '${profileDir}') { Remove-Item -LiteralPath '${profileDir}' -Recurse -Force }
$p = Start-Process -FilePath $installer.FullName -ArgumentList @('/S', '/D=${installDir}') -Wait -PassThru
if ($p.ExitCode -ne 0) { throw "NSIS installer failed with exit code $($p.ExitCode)" }
if (-not (Test-Path '${installedExe}')) { throw 'Installed executable not found' }
Write-Output 'INSTALLED'
`, buildTimeoutMs);
  if (!build.stdout.includes('INSTALLED')) throw new Error(`Windows desktop build/install failed: ${build.stdout.slice(-1500)}${build.stderr.slice(-1500)}`);

  const launchScript = `
$env:IINPUBLIC_LOCAL_PORT = '${remotePort + 10_000}'
$env:IINPUBLIC_HUB_GUN_URL = '${options.hubGunUrl}'
$env:IINPUBLIC_USER_DATA_DIR = '${profileDir}'
$env:IINPUBLIC_LAN_DISCOVERY_ENABLED = '0'
$proc = Start-Process -FilePath '${installedExe}' -PassThru -ArgumentList @('--remote-debugging-port=${remotePort}', '--disable-gpu', '--disable-features=WebRtcHideLocalIpsWithMdns')
Write-Output ("PID:" + $proc.Id)
Wait-Process -Id $proc.Id
`;

  let launcher: ChildProcess | undefined;
  let tunnel: ChildProcess | undefined;
  let browser: Browser | undefined;
  let remotePid: number | undefined;

  const taskName = `IinPublicLivePeer${remotePort}`;
  const interactiveLaunchScript = `
$ErrorActionPreference = 'Stop'
Unregister-ScheduledTask -TaskName '${taskName}' -Confirm:$false -ErrorAction SilentlyContinue
$cmd = '/c set "IINPUBLIC_LOCAL_PORT=${remotePort + 10_000}" && set "IINPUBLIC_HUB_GUN_URL=${options.hubGunUrl}" && set "IINPUBLIC_USER_DATA_DIR=${profileDir}" && set "IINPUBLIC_LAN_DISCOVERY_ENABLED=0" && "${installedExe}" --remote-debugging-port=${remotePort} --disable-features=WebRtcHideLocalIpsWithMdns'
$action = New-ScheduledTaskAction -Execute 'cmd.exe' -Argument $cmd
$principal = New-ScheduledTaskPrincipal -UserId ([Security.Principal.WindowsIdentity]::GetCurrent().Name) -LogonType Interactive -RunLevel Limited
Register-ScheduledTask -TaskName '${taskName}' -Action $action -Principal $principal | Out-Null
Start-ScheduledTask -TaskName '${taskName}'
for ($i = 0; $i -lt 60; $i++) {
  $c = Get-NetTCPConnection -LocalPort ${remotePort} -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($c) { Write-Output ("PID:" + $c.OwningProcess); exit 0 }
  Start-Sleep -Milliseconds 500
}
throw 'interactive app did not open its debug port'
`;

  const startApp = async (): Promise<{ browser: Browser; page: Page }> => {
    remotePid = undefined;
    if (options.interactive) {
      const out = await runPowerShell(interactiveLaunchScript, 60_000);
      const match = out.stdout.match(/PID:(\d+)/);
      if (!match) throw new Error(`Interactive Windows launch failed: ${out.stdout}${out.stderr}`);
      remotePid = Number(match[1]);
      await waitForCdpReady(localPort, 90_000);
      return attachCdp();
    }
    launcher = spawn('ssh', powerShellArgs(launchScript), { stdio: ['ignore', 'pipe', 'ignore'] });
    launcher.stdout?.on('data', (chunk) => {
      const match = String(chunk).match(/PID:(\d+)/);
      if (match) remotePid = Number(match[1]);
    });
    const exited = new Promise<never>((_resolve, reject) => {
      const current = launcher!;
      current.once('exit', (code) => reject(new Error(`Windows desktop launcher SSH session exited early (code ${code})`)));
    });
    exited.catch(() => {});
    await Promise.race([waitForCdpReady(localPort, 90_000), exited]);
    return attachCdp();
  };

  const attachCdp = async (): Promise<{ browser: Browser; page: Page }> => {
    const attached = await chromium.connectOverCDP(`http://127.0.0.1:${localPort}`);
    browser = attached;
    const context = attached.contexts()[0] ?? await attached.newContext();
    return { browser: attached, page: context.pages()[0] ?? await context.newPage() };
  };

  const stopApp = async (): Promise<void> => {
    await browser?.close().catch(() => {});
    launcher?.removeAllListeners('exit');
    launcher?.kill();
    if (remotePid) await killByPid(remotePid);
    if (options.interactive) {
      await runPowerShell(`Unregister-ScheduledTask -TaskName '${taskName}' -Confirm:$false -ErrorAction SilentlyContinue`, 15_000).catch(() => {});
    }
  };

  const removeRemoteFiles = async (): Promise<void> => {
    await runPowerShell(`
$u = '${installDir}\\Uninstall IinPublic.exe'
if (Test-Path $u) { Start-Process -FilePath $u -ArgumentList @('/S') -Wait | Out-Null }
Start-Sleep -Milliseconds 500
Remove-Item -LiteralPath '${installDir}' -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath '${profileDir}' -Recurse -Force -ErrorAction SilentlyContinue
`, 60_000).catch((error) => console.log(`[windows-desktop-live-peer] uninstall cleanup failed: ${String(error)}`));
  };

  try {
    tunnel = spawn('ssh', ['-N', '-L', `${localPort}:127.0.0.1:${remotePort}`, ...SSH_OPTIONS, SSH_HOST], { stdio: 'ignore' });
    const first = await startApp();
    const peer: WindowsDesktopPeer = {
      browser: first.browser,
      page: first.page,
      close: async () => {
        await stopApp();
        tunnel?.kill();
        await removeRemoteFiles();
      },
      restart: async () => {
        await stopApp();
        await new Promise((resolve) => setTimeout(resolve, 2_000));
        const next = await startApp();
        peer.browser = next.browser;
        peer.page = next.page;
      },
      sleepAndWake: async (sleepSeconds = 150) => {
        if (!options.interactive) throw new Error('sleepAndWake requires interactive: true');
        await browser?.close().catch(() => {});
        tunnel?.kill();
        // Wake-timer task first, then suspend. Hibernate is disabled on this host, so this is S3.
        await runPowerShell(`
$ErrorActionPreference = 'Stop'
Unregister-ScheduledTask -TaskName 'IinPublicWake' -Confirm:$false -ErrorAction SilentlyContinue
$action = New-ScheduledTaskAction -Execute 'cmd.exe' -Argument '/c echo wake'
$trigger = New-ScheduledTaskTrigger -Once -At ((Get-Date).AddSeconds(${sleepSeconds}))
$settings = New-ScheduledTaskSettingsSet -WakeToRun -StartWhenAvailable
$principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
Register-ScheduledTask -TaskName 'IinPublicWake' -Action $action -Trigger $trigger -Settings $settings -Principal $principal | Out-Null
Start-Process -FilePath 'rundll32.exe' -ArgumentList 'powrprof.dll,SetSuspendState 0,1,0'
`, 30_000).catch(() => {});
        const slept = Date.now();
        // Wait for the host to go unreachable, then to come back.
        const deadline = slept + (sleepSeconds + 300) * 1000;
        let wentDown = false;
        while (Date.now() < deadline) {
          const up = await execFileAsync('ssh', [...SSH_OPTIONS, SSH_HOST, 'echo up'], { timeout: 12_000 }).then(() => true, () => false);
          if (!up) {
            wentDown = true;
            const mac = process.env.WINDOWS_E2E_MAC || hostsConfig.windows.wakeOnLanMac;
            if (mac && Date.now() - slept > 45_000) await sendWakeOnLan(mac).catch(() => {});
          } else if (wentDown) break;
          await new Promise((resolve) => setTimeout(resolve, 3_000));
        }
        if (!wentDown) throw new Error('Windows host never became unreachable — it did not actually sleep');
        if (Date.now() >= deadline) throw new Error('Windows host did not wake within the allowed window');
        console.log(`[windows-desktop-live-peer] host slept and woke after ~${Math.round((Date.now() - slept) / 1000)}s`);
        await runPowerShell(`Unregister-ScheduledTask -TaskName 'IinPublicWake' -Confirm:$false -ErrorAction SilentlyContinue`, 20_000).catch(() => {});
        tunnel = spawn('ssh', ['-N', '-L', `${localPort}:127.0.0.1:${remotePort}`, ...SSH_OPTIONS, SSH_HOST], { stdio: 'ignore' });
        await waitForCdpReady(localPort, 60_000);
        const next = await attachCdp();
        peer.browser = next.browser;
        peer.page = next.page;
      },
    };
    return peer;
  } catch (error) {
    await stopApp();
    tunnel?.kill();
    await removeRemoteFiles();
    throw error;
  }
}
