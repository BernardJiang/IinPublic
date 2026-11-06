#!/usr/bin/env node

/**
 * Preserve the compact result rows consumed by scripts/coverage-matrix.mjs when a later targeted
 * Playwright run replaces the merged HTML report. Input is the JSONL emitted alongside the
 * canonical blob reports; output contains no attachments, console text, identities, or absolute
 * paths — only [durationMs, E2E-relative file, title, outcome].
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const inputDir = path.resolve(root, process.argv[2] || 'blob-merged');
const output = path.resolve(root, process.argv[3] || 'docs/testing/last-run-rows.json');

function visitEntries(entries, titles, byTestId) {
  for (const entry of entries || []) {
    const nextTitles = entry.title ? [...titles, entry.title] : titles;
    if (entry.testId) {
      const rawFile = String(entry.location?.file || titles[0] || '');
      const normalized = rawFile.replaceAll('\\', '/').replace(/^.*?tests\/e2e\//, '');
      byTestId.set(entry.testId, {
        file: normalized,
        title: nextTitles.filter(Boolean).join(' › '),
      });
    }
    visitEntries(entry.entries, nextTitles, byTestId);
  }
}

if (!fs.existsSync(inputDir)) throw new Error(`Playwright JSONL directory not found: ${inputDir}`);
const files = fs.readdirSync(inputDir)
  .filter((name) => /^report(?:-\d+)?\.jsonl$/.test(name))
  .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
if (files.length === 0) throw new Error(`No report JSONL files found in ${inputDir}`);

const byTestId = new Map();
const ends = [];
for (const name of files) {
  for (const line of fs.readFileSync(path.join(inputDir, name), 'utf8').split(/\r?\n/)) {
    if (!line) continue;
    const event = JSON.parse(line);
    if (event.method === 'onProject') {
      visitEntries(event.params?.project?.suites, [], byTestId);
    } else if (event.method === 'onTestEnd') {
      ends.push(event.params);
    }
  }
}

// The same case can appear in a retry/recovery blob. Keep its last result, matching Playwright's
// final-outcome view rather than making an earlier failed attempt poison a later passing retry.
const rowsByTestId = new Map();
for (const params of ends) {
  const id = params?.test?.testId;
  const meta = byTestId.get(id);
  if (!id || !meta?.file) continue;
  const status = params.result?.status;
  const expected = params.test?.expectedStatus;
  const outcome = status === 'skipped' ? 'skipped' : status === expected ? 'expected' : 'unexpected';
  rowsByTestId.set(id, [
    Number(params.result?.duration || 0),
    meta.file,
    meta.title,
    outcome,
  ]);
}

const rows = [...rowsByTestId.values()].sort((a, b) => a[1].localeCompare(b[1]) || a[2].localeCompare(b[2]));
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, `${JSON.stringify(rows, null, 2)}\n`);
console.log(`wrote ${path.relative(root, output)} — ${rows.length} final test rows from ${files.length} JSONL reports`);
