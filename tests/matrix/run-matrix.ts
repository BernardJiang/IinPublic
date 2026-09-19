#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {
  StandardMatrixPeerAdapter,
  MatrixUnavailableError,
  classifyMatrixFailure,
  executeMatrixCommand,
  writeMatrixResult,
  type MatrixCommand,
  type MatrixPeerMetadata,
  type MatrixRunResult,
} from '../../src/test/support/matrix-orchestrator';

const repoRoot = path.resolve(__dirname, '..', '..');
const runId = `matrix-${new Date().toISOString().replace(/[:.]/g, '-')}-${process.pid}`;
const artifactRoot = path.join(repoRoot, 'test-results', 'matrix', runId);
const dryRun = process.argv.includes('--dry-run');
const requested = process.argv.slice(2).filter((arg) => !arg.startsWith('--'));

type Profile = {
  name: string;
  command: MatrixCommand;
  topology: MatrixPeerMetadata[];
  preflight?: MatrixCommand;
  isAvailable?: (result: Awaited<ReturnType<typeof executeMatrixCommand>>) => boolean;
};

function npmCommand(script: string, extraArgs: string[] = []): MatrixCommand {
  return {
    executable: process.platform === 'win32' ? 'npm.cmd' : 'npm',
    args: ['run', script, ...(extraArgs.length ? ['--', ...extraArgs] : [])],
    cwd: repoRoot,
    timeoutMs: 60 * 60_000,
  };
}

const localController: MatrixPeerMetadata = {
  id: 'mac-controller', host: 'localhost', platform: 'macos', kind: 'controller',
};
const profiles: Record<string, Profile> = {
  browsers: {
    name: 'browsers',
    command: npmCommand('test:e2e:browsers'),
    topology: ['chromium', 'webkit', 'firefox'].map((browser) => ({
      id: `mac-${browser}`, host: 'localhost', platform: 'macos', kind: 'browser' as const, browser,
    })),
  },
  desktop: {
    name: 'desktop',
    command: npmCommand('test:e2e:native-app', [
      'tests/e2e/native-app/01-desktop-app-boots.spec.ts',
      'tests/e2e/native-app/02-browser-and-desktop-app-presence.spec.ts',
      'tests/e2e/native-app/03-two-desktop-apps-presence.spec.ts',
      'tests/e2e/native-app/04-three-engine-talk-exchange.spec.ts',
    ]),
    topology: [
      { id: 'macos-app-a', host: 'localhost', platform: 'macos', kind: 'desktop-app' },
      { id: 'macos-app-b', host: 'localhost', platform: 'macos', kind: 'desktop-app' },
      { id: 'mac-chromium', host: 'localhost', platform: 'macos', kind: 'browser', browser: 'chromium' },
      { id: 'mac-webkit', host: 'localhost', platform: 'macos', kind: 'browser', browser: 'webkit' },
    ],
  },
  discovery: {
    name: 'discovery',
    command: npmCommand('test:e2e:native-app', [
      'tests/e2e/native-app/02-browser-and-desktop-app-presence.spec.ts',
      'tests/e2e/native-app/03-two-desktop-apps-presence.spec.ts',
    ]),
    topology: [
      { id: 'macos-app', host: 'localhost', platform: 'macos', kind: 'desktop-app' },
      { id: 'mac-browser', host: 'localhost', platform: 'macos', kind: 'browser', browser: 'chromium' },
    ],
  },
  android: {
    name: 'android',
    command: npmCommand('test:e2e:real-device-matrix'),
    preflight: { executable: 'adb', args: ['devices'], cwd: repoRoot, timeoutMs: 10_000 },
    isAvailable: (result) => result.exitCode === 0 && /^\S+\s+device$/m.test(result.stdout),
    topology: [{ id: 'android-matrix', host: 'adb', platform: 'android', kind: 'android-app', physicalDevice: 'configured devices' }],
  },
  windows: {
    name: 'windows',
    command: npmCommand('test:e2e:windows'),
    preflight: npmCommand('test:e2e:windows:preflight'),
    topology: [{ id: 'windows-worker', host: 'windows-test', platform: 'windows', kind: 'desktop-app', physicalDevice: 'windows-test' }],
  },
  ubuntu: {
    name: 'ubuntu',
    command: npmCommand('test:e2e:ubuntu:chromium'),
    preflight: npmCommand('test:e2e:ubuntu:preflight'),
    topology: [{ id: 'ubuntu-worker', host: 'ubuntu-test', platform: 'linux', kind: 'browser', browser: 'chromium', physicalDevice: 'ubuntu-test' }],
  },
};

