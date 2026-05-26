import fs from 'fs';
import path from 'path';
import { gunBaseURL } from './ports';
import { parallelSlot } from './ports';
import { clearGunDatabases, maybeClearGunDatabases, waitForGunApiReady } from './clear-database';
import {
  TECHSUPPORT_NETWORK_ROLE,
  TECHSUPPORT_ROOT_USER_ID,
  TECHSUPPORT_STAGE_NAME,
} from '../../../src/shared/techsupport';

export type E2eStageName = 'stage0' | 'stage1' | 'stage2' | 'stage3' | 'stage4' | 'stage5';

export function isStagePipeline(): boolean {
  return process.env.E2E_STAGE_PIPELINE === '1' || process.env.E2E_STAGE_PIPELINE === 'true';
}

export function stageSnapshotsDir(): string {
  const slot = parallelSlot();
  return path.join(process.cwd(), 'tests/e2e/staged/snapshots', `worker-${slot}`);
}

export function stageSnapshotPath(stage: E2eStageName): string {
  return path.join(stageSnapshotsDir(), `${stage}.json`);
}

export function stageStoragePath(stage: E2eStageName, userKey: string): string {
  return path.join(stageSnapshotsDir(), `${stage}-${userKey}.storage.json`);
}

async function fetchSnapshot(): Promise<unknown> {
  await waitForGunApiReady();
  const res = await fetch(`${gunBaseURL()}/api/test/export-snapshot`);
  if (!res.ok) throw new Error(`export-snapshot failed: ${res.status} ${await res.text()}`);
  return res.json();
}

async function postSnapshot(body: unknown): Promise<void> {
  await waitForGunApiReady();
  const res = await fetch(`${gunBaseURL()}/api/test/import-snapshot`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`import-snapshot failed: ${res.status} ${await res.text()}`);
}

function assertStageSnapshotIntegrity(stage: E2eStageName, snapshot: unknown): void {
  const graph = (snapshot as { gunGraph?: Record<string, any> } | undefined)?.gunGraph;
  if (!graph) throw new Error(`[e2e-stage] ${stage} snapshot has no Gun graph`);

  const rootSoul = `users/${TECHSUPPORT_ROOT_USER_ID}`;
  const root = graph[rootSoul];
  const networkRoot = graph['network-root-techsupport'];
  const globalMember = graph[`chatrooms/global/users/${TECHSUPPORT_ROOT_USER_ID}`];
  if (
    root?.id !== TECHSUPPORT_ROOT_USER_ID ||
    root?.stageName !== TECHSUPPORT_STAGE_NAME ||
    root?.networkRole !== TECHSUPPORT_NETWORK_ROLE
  ) {
    throw new Error(`[e2e-stage] ${stage} snapshot is missing the canonical TechSupport user root`);
  }
  if (
    networkRoot?.userId !== TECHSUPPORT_ROOT_USER_ID ||
    networkRoot?.stageName !== TECHSUPPORT_STAGE_NAME ||
    networkRoot?.networkRole !== TECHSUPPORT_NETWORK_ROLE
  ) {
    throw new Error(`[e2e-stage] ${stage} snapshot is missing the canonical TechSupport network marker`);
  }
  if (
    globalMember?.userId !== TECHSUPPORT_ROOT_USER_ID ||
    globalMember?.stageName !== TECHSUPPORT_STAGE_NAME ||
    globalMember?.isActive !== true
  ) {
    throw new Error(`[e2e-stage] ${stage} snapshot does not keep TechSupport active in Global`);
  }

  const userRoots = Object.entries(graph)
    .filter(([soul, record]) => /^users\/[^/]+$/.test(soul) && record?.stageName)
    .map(([, record]) => String(record.stageName))
    .sort();
  const expectedStableUsers: Partial<Record<E2eStageName, string[]>> = {
    stage0: [TECHSUPPORT_STAGE_NAME],
    stage1: [TECHSUPPORT_STAGE_NAME],
    stage2: ['Adam', TECHSUPPORT_STAGE_NAME],
    stage3: ['Adam', 'Eve', TECHSUPPORT_STAGE_NAME],
  };
  const expected = expectedStableUsers[stage]?.slice().sort();
  if (expected && JSON.stringify(userRoots) !== JSON.stringify(expected)) {
    throw new Error(
      `[e2e-stage] ${stage} snapshot user roots are ${userRoots.join(', ') || 'empty'}; expected ${expected.join(', ')}`,
    );
  }

  const welcomeReceivers = new Set<string>();
  for (const soul of Object.keys(graph)) {
    const match = soul.match(/^conversations\/conv_support_[^/]+\/messages\/support_welcome_(.+)$/);
    if (!match) continue;
    if (welcomeReceivers.has(match[1])) {
      throw new Error(`[e2e-stage] ${stage} snapshot has duplicate support greetings for ${match[1]}`);
    }
    welcomeReceivers.add(match[1]);
  }
}

