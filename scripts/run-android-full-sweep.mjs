import { spawnSync } from 'node:child_process';
import { beginSweepReport, finishSweepReport } from './lib/android-sweep-report.mjs';

const args = process.argv.slice(2);
const planOnly = args.includes('--plan');

function run(script, scriptArgs = []) {
  const result = spawnSync('node', [script, ...scriptArgs], { stdio: 'inherit', env: process.env });
  return result.status ?? 1;
}

if (planOnly) {
  process.stdout.write('[android-full] mixed-release and existing phone journeys run first; they restore the latest build.\n');
  const phonePlanStatus = run('scripts/run-android-phone-e2e-sweep.mjs', ['--plan']);
  if (phonePlanStatus !== 0) process.exit(phonePlanStatus);
  process.stdout.write('\n[android-full] portable core parity runs last against that latest build.\n');
  process.exit(run('scripts/run-android-core-sweep.mjs', ['--plan']));
}

// One report for both phases: each step of each phase is listed at the end and every Playwright
// step lands in playwright-report-android/ (scripts/lib/android-sweep-report.mjs).
beginSweepReport('android-full');
const phoneStatus = run('scripts/run-android-phone-e2e-sweep.mjs');
// A phone journey failure must not suppress the latest-version core parity gate. The phone sweep
// always restores the current APK in its finally path, so this second phase remains meaningful and
// is deliberately last in the combined command.
const coreStatus = run('scripts/run-android-core-sweep.mjs');
finishSweepReport();
process.exit(phoneStatus !== 0 ? phoneStatus : coreStatus);
