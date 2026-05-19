import fs from 'fs';
import path from 'path';
import { gunBaseURL } from './ports';
import { parallelSlot } from './ports';
import { clearGunDatabases, maybeClearGunDatabases, waitForGunApiReady } from './clear-database';

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

export async function saveStageSnapshot(stage: E2eStageName): Promise<void> {
  const dir = stageSnapshotsDir();
  fs.mkdirSync(dir, { recursive: true });
  const snapshot = await fetchSnapshot();
  fs.writeFileSync(stageSnapshotPath(stage), JSON.stringify(snapshot, null, 2));
  console.log(`[e2e-stage] saved ${stage} → ${stageSnapshotPath(stage)}`);
}

export async function loadStageSnapshot(stage: E2eStageName): Promise<void> {
  const file = stageSnapshotPath(stage);
  if (!fs.existsSync(file)) {
    throw new Error(`Missing stage snapshot: ${file} (run prior stage pipeline steps first)`);
  }
  const body = JSON.parse(fs.readFileSync(file, 'utf8'));
  await postSnapshot(body);
  console.log(`[e2e-stage] loaded ${stage} ← ${file}`);
}

export { maybeClearGunDatabases, clearGunDatabases };

/**
 * Stage-1 specs each spin up a fresh browser user and expect Global headcount 1.
 * Always clear Gun (do not use maybeClearGunDatabases — it is a no-op in stage pipeline).
 */
export async function clearGunForStage1Spec(): Promise<void> {
  await clearGunDatabases();
}

/** Stage1 snapshot should remain TechSupport-only (per staged/README.md). */
export async function saveStage1SnapshotFromStage0Baseline(): Promise<void> {
  await loadStageSnapshot('stage0');
  await saveStageSnapshot('stage1');
}

/**
 * Stage-2 specs each spin up fresh browser users and expect predictable headcounts.
 * Always clear Gun (maybeClearGunDatabases is a no-op in stage pipeline).
 */
export async function clearGunForStage2Spec(): Promise<void> {
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
  await clearGunDatabases();
}
