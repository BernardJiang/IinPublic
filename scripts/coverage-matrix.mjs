#!/usr/bin/env node
/**
 * Coverage traceability matrix: design spec sections × E2E specs.
 *
 * Sources:
 *  - docs/specs/iinpublic-technical-specifications.md — every `## N.` / `### N.M`
 *    heading becomes an anchor (SPEC-N / SPEC-N.M). No spec-file edits required.
 *  - tests/e2e/** companion .md files — a `covers: SPEC-3.4, SPEC-7.6` line links the
 *    sibling .spec.ts to anchors. (Seeded mechanically once; refine by hand over time.)
 *  - playwright-report/index.html — latest merged report; a claimed anchor only counts
 *    as covered if at least one linked test actually ran and passed.
 *
 * Output: docs/testing/coverage-matrix.md
 *
 * Modes:
 *  node scripts/coverage-matrix.mjs            # regenerate the matrix
 *  node scripts/coverage-matrix.mjs --check    # ratchet: fail if a NEW spec file has no
 *                                              # covers: tag, or an anchor covered in
 *                                              # docs/testing/coverage-baseline.json lost
 *                                              # all passing coverage. Regenerates too.
 *  node scripts/coverage-matrix.mjs --update-baseline   # rewrite the baseline
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SPEC_DOC = path.join(ROOT, 'docs/specs/iinpublic-technical-specifications.md');
const E2E_DIR = path.join(ROOT, 'tests/e2e');
const REPORT_HTML = path.join(ROOT, 'playwright-report/index.html');
const OUT = path.join(ROOT, 'docs/testing/coverage-matrix.md');
const BASELINE = path.join(ROOT, 'docs/testing/coverage-baseline.json');

// ---------- 1. spec anchors ----------
// Parts that contain no testable behavior: introduction/overview (1–2) and
// roadmap/testing-strategy/meta chapters (14–18). They are excluded from the
// matrix and the ratchet so the zero-coverage list stays actionable.
const INFORMATIONAL_PARTS = new Set([1, 2, 14, 15, 16, 17, 18]);

function parseAnchors() {
  const anchors = new Map(); // id -> { id, title, line }
  const lines = fs.readFileSync(SPEC_DOC, 'utf8').split('\n');
  lines.forEach((l, i) => {
    const m = l.match(/^#{2,3}\s+(\d+(?:\.\d+)?)[.\s]\s*(.+)$/);
    if (!m) return;
    if (INFORMATIONAL_PARTS.has(Math.floor(Number(m[1])))) return;
    anchors.set(`SPEC-${m[1]}`, { id: `SPEC-${m[1]}`, title: m[2].trim(), line: i + 1 });
  });
  return anchors;
}

// ---------- 2. companion covers: tags ----------
function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

function parseCompanions() {
  const files = walk(E2E_DIR);
  const specs = files.filter((f) => f.endsWith('.spec.ts'));
  const links = []; // { specRel, anchors[], hasCompanion, hasTag }
  for (const spec of specs) {
    const md = spec.replace(/\.spec\.ts$/, '.md');
    const rel = path.relative(E2E_DIR, spec);
    const entry = { specRel: rel, anchors: [], hasCompanion: fs.existsSync(md), hasTag: false };
    if (entry.hasCompanion) {
      const text = fs.readFileSync(md, 'utf8');
      const m = text.match(/^covers:\s*(.+)$/m);
      if (m) {
        entry.hasTag = true;
        entry.anchors = m[1]
          .replace(/<!--.*?-->/g, '')
          .split(',')
          .map((s) => s.trim())
          .filter((s) => /^SPEC-\d+(\.\d+)?$/.test(s));
      }
    }
    links.push(entry);
  }
  return links;
}

// ---------- 3. latest report results (minimal zip reader, no deps) ----------
function parseReport() {
  const results = new Map(); // fileName -> { total, passed, skipped, failed }
  if (!fs.existsSync(REPORT_HTML)) return { results, found: false };
  const html = fs.readFileSync(REPORT_HTML, 'utf8');
  const marker = 'data:application/zip;base64,';
  const i = html.indexOf(marker);
  if (i === -1) return { results, found: false };
  const end = html.indexOf('"', i + marker.length);
  const zip = Buffer.from(html.slice(i + marker.length, end), 'base64');
  // End-of-central-directory → central directory entries → local headers.
  const eocd = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (eocd === -1) return { results, found: false };
  let off = zip.readUInt32LE(eocd + 16);
  const count = zip.readUInt16LE(eocd + 10);
  let reportJson = null;
  for (let n = 0; n < count; n++) {
    if (zip.readUInt32LE(off) !== 0x02014b50) break;
    const method = zip.readUInt16LE(off + 10);
    const compSize = zip.readUInt32LE(off + 20);
    const nameLen = zip.readUInt16LE(off + 28);
    const extraLen = zip.readUInt16LE(off + 30);
    const commentLen = zip.readUInt16LE(off + 32);
    const localOff = zip.readUInt32LE(off + 42);
    const name = zip.slice(off + 46, off + 46 + nameLen).toString();
    if (name === 'report.json') {
      const lNameLen = zip.readUInt16LE(localOff + 26);
      const lExtraLen = zip.readUInt16LE(localOff + 28);
      const dataStart = localOff + 30 + lNameLen + lExtraLen;
      const raw = zip.slice(dataStart, dataStart + compSize);
      reportJson = method === 8 ? zlib.inflateRawSync(raw) : raw;
      break;
    }
    off += 46 + nameLen + extraLen + commentLen;
  }
  if (!reportJson) return { results, found: false };
  const rep = JSON.parse(reportJson.toString());
  let anyDuration = false;
  for (const f of rep.files || []) {
    const r = { total: 0, passed: 0, skipped: 0, failed: 0 };
    for (const t of f.tests || []) {
      r.total++;
      if (t.duration > 0) anyDuration = true;
      if (t.outcome === 'expected') r.passed++;
      else if (t.outcome === 'skipped') r.skipped++;
      else r.failed++;
    }
    results.set(f.fileName.replace(/^tests\/e2e\//, ''), r);
  }
  // A `playwright test --list` invocation also writes an HTML report — every duration is 0
  // and nothing actually ran. Treat that as "no report".
  if (!anyDuration) return { results: new Map(), found: false };
  return { results, found: true };
}

/**
 * Fallback results source: docs/testing/last-run-rows.json — rows of
 * [durationMs, fileName, title, outcome] extracted from an earlier real merged report.
 * Used only when playwright-report/index.html is missing or is a listing artifact.
 */
