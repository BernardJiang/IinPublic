import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { configuredAndroidDevices, type ConfiguredAndroidDevice } from './android-device-config';
import { isAndroidDeviceReady } from './native-app-android';

/**
 * Priority-ordered hardware/host detection for the physical cross-platform matrix specs
 * (docs/TODO.md Priority 3 / Stage 6 "Central Test Matrix Orchestrator"). Per the user's stated
 * priority: real Android phones first, then a Windows worker, then an Ubuntu worker, and only
 * the local Mac mini's own app/browsers as the guaranteed-available fallback (it needs no remote
 * reachability check — it's the machine the test itself runs on).
 *
 * This module answers "what's available right now" — it does not itself launch or drive any
 * peer. A category can be `available: true` (the hardware/host is reachable) while
 * `livePeerSupport: false` (nothing in this repo yet knows how to make that platform a live
 * participant in a SHARED real-time scenario alongside the others). Android and macOS both have
 * `livePeerSupport: true` today (`launchAndroidUserViaAdb`, `bootstrapNativeWindow`/
 * `bootstrapBrowserUserOnOrigin` — see `06-seven-client-real-device-matrix.spec.ts`). Windows and
 * Ubuntu currently only have REMOTE-BATCH support (`scripts/run-windows-e2e.mjs`/
 * `run-ubuntu-e2e.mjs`: SSH in, build, run Playwright entirely on that host, ship a report back)
 * — not a live session this Mac-orchestrated matrix can join in real time. Detecting them here is
 * still useful (visibility + a building block for that capability later); claiming they already
 * participate would not be.
 */

export type MatrixPlatform = 'android' | 'windows' | 'ubuntu' | 'macos';

export type PlatformAvailability = {
  platform: MatrixPlatform;
  /** Logical name — a phone's configured name, or the platform label for host-level entries. */
  name: string;
  available: boolean;
  /** Whether this repo can make this platform a LIVE participant in a shared real-time scenario
   *  today (see this module's doc comment) — distinct from `available`. */
  livePeerSupport: boolean;
  detail: string;
};

type HostsConfig = {
  windows?: { sshHost: string };
  ubuntu?: { sshHost: string };
};

function readHostsConfig(): HostsConfig {
  // Mirrors android-device-config.ts's CONFIG_PATH exactly (same helpers/ directory depth):
  // helpers/ -> native-app/ -> e2e/ -> tests/, then matrix/hosts.json.
  const configPath = path.resolve(__dirname, '..', '..', '..', 'matrix', 'hosts.json');
  try {
    return JSON.parse(fs.readFileSync(configPath, 'utf8')) as HostsConfig;
  } catch {
    return {};
  }
}

/** Lightweight reachability probe — same `ssh -o BatchMode=yes -o ConnectTimeout=8` shape
 *  `scripts/run-windows-e2e.mjs`/`run-ubuntu-e2e.mjs` already use for their own preflight gate,
 *  kept intentionally minimal here (just "is it reachable", not a full host profile — the
 *  dedicated preflight scripts remain the authority for that). */
function isSshHostReachable(sshHost: string, timeoutMs = 8_000): boolean {
  const result = spawnSync(
    'ssh',
    ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=8', sshHost, 'true'],
    { timeout: timeoutMs, stdio: 'ignore' },
  );
  return !result.error && result.status === 0;
}

async function detectAndroidAvailability(): Promise<PlatformAvailability[]> {
  const configured = configuredAndroidDevices();
  const results = await Promise.all(
    configured.map(async (device: ConfiguredAndroidDevice) => {
      const ready = await isAndroidDeviceReady(device.serial);
      return {
        platform: 'android' as const,
        name: device.name,
        available: ready,
        livePeerSupport: true,
        detail: ready
          ? `${device.serial}${device.model ? ` (${device.model})` : ''} connected/authorized via adb`
          : `${device.serial} not connected/authorized via adb`,
      };
    }),
  );
  return results;
}

function detectHostAvailability(platform: 'windows' | 'ubuntu', sshHost: string | undefined): PlatformAvailability {
  if (!sshHost) {
    return {
      platform,
      name: platform,
      available: false,
      livePeerSupport: false,
      detail: `no sshHost configured in tests/matrix/hosts.json for "${platform}"`,
    };
  }
  const reachable = isSshHostReachable(sshHost);
  return {
    platform,
    name: platform,
    available: reachable,
    // Reachable today only via the remote-batch runners (scripts/run-windows-e2e.mjs /
    // run-ubuntu-e2e.mjs) — not yet a live participant in a Mac-orchestrated shared scenario.
    // See this module's doc comment.
    livePeerSupport: false,
    detail: reachable
      ? `ssh ${sshHost} reachable (remote-batch only — no live shared-scenario peer runner yet)`
      : `ssh ${sshHost} unreachable`,
  };
}

function detectMacosAvailability(): PlatformAvailability {
  // The local host the test itself runs on — always available, no reachability check needed.
  return {
    platform: 'macos',
    name: 'macos',
    available: true,
    livePeerSupport: true,
    detail: 'local Mac mini (app + Chromium/WebKit/Firefox)',
  };
}

/**
 * Full priority-ordered report: every configured Android phone, then the Windows worker, then
 * the Ubuntu worker, then the local Mac mini (always available). Callers that only care about
 * which platforms can act as LIVE peers today should filter on `livePeerSupport`.
 */
export async function detectAvailableEnvironments(): Promise<PlatformAvailability[]> {
  const [android, windows, ubuntu] = await Promise.all([
    detectAndroidAvailability(),
    Promise.resolve(detectHostAvailability('windows', readHostsConfig().windows?.sshHost)),
    Promise.resolve(detectHostAvailability('ubuntu', readHostsConfig().ubuntu?.sshHost)),
  ]);
  return [...android, windows, ubuntu, detectMacosAvailability()];
}

/** Human-readable one-line-per-entry summary, in priority order, for test console logs. */
export function formatAvailabilityReport(entries: PlatformAvailability[]): string {
  return entries
    .map((entry) => {
      const status = entry.available ? 'available' : 'unavailable';
      const live = entry.livePeerSupport ? '' : ' [not yet — no live peer runner]';
      return `  [${entry.platform}] ${entry.name}: ${status}${live} — ${entry.detail}`;
    })
    .join('\n');
}
