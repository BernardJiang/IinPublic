#!/usr/bin/env node
// OPEN-121 step 1: where test:all's time goes, from the run's Playwright blob reports.
//
//   node scripts/test-timing-report.mjs <blob dir> [--json out.json] [--compare earlier.json] [--top N]
//
// Reads every blob zip under <blob dir> (each phase writes one) without merging them, so it works
// even when phases used different configs. Prints, per phase, its wall time, workers and folders;
// then test time by folder; then the slowest spec files. With --json it saves the numbers, and
// with --compare it prints each slow file's change against an earlier saved run.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const dir = args.find((a, i) => !a.startsWith('--') && !['--json', '--compare', '--top'].includes(args[i - 1]));
const top = Number(opt('--top') || 30);
if (!dir || !fs.existsSync(dir)) {
  console.error('usage: node scripts/test-timing-report.mjs <blob dir> [--json out.json] [--compare earlier.json] [--top N]');
  process.exit(2);
}

const zips = [];
(function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p); else if (p.endsWith('.zip')) zips.push(p);
  }
})(dir);
if (!zips.length) { console.error(`[timing] no blob zips under ${dir}`); process.exit(1); }

const rel = (file) => String(file || '?').replace(/^.*?tests\/e2e\//, '');
const folderOf = (file) => rel(file).split('/').slice(0, -1).join('/') || '(root)';
const files = {};
const phases = [];
const timed = {}; // '⏱ …' test.step titles → { ms, n }
for (const zip of zips) {
  const names = execFileSync('unzip', ['-Z1', zip], { encoding: 'utf8' }).split('\n').filter((n) => n.endsWith('.jsonl'));
  for (const name of names) {
    const idToFile = {};
    const stepTitles = {};
    const phase = { blob: path.basename(zip, '.zip'), project: '', workers: '?', wallMs: 0, folders: {} };
    const text = execFileSync('unzip', ['-p', zip, name], { encoding: 'utf8', maxBuffer: 1 << 30 });
    for (const line of text.split('\n')) {
      if (!line.includes('"method":"on')) continue;
      let m; try { m = JSON.parse(line); } catch { continue; }
      if (m.method === 'onConfigure') phase.workers = m.params.config.workers;
      else if (m.method === 'onProject') {
        phase.project = m.params.project.name || phase.project;
        (function walk(entries, file) {
          for (const t of entries || []) {
            const f = t.location?.file || file;
            if (t.testId) idToFile[t.testId] = f; else walk(t.entries, f);
          }
        })(m.params.project.suites, '');
      } else if (m.method === 'onTestEnd') {
        const file = rel(idToFile[m.params.test.testId]);
        const r = m.params.result;
        const e = files[file] ||= { ms: 0, results: 0, retries: 0, failed: 0 };
        e.ms += r.duration; e.results++;
        if (r.retry > 0) e.retries++;
        if (r.status !== 'passed' && r.status !== 'skipped') e.failed++;
        phase.folders[folderOf(file)] = (phase.folders[folderOf(file)] || 0) + r.duration;
      } else if (m.method === 'onStepBegin') {
        if (m.params.step.title?.startsWith('⏱')) stepTitles[m.params.step.id] = m.params.step.title;
      } else if (m.method === 'onStepEnd') {
        const title = stepTitles[m.params.step.id];
        if (title) { const t = timed[title] ||= { ms: 0, n: 0 }; t.ms += m.params.step.duration; t.n++; }
      } else if (m.method === 'onEnd') phase.wallMs = m.params.result.duration;
    }
    phases.push(phase);
  }
}

const min = (ms) => (ms / 60000).toFixed(1);
const totalMs = Object.values(files).reduce((a, f) => a + f.ms, 0);
console.log(`[timing] ${zips.length} blob(s), ${Object.values(files).reduce((a, f) => a + f.results, 0)} results, ${min(totalMs)} test-minutes`);

console.log('\n[timing] phases (wall min, workers, test-min by folder); the longest sets the run');
for (const p of phases.sort((a, b) => b.wallMs - a.wallMs)) {
  const folders = Object.entries(p.folders).sort((a, b) => b[1] - a[1]).map(([f, ms]) => `${f} ${min(ms)}`).join(' | ');
  console.log(`  ${min(p.wallMs).padStart(5)}  w=${String(p.workers).padEnd(3)} ${p.project.padEnd(9)} ${folders}`);
}

const folders = {};
for (const [f, v] of Object.entries(files)) {
  const x = folders[folderOf(f)] ||= { ms: 0, results: 0, files: 0 };
  x.ms += v.ms; x.results += v.results; x.files++;
}
console.log('\n[timing] by folder (test-min, results, files)');
for (const [f, v] of Object.entries(folders).sort((a, b) => b[1].ms - a[1].ms)) {
  console.log(`  ${min(v.ms).padStart(6)} ${String(v.results).padStart(5)} ${String(v.files).padStart(4)}  ${f}`);
}

const earlier = opt('--compare') && fs.existsSync(opt('--compare')) ? JSON.parse(fs.readFileSync(opt('--compare'), 'utf8')).files : null;
console.log(`\n[timing] slowest ${top} spec files (min, results${earlier ? ', change vs earlier' : ''})`);
for (const [f, v] of Object.entries(files).sort((a, b) => b[1].ms - a[1].ms).slice(0, top)) {
  const flags = `${v.retries ? ` retries=${v.retries}` : ''}${v.failed ? ` failed=${v.failed}` : ''}`;
  const delta = earlier ? (earlier[f] ? ` ${v.ms - earlier[f].ms >= 0 ? '+' : ''}${min(v.ms - earlier[f].ms)}` : ' new') : '';
  console.log(`  ${(v.ms / 60000).toFixed(2).padStart(6)} ${String(v.results).padStart(3)}${delta.padStart(earlier ? 7 : 0)}  ${f}${flags}`);
}

if (Object.keys(timed).length) {
  console.log('\n[timing] timed helper steps (test-min, count, mean s)');
  for (const [t, v] of Object.entries(timed).sort((a, b) => b[1].ms - a[1].ms)) {
    console.log(`  ${min(v.ms).padStart(6)} ${String(v.n).padStart(5)} ${(v.ms / v.n / 1000).toFixed(1).padStart(6)}  ${t}`);
  }
}

if (opt('--json')) {
  fs.writeFileSync(opt('--json'), JSON.stringify({ totalMs, phases, files, timed }, null, 1));
  console.log(`\n[timing] saved ${opt('--json')}`);
}
