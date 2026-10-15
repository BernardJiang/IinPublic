import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const jsonOutput = process.argv.includes('--json');

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const absolute = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(absolute) : [absolute];
  }));
  return nested.flat();
}

function relative(file) {
  return path.relative(repoRoot, file).split(path.sep).join('/');
}

function laneFor(file) {
  if (file.startsWith('src/test/')) return 'host-jest-core';
  if (file.includes('/phone-path/')) return 'host-phone-simulation';
  if (file.includes('/native-app/')) {
    return /\/\d+-android-|\/android-/i.test(file) ? 'android-real-device' : 'host-native-other';
  }
  if (file.includes('/mass/')) return 'host-scale';
  if (/\/(browser-matrix|platform-smoke|cross-platform)\//.test(file)) return 'host-browser-matrix';
  if (file.includes('/talks-matching/')) return 'web-mesh-journey';
  const staged = file.match(/\/staged\/(stage\d[^/]*)\//)?.[1];
  if (staged) return `web-${staged}`;
  return 'web-other';
}

function conversionFor(lane) {
  if (lane === 'android-real-device') return 'already-on-android';
  if (lane === 'host-jest-core') return 'portable-contract-candidate';
  if (lane === 'host-scale' || lane === 'host-browser-matrix' || lane === 'host-native-other') {
    return 'keep-host-side';
  }
  return 'actor-journey-candidate';
}

const [jestFiles, e2eFiles] = await Promise.all([
  walk(path.join(repoRoot, 'src', 'test')).then((files) => files.filter((file) => file.endsWith('.test.ts'))),
  walk(path.join(repoRoot, 'tests', 'e2e')).then((files) => files.filter((file) => file.endsWith('.spec.ts'))),
]);
const files = [...jestFiles, ...e2eFiles]
  .map(relative)
  .sort()
  .map((file) => {
    const lane = laneFor(file);
    return { file, lane, conversion: conversionFor(lane) };
  });

const byLane = Object.fromEntries(
  [...new Set(files.map((entry) => entry.lane))]
    .sort()
    .map((lane) => [lane, files.filter((entry) => entry.lane === lane).length]),
);
const byConversion = Object.fromEntries(
  [...new Set(files.map((entry) => entry.conversion))]
    .sort()
    .map((conversion) => [conversion, files.filter((entry) => entry.conversion === conversion).length]),
);
const contractSource = await readFile(
  path.join(repoRoot, 'src/shared/portable-core-contracts.ts'),
  'utf8',
);
const portableContractIds = [...contractSource.matchAll(/^ {6}id: '([^']+)',$/gm)].map((match) => match[1]);
const report = {
  schemaVersion: 1,
  totals: {
    files: files.length,
    jest: jestFiles.length,
    e2e: e2eFiles.length,
    portableContracts: portableContractIds.length,
  },
  byLane,
  byConversion,
  portableContractIds,
  files,
};

const failures = [];
if (files.length === 0) failures.push('No tests were found.');
if ((byLane['host-jest-core'] || 0) !== jestFiles.length) failures.push('Some Jest tests were not classified.');
if (!byLane['android-real-device']) failures.push('No existing Android real-device specs were found.');
if (portableContractIds.length < 6) failures.push('Portable core contract set unexpectedly shrank below six cases.');
if (new Set(portableContractIds).size !== portableContractIds.length) failures.push('Portable contract ids must be unique.');

if (jsonOutput) {
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
} else {
  process.stdout.write('[android-coverage] Current test execution lanes\n');
  for (const [lane, count] of Object.entries(byLane)) {
    process.stdout.write(`  ${String(count).padStart(4)}  ${lane}\n`);
  }
  process.stdout.write('[android-coverage] Conversion disposition\n');
  for (const [conversion, count] of Object.entries(byConversion)) {
    process.stdout.write(`  ${String(count).padStart(4)}  ${conversion}\n`);
  }
  process.stdout.write(`  ${String(portableContractIds.length).padStart(4)}  portable contracts implemented\n`);
}

if (failures.length > 0) {
  for (const failure of failures) process.stderr.write(`[android-coverage] ${failure}\n`);
  process.exitCode = 1;
}