function parseRows(file) {
  const results = new Map();
  if (!fs.existsSync(file)) return { results, found: false };
  for (const [, fileName, , outcome] of JSON.parse(fs.readFileSync(file, 'utf8'))) {
    const key = fileName.replace(/^tests\/e2e\//, '');
    const r = results.get(key) || { total: 0, passed: 0, skipped: 0, failed: 0 };
    r.total++;
    if (outcome === 'expected') r.passed++;
    else if (outcome === 'skipped') r.skipped++;
    else r.failed++;
    results.set(key, r);
  }
  return { results, found: true };
}

// ---------- 4. build + emit ----------
const args = new Set(process.argv.slice(2));
const anchors = parseAnchors();
const links = parseCompanions();
let { results, found: reportFound } = parseReport();
let resultsSource = 'playwright-report/index.html';
if (!reportFound) {
  ({ results, found: reportFound } = parseRows(path.join(ROOT, 'docs/testing/last-run-rows.json')));
  resultsSource = 'docs/testing/last-run-rows.json (fallback snapshot)';
}

const byAnchor = new Map([...anchors.keys()].map((k) => [k, []]));
const unknownAnchors = new Set();
for (const l of links) {
  for (const a of l.anchors) {
    if (byAnchor.has(a)) byAnchor.get(a).push(l);
    else unknownAnchors.add(`${a} (in ${l.specRel})`);
  }
}

function passState(l) {
  const r = results.get(l.specRel);
  if (!r) return 'not-in-report';
  if (r.failed > 0) return 'failing';
  if (r.passed > 0) return 'passing';
  return 'skipped';
}

const rows = [];
const zeroCoverage = [];
for (const [id, { title }] of anchors) {
  const linked = byAnchor.get(id);
  const passing = linked.filter((l) => passState(l) === 'passing');
  const state = linked.length === 0 ? '—' : passing.length > 0 ? '✅' : '⚠️ declared only';
  if (passing.length === 0) zeroCoverage.push({ id, title, declared: linked.length });
  rows.push(
    `| ${id} | ${title} | ${linked.length} | ${passing.length} | ${state} | ${linked
      .slice(0, 6)
      .map((l) => `\`${l.specRel}\``)
      .join('<br>') || ''} |`,
  );
}

const untagged = links.filter((l) => !l.hasTag);

const out = [
  '# Coverage Matrix — design spec × E2E suite',
  '',
  `_Generated by \`scripts/coverage-matrix.mjs\` on ${new Date().toISOString().slice(0, 10)}. Do not edit by hand._`,
  '',
  `- Spec anchors (numbered \`##\`/\`###\` headings): **${anchors.size}**`,
  `- E2E spec files: **${links.length}** (tagged: ${links.length - untagged.length}, untagged: ${untagged.length})`,
  `- Latest results: ${reportFound ? `${resultsSource} (${results.size} spec files with results)` : '**not found** — run the suite first'}`,
  '',
  '"Passing" requires the linked test to exist in the latest merged report with a passing outcome —',
  'a `covers:` claim on a skipped/excluded/failing test does NOT count.',
  '',
  '## Matrix',
  '',
  '| Anchor | Spec section | Declared | Passing | State | Tests |',
  '|---|---|---:|---:|---|---|',
  ...rows,
  '',
  '## Anchors with no passing coverage',
  '',
  ...zeroCoverage.map((z) => `- **${z.id}** ${z.title}${z.declared ? ` _(declared by ${z.declared} spec(s), none passing in latest report)_` : ''}`),
  '',
  '## Spec files without a `covers:` tag',
  '',
  ...(untagged.length ? untagged.map((l) => `- \`${l.specRel}\``) : ['_none_']),
  '',
  ...(unknownAnchors.size
    ? ['## Unknown anchors referenced', '', ...[...unknownAnchors].map((u) => `- ${u}`), '']
    : []),
].join('\n');

