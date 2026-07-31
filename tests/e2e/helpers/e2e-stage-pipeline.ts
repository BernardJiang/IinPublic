import fs from 'fs';
import path from 'path';
import { gunBaseURL } from './ports';
import { parallelSlot } from './ports';
import { clearGunDatabases, maybeClearGunDatabases, waitForGunApiReady } from './clear-database';
import { assertTechSupportBaseline, duplicateSupportGreeting, signedGreetingProblem } from './techsupport-baseline';
import { TECHSUPPORT_STAGE_NAME } from '../../../src/shared/techsupport';

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

/**
 * Exported for `src/test/unit/stage0-fixture.test.ts` (docs/TODO.md K4): a fast, no-server
 * check that the committed `stage0.fixture.json` still passes the same integrity check every
 * stage-pipeline load/save runs, so a bad regeneration fails `npm test` instead of surfacing
 * only in a slow E2E run.
 */
export async function assertStageSnapshotIntegrity(stage: E2eStageName, snapshot: unknown): Promise<void> {
  const graph = (snapshot as { gunGraph?: Record<string, any> } | undefined)?.gunGraph;
  if (!graph) throw new Error(`[e2e-stage] ${stage} snapshot has no Gun graph`);

  // Shared with the post-reset guard in clear-database.ts — one definition of
  // "this graph has a valid built-in TechSupport" (docs/TODO.md K4).
  assertTechSupportBaseline(graph, `${stage} snapshot`);

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

  const duplicate = duplicateSupportGreeting(graph);
  if (duplicate) {
    throw new Error(`[e2e-stage] ${stage} snapshot has duplicate support greetings for ${duplicate}`);
  }

  // K2 (docs/TODO.md): any greeting that IS present (client-authored, so a snapshot may
  // legitimately have none) must be signature-valid — never required, never forbidden.
  const signedProblem = await signedGreetingProblem(graph);
  if (signedProblem) {
    throw new Error(`[e2e-stage] ${stage} snapshot: ${signedProblem}`);
  }
}

export async function saveStageSnapshot(stage: E2eStageName): Promise<void> {
  const dir = stageSnapshotsDir();
  fs.mkdirSync(dir, { recursive: true });
  const snapshot = await fetchSnapshot();
  await assertStageSnapshotIntegrity(stage, snapshot);
  fs.writeFileSync(stageSnapshotPath(stage), JSON.stringify(snapshot, null, 2));
  console.log(`[e2e-stage] validated and saved ${stage} → ${stageSnapshotPath(stage)}`);
}

export async function loadStageSnapshot(stage: E2eStageName): Promise<void> {
  const file = stageSnapshotPath(stage);
  if (!fs.existsSync(file)) {
    throw new Error(`Missing stage snapshot: ${file} (run prior stage pipeline steps first)`);
  }
  const body = JSON.parse(fs.readFileSync(file, 'utf8'));
  await assertStageSnapshotIntegrity(stage, body);
  await postSnapshot(body);
  await assertStageSnapshotIntegrity(stage, await fetchSnapshot());
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

/**
 * Stage-3 specs expect a predictable TechSupport + Adam + Eve baseline (docs/TODO.md K4).
 * In the staged pipeline, start from the stage2 snapshot (`saveStageSnapshot('stage2')`,
 * written by stage2's own `zzz-save-stage2.spec.ts`) rather than a bare clear.
 */
export async function clearGunForStage3Spec(): Promise<void> {
  if (isStagePipeline()) {
    await loadStageSnapshot('stage2');
    return;
  }
  await clearGunDatabases();
}

/**
 * Stage-4 specs start from the stage3 snapshot (written by
 * `staged/stage3-three-user/00-aaa-stage3-eve-joins.spec.ts`).
 */
export async function clearGunForStage4Spec(): Promise<void> {
  if (isStagePipeline()) {
    await loadStageSnapshot('stage3');
    return;
  }
  await clearGunDatabases();
}

/**
 * Stage-5 specs start from the stage4 snapshot (written by
 * `staged/stage4-four-user/zzz-save-stage4.spec.ts`).
 */
export async function clearGunForStage5Spec(): Promise<void> {
  if (isStagePipeline()) {
    await loadStageSnapshot('stage4');
    return;
  }
  await clearGunDatabases();
}

export async function resetToStage0Empty(): Promise<void> {
  fs.rmSync(stageSnapshotsDir(), { recursive: true, force: true });
  await clearGunDatabases({ seedTechSupportRoot: false });
}