function selectedProfiles(): Profile[] {
  if (process.argv.includes('--all')) return Object.values(profiles);
  const aliceIndex = process.argv.indexOf('--alice');
  const bobIndex = process.argv.indexOf('--bob');
  if (aliceIndex >= 0 || bobIndex >= 0) {
    const peers = [process.argv[aliceIndex + 1], process.argv[bobIndex + 1]].filter(Boolean).join(' ');
    if (/android/i.test(peers)) return [profiles.android];
    if (/windows/i.test(peers)) return [profiles.windows];
    if (/ubuntu|linux/i.test(peers)) return [profiles.ubuntu];
    if (/app|desktop/i.test(peers)) return [profiles.desktop];
    return [profiles.browsers];
  }
  const names = requested.length ? requested : ['browsers'];
  return names.map((name) => {
    const profile = profiles[name];
    if (!profile) throw new Error(`Unknown matrix profile ${name}; choose ${Object.keys(profiles).join(', ')}`);
    return profile;
  });
}

async function screenshots(): Promise<string[]> {
  const root = path.join(repoRoot, 'test-results');
  if (!fs.existsSync(root)) return [];
  const found: string[] = [];
  const visit = (directory: string): void => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(entryPath);
      else if (entry.name.endsWith('.png')) found.push(entryPath);
    }
  };
  visit(root);
  return found;
}

async function runProfile(profile: Profile): Promise<MatrixRunResult> {
  const started = Date.now();
  let lastAction = 'prepare';
  let detail = '';
  const adapter = new StandardMatrixPeerAdapter(
    localController,
    path.join(artifactRoot, profile.name),
    {
      prepare: async () => {
        if (!profile.preflight || dryRun) return;
        const result = await executeMatrixCommand(profile.preflight);
        const output = `${result.stdout}\n${result.stderr}`;
        const available = profile.isAvailable
          ? profile.isAvailable(result)
          : result.exitCode === 0 && !/\bSKIP:/.test(output);
        if (!available) {
          throw new MatrixUnavailableError(output.trim() || 'preflight unavailable');
        }
      },
      install: async () => {
        if (!fs.existsSync(path.join(repoRoot, 'node_modules', '.bin', 'playwright'))) {
          throw new Error('Playwright dependencies are not installed');
        }
      },
      reset: async () => { fs.mkdirSync(path.join(artifactRoot, profile.name), { recursive: true }); },
      start: async () => {},
      stop: async () => {},
      execute: async () => dryRun
        ? { exitCode: 0, stdout: `DRY RUN: ${profile.command.executable} ${profile.command.args.join(' ')}`, stderr: '', durationMs: 0 }
        : executeMatrixCommand(profile.command),
      screenshots,
    },
  );
  let passed = false;
  let skipped = false;
  try {
    await adapter.prepare();
    lastAction = 'install'; await adapter.install();
    lastAction = 'reset'; await adapter.reset();
    lastAction = 'start'; await adapter.start();
    lastAction = 'execute scenario action';
    await adapter.executeScenarioAction({ kind: 'run-profile', description: `run ${profile.name}` });
    passed = true;
  } catch (error) {
    skipped = error instanceof MatrixUnavailableError;
    if (skipped) passed = true;
    detail = error instanceof Error ? error.message : String(error);
  } finally {
    await adapter.stop().catch(() => {});
  }
  const artifacts = [...await adapter.collectLogs(), ...await adapter.screenshot()];
  const status = await adapter.reportStatus();
  const finished = Date.now();
  return {
    scenario: profile.name,
    startedAt: new Date(started).toISOString(),
    finishedAt: new Date(finished).toISOString(),
    durationMs: finished - started,
    passed,
    ...(skipped ? { skipped: true } : {}),
    topology: profile.topology,
    statuses: profile.topology.map((peer) => ({ ...status, peer })),
    artifacts,
    ...(!passed ? { failure: {
      peerId: status.peer.id,
      hostOrDevice: status.peer.physicalDevice ?? status.peer.host,
      action: lastAction,
      otherPeerObservations: 'No successful observation recorded after the failing action.',
      category: classifyMatrixFailure(detail),
      availableArtifacts: artifacts.map((artifact) => artifact.path),
      detail,
    } } : {}),
  };
}

async function main(): Promise<void> {
  const selected = selectedProfiles();
  const results: MatrixRunResult[] = [];
  for (const profile of selected) {
    console.log(`[matrix] ${profile.name}: checking availability before tests`);
    const result = await runProfile(profile);
    results.push(result);
    writeMatrixResult(result, path.join(artifactRoot, profile.name));
    console.log(`[matrix] ${profile.name}: ${result.passed ? 'PASS' : 'FAIL'} (${result.durationMs}ms)`);
  }
  const combined = {
    version: 1,
    generatedAt: new Date().toISOString(),
    collector: 'mac-controller',
    passed: results.every((result) => result.passed),
    results,
  };
  fs.mkdirSync(artifactRoot, { recursive: true });
  fs.writeFileSync(path.join(artifactRoot, 'combined-summary.json'), `${JSON.stringify(combined, null, 2)}\n`);
  console.log(`[matrix] combined report: ${path.join(artifactRoot, 'combined-summary.json')}`);
  if (!combined.passed) process.exitCode = 1;
}

void main().catch((error) => {
  console.error(`[matrix] ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