fs.writeFileSync(OUT, out);
console.log(`wrote ${path.relative(ROOT, OUT)} — ${anchors.size} anchors, ${links.length} specs, ${zeroCoverage.length} anchors without passing coverage, ${untagged.length} untagged specs`);

// ---------- 5. ratchet ----------
const covered = [...anchors.keys()].filter((id) => byAnchor.get(id).some((l) => passState(l) === 'passing'));
if (args.has('--update-baseline') || !fs.existsSync(BASELINE)) {
  fs.writeFileSync(
    BASELINE,
    JSON.stringify(
      {
        coveredAnchors: covered,
        taggedSpecs: links.filter((l) => l.hasTag).map((l) => l.specRel),
        knownUntagged: untagged.map((l) => l.specRel),
      },
      null,
      2,
    ),
  );
  console.log(`baseline ${args.has('--update-baseline') ? 'updated' : 'created'}: ${covered.length} covered anchors`);
}
if (args.has('--check')) {
  const base = JSON.parse(fs.readFileSync(BASELINE, 'utf8'));
  const lost = base.coveredAnchors.filter((id) => !covered.includes(id));
  // Only flag untagged specs that are NEW since the baseline was written.
  const baseAllSpecs = new Set([...base.taggedSpecs, ...(base.knownUntagged || [])]);
  const trulyNewUntagged = untagged.filter((l) => !baseAllSpecs.has(l.specRel));
  let failed = false;
  if (lost.length) {
    console.error(`FAIL: anchors lost passing coverage vs baseline: ${lost.join(', ')}`);
    failed = true;
  }
  if (trulyNewUntagged.length) {
    console.error(`FAIL: new spec files without covers: tag: ${trulyNewUntagged.map((l) => l.specRel).join(', ')}`);
    failed = true;
  }
  if (failed) process.exit(1);
  console.log('check passed: no coverage regressions, no new untagged specs');
}
