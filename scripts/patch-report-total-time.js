#!/usr/bin/env node
/**
 * Best-effort cosmetic patch for the merged Playwright HTML report.
 *
 * `playwright merge-reports` computes the report's "Total time" as
 * `Math.max(...shardDurations)` (see node_modules/playwright/lib/reporters/merge.js,
 * mergeEndEvents) — correct for its primary use case (true parallel shards, which all start
 * around the same time and finish around the same time, so the longest shard's own duration
 * IS approximately the real wall time). scripts/run-test-all.sh instead merges several
 * separate, sequential, differently-configured phase runs, so that formula just reports the
 * single longest phase's own duration (e.g. "4.9m") with no way to override it via CLI/config
 * — there is no reporter option for this, it's hardcoded.
 *
 * This patches the merged report's embedded report.json in place with the real wall-clock
 * total that run-test-all.sh already knows authoritatively (its own start/end timestamps),
 * so the number shown in the report UI matches what actually happened. Pass/fail/skip counts
 * are untouched — those were already correct (they sum across every merged blob correctly;
 * only the *duration* field uses max() instead of a real span).
 *
 * Usage: node scripts/patch-report-total-time.js <report.html> <startTimeMs> <durationMs>
 * Failure here must never fail the calling script — this is cosmetic only. Any error exits
 * non-zero and leaves index.html untouched; the caller should treat that as a soft warning.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

function fail(msg) {
  console.error(`[patch-report-total-time] ${msg}`);
  process.exit(1);
}

const [, , htmlPath, startTimeMsRaw, durationMsRaw] = process.argv;
if (!htmlPath || !startTimeMsRaw || !durationMsRaw) {
  fail('usage: node patch-report-total-time.js <report.html> <startTimeMs> <durationMs>');
}
const startTimeMs = Number(startTimeMsRaw);
const durationMs = Number(durationMsRaw);
if (!Number.isFinite(startTimeMs) || !Number.isFinite(durationMs)) {
  fail('startTimeMs/durationMs must be numbers');
}
if (!fs.existsSync(htmlPath)) fail(`no such file: ${htmlPath}`);

const html = fs.readFileSync(htmlPath, 'utf8');
const scriptRe = /(<script id="playwrightReportBase64" type="application\/zip">)(data:application\/zip;base64,)([^<]*)(<\/script>)/;
const match = html.match(scriptRe);
if (!match) fail('could not find the embedded playwrightReportBase64 <script> tag — report format may have changed');

const [, openTag, dataPrefix, b64, closeTag] = match;
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-report-patch-'));
const zipPath = path.join(tmpDir, 'report.zip');
fs.writeFileSync(zipPath, Buffer.from(b64, 'base64'));

// report.json's name inside the zip isn't content-hash-stable across builds, but there's
// always exactly one entry literally named report.json at the archive root (the per-test-file
// detail entries are named by content hash, e.g. 15f22ce....json).
let entries;
try {
  entries = execFileSync('unzip', ['-Z1', zipPath], { encoding: 'utf8' }).split('\n').filter(Boolean);
} catch (e) {
  fail(`unzip -Z1 failed: ${e.message}`);
}
if (!entries.includes('report.json')) fail('report.json not found inside embedded zip');

let reportJsonRaw;
try {
  reportJsonRaw = execFileSync('unzip', ['-p', zipPath, 'report.json'], { encoding: 'utf8' });
} catch (e) {
  fail(`unzip -p report.json failed: ${e.message}`);
}
let reportJson;
try {
  reportJson = JSON.parse(reportJsonRaw);
} catch (e) {
  fail(`report.json is not valid JSON: ${e.message}`);
}

const originalDuration = reportJson.duration;
reportJson.startTime = startTimeMs;
reportJson.duration = durationMs;

const patchedJsonPath = path.join(tmpDir, 'report.json');
fs.writeFileSync(patchedJsonPath, JSON.stringify(reportJson));

try {
  // -j: junk the path (write report.json at the archive root, matching the original entry).
  execFileSync('zip', ['-j', zipPath, patchedJsonPath], { cwd: tmpDir });
} catch (e) {
  fail(`zip update failed: ${e.message}`);
}

const patchedB64 = fs.readFileSync(zipPath).toString('base64');
const patchedHtml = html.replace(scriptRe, `${openTag}${dataPrefix}${patchedB64}${closeTag}`);
fs.writeFileSync(htmlPath, patchedHtml);
fs.rmSync(tmpDir, { recursive: true, force: true });

console.log(
  `[patch-report-total-time] duration ${(originalDuration / 60000).toFixed(1)}m -> ${(durationMs / 60000).toFixed(1)}m ` +
    `(real wall-clock total for the whole test:all run)`,
);
