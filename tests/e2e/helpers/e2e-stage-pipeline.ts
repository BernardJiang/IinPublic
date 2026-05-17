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

export { maybeClearGunDatabases };

export async function resetToStage0Empty(): Promise<void> {
  await clearGunDatabases();
}