export async function saveStageSnapshot(stage: E2eStageName): Promise<void> {
  const dir = stageSnapshotsDir();
  fs.mkdirSync(dir, { recursive: true });
  const snapshot = await fetchSnapshot();
  assertStageSnapshotIntegrity(stage, snapshot);
  fs.writeFileSync(stageSnapshotPath(stage), JSON.stringify(snapshot, null, 2));
  console.log(`[e2e-stage] validated and saved ${stage} → ${stageSnapshotPath(stage)}`);
}

export async function loadStageSnapshot(stage: E2eStageName): Promise<void> {
  const file = stageSnapshotPath(stage);
  if (!fs.existsSync(file)) {
    throw new Error(`Missing stage snapshot: ${file} (run prior stage pipeline steps first)`);
  }
  const body = JSON.parse(fs.readFileSync(file, 'utf8'));
  assertStageSnapshotIntegrity(stage, body);
  await postSnapshot(body);
  assertStageSnapshotIntegrity(stage, await fetchSnapshot());
  console.log(`[e2e-stage] validated and loaded ${stage} ← ${file}`);
}

export { maybeClearGunDatabases, clearGunDatabases };

/**
 * Stage-1 specs each spin up a fresh browser user.
 * In the staged pipeline, preserve the TechSupport root baseline from stage0.
 */
export async function clearGunForStage1Spec(): Promise<void> {
  if (isStagePipeline()) {
    await loadStageSnapshot('stage0');
    return;
  }
  await clearGunDatabases();
}

/** Stage1 snapshot should remain TechSupport-only (per staged/README.md). */
export async function saveStage1SnapshotFromStage0Baseline(): Promise<void> {
  await loadStageSnapshot('stage0');
  await saveStageSnapshot('stage1');
}

/**
 * Stage-2 specs each spin up fresh browser users and expect predictable headcounts.
 * In the staged pipeline, start from the stage1 baseline, which is derived from stage0.
 */
export async function clearGunForStage2Spec(): Promise<void> {
  if (isStagePipeline()) {
    await loadStageSnapshot('stage1');
    return;
  }
  await clearGunDatabases();
}

export function stage2AdamJoinBaselinePath(): string {
  return path.join(stageSnapshotsDir(), 'stage2-adam-join-baseline.json');
}

/** Copy post–Adam-join graph so zzz-save can discard pollution from later specs. */
export async function saveStage2AdamJoinBaseline(): Promise<void> {
  const baseline = stage2AdamJoinBaselinePath();
  fs.mkdirSync(path.dirname(baseline), { recursive: true });
  fs.copyFileSync(stageSnapshotPath('stage2'), baseline);
}

async function loadStage2AdamJoinBaseline(): Promise<void> {
  const file = stage2AdamJoinBaselinePath();
  if (!fs.existsSync(file)) {
    throw new Error(`Missing stage2 Adam join baseline: ${file} (run 00-aaa-stage2-adam-joins first)`);
  }
  const body = JSON.parse(fs.readFileSync(file, 'utf8'));
  await postSnapshot(body);
}

/** Stage2 snapshot should remain TechSupport + Adam (per staged/README.md). */
export async function saveStage2SnapshotFromAdamJoinBaseline(): Promise<void> {
  await loadStage2AdamJoinBaseline();
  await saveStageSnapshot('stage2');
}

export async function resetToStage0Empty(): Promise<void> {
  fs.rmSync(stageSnapshotsDir(), { recursive: true, force: true });
  await clearGunDatabases({ seedTechSupportRoot: false });
}
