#!/usr/bin/env node

import { execFileSync, spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const hostConfig = JSON.parse(
  fs.readFileSync(path.join(repoRoot, 'tests', 'matrix', 'hosts.json'), 'utf8'),
).windows;
const sshHost = process.env.WINDOWS_E2E_SSH_HOST || hostConfig.sshHost;
const sshArgs = ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=8', sshHost];
const required = process.env.WINDOWS_E2E_REQUIRED === '1';
const preflightOnly = process.argv.includes('--preflight');
const desktopMode = process.argv.includes('--desktop');

function encodePowerShell(script) {
  return Buffer.from(script, 'utf16le').toString('base64');
}

function runPowerShell(script, options = {}) {
  return spawnSync(
    'ssh',
    [...sshArgs, 'powershell.exe', '-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', encodePowerShell(script)],
    {
      cwd: repoRoot,
      encoding: options.encoding || 'utf8',
      stdio: options.stdio || 'pipe',
      timeout: options.timeoutMs || 30_000,
    },
  );
}

function skipOrFail(message) {
  const prefix = required ? 'FAIL' : 'SKIP';
  console.error(`[windows-e2e] ${prefix}: ${message}`);
  process.exit(required ? 1 : 0);
}

// Mandatory first gate: do not archive, deploy, install, build, or run a test until the
// configured SSH endpoint proves reachable and returns a Windows host profile.
const availability = runPowerShell(`
$ErrorActionPreference = 'Stop'
[pscustomobject]@{
  computerName = $env:COMPUTERNAME
  userProfile = $env:USERPROFILE
  os = (Get-CimInstance Win32_OperatingSystem).Caption
  architecture = (Get-CimInstance Win32_OperatingSystem).OSArchitecture
} | ConvertTo-Json -Compress
`, { timeoutMs: 15_000 });

if (availability.error || availability.status !== 0) {
  skipOrFail(`SSH host ${sshHost} is unavailable (${availability.error?.message || availability.stderr.trim() || `exit ${availability.status}`}); no tests started.`);
}

let remote;
try {
  remote = JSON.parse(availability.stdout.trim());
} catch {
  skipOrFail(`SSH host ${sshHost} did not return a valid Windows preflight response; no tests started.`);
}
console.log(`[windows-e2e] available: ${remote.computerName} (${remote.os}, ${remote.architecture})`);

const nodeFolder = `node-v${hostConfig.nodeVersion}-win-x64`;
const toolsDir = `${remote.userProfile}\\iinpublic-tools`;
const nodeDir = `${toolsDir}\\${nodeFolder}`;
const nodeExe = `${nodeDir}\\node.exe`;
const npmCmd = `${nodeDir}\\npm.cmd`;
const npxCmd = `${nodeDir}\\npx.cmd`;
const revision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' }).trim();
const shortRevision = revision.slice(0, 12);
const workspace = `${remote.userProfile}\\${hostConfig.workspaceRoot}\\${revision}`;
const runId = `windows${desktopMode ? '-desktop' : ''}-${shortRevision}-${Date.now()}`;

const prepareTools = runPowerShell(`
$ErrorActionPreference = 'Stop'
$tools = '${toolsDir}'
$node = '${nodeExe}'
if (-not (Test-Path $node)) {
  New-Item -ItemType Directory -Force -Path $tools | Out-Null
  $zip = Join-Path $tools '${nodeFolder}.zip'
  & curl.exe -fL --retry 2 --connect-timeout 15 -o $zip '${hostConfig.nodeArchiveUrl}'
  if ($LASTEXITCODE -ne 0) { throw "Node download failed with exit code $LASTEXITCODE" }
  Expand-Archive -Path $zip -DestinationPath $tools -Force
}
& $node --version
if ($LASTEXITCODE -ne 0) { throw 'Portable Node failed to start' }
New-Item -ItemType Directory -Force -Path '${workspace}' | Out-Null
`, { timeoutMs: 120_000 });
if (prepareTools.error || prepareTools.status !== 0) {
  skipOrFail(`Windows tool preparation failed: ${prepareTools.error?.message || prepareTools.stderr.trim() || `exit ${prepareTools.status}`}`);
}
console.log(`[windows-e2e] runtime: ${prepareTools.stdout.trim()}`);
if (preflightOnly) {
  console.log('[windows-e2e] preflight passed; no tests started.');
  process.exit(0);
}

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'iinpublic-windows-e2e-'));
const archivePath = path.join(tempDir, `iinpublic-${shortRevision}.zip`);
try {
  execFileSync('git', ['archive', '--format=zip', '--output', archivePath, revision], { cwd: repoRoot, stdio: 'inherit' });
  const scpWorkspace = workspace.replace(/\\/g, '/');
  execFileSync(
    'scp',
    ['-q', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=8', archivePath, `${sshHost}:${scpWorkspace}/source.zip`],
    { cwd: repoRoot, stdio: 'inherit', timeout: 120_000 },
  );
} finally {
  fs.rmSync(tempDir, { recursive: true, force: true });
}

const testActions = desktopMode
  ? `
& '${npmCmd}' run desktop:stage-deps
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
Push-Location (Join-Path $workspace 'platforms\\desktop')
$desktopLockHash = (Get-FileHash -Algorithm SHA256 -Path 'package-lock.json').Hash
$desktopStamp = '.iinpublic-dependencies.sha256'
$reuseDesktopDependencies = (Test-Path 'node_modules') -and
  (Test-Path $desktopStamp) -and
  ((Get-Content -Raw $desktopStamp).Trim() -eq $desktopLockHash)
if ($reuseDesktopDependencies) {
  Write-Host '[windows-e2e] reusing verified desktop dependencies'
} else {
  & '${npmCmd}' ci --no-audit --no-fund
  if ($LASTEXITCODE -ne 0) { Pop-Location; exit $LASTEXITCODE }
  Set-Content -NoNewline -Path $desktopStamp -Value $desktopLockHash
}
& '${npmCmd}' run dist:win
$packageExit = $LASTEXITCODE
Pop-Location
if ($packageExit -ne 0) { exit $packageExit }

$distDir = Join-Path $workspace 'platforms\\desktop\\dist'
$installer = Get-ChildItem -Path $distDir -File -Filter '*.exe' |
  Where-Object { $_.Name -like '*Setup*' } |
  Sort-Object LastWriteTimeUtc |
  Select-Object -Last 1
if (-not $installer) { throw "Windows NSIS installer was not produced in $distDir" }
$unpackedExe = Join-Path $distDir 'win-unpacked\\IinPublic.exe'
if (-not (Test-Path $unpackedExe)) { throw "Packaged executable was not produced at $unpackedExe" }
$hash = (Get-FileHash -Algorithm SHA256 -Path $installer.FullName).Hash
Write-Host "[windows-e2e] built installer: $($installer.Name) ($($installer.Length) bytes, sha256 $hash)"

$installDir = Join-Path $workspace 'desktop-test-install'
if (Test-Path $installDir) { Remove-Item -LiteralPath $installDir -Recurse -Force }
$testExit = 1
try {
  $installerProcess = Start-Process -FilePath $installer.FullName -ArgumentList @('/S', "/D=$installDir") -Wait -PassThru
  if ($installerProcess.ExitCode -ne 0) { throw "NSIS installer failed with exit code $($installerProcess.ExitCode)" }
  $installedExe = Join-Path $installDir 'IinPublic.exe'
  if (-not (Test-Path $installedExe)) { throw "Installed executable was not found at $installedExe" }
  Write-Host "[windows-e2e] testing installed executable: $installedExe"

  $env:IINPUBLIC_DESKTOP_EXECUTABLE = $installedExe
  $env:E2E_GUN_MEMORY_ONLY = '1'
  $env:E2E_STATIC_WEB = '1'
  $env:E2E_VIDEO = 'off'
  $env:E2E_BLOB = '1'
  $env:E2E_RUN_ID = '${runId}'
  $env:PW_WORKERS = '1'
  Set-Location $workspace
  & '${npxCmd}' playwright test --config tests/e2e/native-app/playwright.config.ts tests/e2e/native-app/01-desktop-app-boots.spec.ts
  $testExit = $LASTEXITCODE
} finally {
  $uninstaller = Join-Path $installDir 'Uninstall IinPublic.exe'
  if (Test-Path $uninstaller) {
    $uninstallProcess = Start-Process -FilePath $uninstaller -ArgumentList '/S' -Wait -PassThru
    if ($uninstallProcess.ExitCode -ne 0) {
      Write-Warning "NSIS uninstaller exited with $($uninstallProcess.ExitCode)"
    }
  }
  if (Test-Path $installDir) {
    Start-Sleep -Milliseconds 500
    Remove-Item -LiteralPath $installDir -Recurse -Force -ErrorAction SilentlyContinue
  }
}
exit $testExit
`
  : `
$env:E2E_GUN_MEMORY_ONLY = '1'
$env:E2E_CROSS_BROWSER = '1'
$env:E2E_WINDOWS_EDGE = '1'
$env:E2E_STATIC_WEB = '1'
$env:E2E_VIDEO = 'off'
$env:E2E_BLOB = '1'
$env:E2E_RUN_ID = '${runId}'
$env:PW_WORKERS = '1'
& '${npxCmd}' playwright test tests/e2e/platform-smoke --project=chromium --project=edge --project=webkit --project=firefox
$smokeExit = $LASTEXITCODE
if ($smokeExit -ne 0) { exit $smokeExit }
$env:E2E_MIXED_BROWSER = '1'
& '${npxCmd}' playwright test tests/e2e/browser-matrix/01-edge-firefox-talk.spec.ts --project=chromium
exit $LASTEXITCODE
`;

const remoteRun = runPowerShell(`
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$env:Path = '${nodeDir};' + $env:Path
$workspace = '${workspace}'
Set-Location $workspace
if (-not (Test-Path (Join-Path $workspace 'package.json'))) {
  Expand-Archive -Path (Join-Path $workspace 'source.zip') -DestinationPath $workspace -Force
}
$rootLockHash = (Get-FileHash -Algorithm SHA256 -Path (Join-Path $workspace 'package-lock.json')).Hash
$rootStamp = Join-Path $workspace '.iinpublic-dependencies.sha256'
$reuseRootDependencies = (Test-Path (Join-Path $workspace 'node_modules')) -and
  (Test-Path $rootStamp) -and
  ((Get-Content -Raw $rootStamp).Trim() -eq $rootLockHash)
if ($reuseRootDependencies) {
  Write-Host '[windows-e2e] reusing verified root dependencies'
} else {
  & '${npmCmd}' ci --no-audit --no-fund
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
  Set-Content -NoNewline -Path $rootStamp -Value $rootLockHash
}
& '${npxCmd}' playwright install chromium webkit firefox
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
& '${npmCmd}' run build:web
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
& '${npmCmd}' run build:server
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
${testActions}
`, { stdio: 'inherit', timeoutMs: (desktopMode ? 45 : 30) * 60_000 });

const localBlobDir = path.join(repoRoot, 'blob-report', runId);
fs.mkdirSync(localBlobDir, { recursive: true });
const scpWorkspace = workspace.replace(/\\/g, '/');
const collect = spawnSync(
  'scp',
  ['-q', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=8', `${sshHost}:${scpWorkspace}/blob-report/${runId}/*/*.zip`, localBlobDir],
  { cwd: repoRoot, encoding: 'utf8', timeout: 120_000 },
);
if (collect.status === 0 && fs.readdirSync(localBlobDir).some((name) => name.endsWith('.zip'))) {
  const merge = spawnSync(
    path.join(repoRoot, 'node_modules', '.bin', 'playwright'),
    ['merge-reports', '--reporter', 'html', localBlobDir],
    { cwd: repoRoot, stdio: 'inherit', timeout: 120_000 },
  );
  if (merge.status !== 0) console.error('[windows-e2e] result merge failed; raw blob report retained');
} else {
  console.error(`[windows-e2e] no blob report collected: ${collect.stderr?.trim() || 'remote test did not emit one'}`);
}

if (remoteRun.error || remoteRun.status !== 0) {
  console.error(`[windows-e2e] remote test failed (${remoteRun.error?.message || `exit ${remoteRun.status}`})`);
  process.exit(1);
}
console.log(`[windows-e2e] ${desktopMode ? 'desktop executable' : 'browser matrix'} passed on ${remote.computerName}; report: ${path.join(repoRoot, 'playwright-report', 'index.html')}`);
