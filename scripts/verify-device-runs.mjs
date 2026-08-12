import { readFileSync, writeFileSync } from 'node:fs';

const input = JSON.parse(readFileSync(new URL('../docs/device-verification/runs.json', import.meta.url), 'utf8'));
const required = ['id', 'recordedAt', 'deviceModel', 'os', 'appBuild', 'route', 'batteryState', 'networkType', 'direction', 'lifecycleState', 'result'];
const metricFields = ['latencyMs', 'throughputKbps', 'batteryDrainPercentPerHour', 'reconnectMs', 'forwardingBytes'];
const errors = [];
if (input.version !== 1 || !Array.isArray(input.runs)) errors.push('runs.json must contain version 1 and a runs array');
const ids = new Set();
for (const [index, run] of (input.runs ?? []).entries()) {
  for (const field of required) if (run?.[field] === undefined || run[field] === '') errors.push(`run ${index}: missing ${field}`);
  if (ids.has(run?.id)) errors.push(`run ${index}: duplicate id ${run.id}`); else ids.add(run?.id);
  if (!['pass', 'fail', 'unsupported'].includes(run?.result)) errors.push(`run ${index}: invalid result`);
  if (run?.result === 'pass') for (const field of metricFields) if (!Number.isFinite(run?.metrics?.[field])) errors.push(`run ${index}: passing run missing numeric metrics.${field}`);
}
const routes = [...new Set((input.runs ?? []).map((run) => run.route))].sort();
const report = {
  version: 1,
  generatedFrom: 'docs/device-verification/runs.json',
  totalRuns: input.runs?.length ?? 0,
  routes: routes.map((route) => {
    const runs = input.runs.filter((run) => run.route === route);
    const physicalPasses = runs.filter((run) => run.result === 'pass' && run.level === 'physical');
    const levels = new Set(runs.filter((run) => run.result === 'pass').map((run) => run.level));
    return { route, supported: ['contract', 'integration', 'physical'].every((level) => levels.has(level)), physicalPasses: physicalPasses.length, totalRuns: runs.length };
  }),
  errors,
};
writeFileSync(new URL('../docs/device-verification/report.json', import.meta.url), `${JSON.stringify(report, null, 2)}\n`);
console.log(`Verified ${report.totalRuns} device runs; ${report.routes.filter((route) => route.supported).length} routes qualify as supported.`);
if (errors.length) { console.error(errors.join('\n')); process.exitCode = 1; }
