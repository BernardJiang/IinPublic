/**
 * OPEN-108 e2e: rewrite one field of one of my chained events where a stopped device keeps it, so
 * the restarted core must report the break (`graph.status.chain`), never repair it.
 *
 * Radisk stores the graph as JSON radix trees, one tree per file: a leaf `{ ':': value, '>': state }`
 * sits at the key `<soul>\x1b<field>`, split into fragments along the tree. The browser keeps the
 * files in IndexedDB (stage2/97 edits them in the page); a phone node keeps them in `<data>/radata`
 * (phone path: a folder on this machine; a real phone: pulled and pushed with `run-as`).
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

/* eslint-disable @typescript-eslint/no-explicit-any */

const ESC = String.fromCharCode(27);

export type TamperResult = { file: string; text: string; soul: string; seq: number; device: string; before: unknown; after: string };

/** Every stored leaf whose full key starts with `prefix`: key → leaf object (edited in place). */
function leavesUnder(tree: any, prefix: string): Map<string, any> {
  const found = new Map<string, any>();
  const walk = (node: any, at: string): void => {
    if (!node || typeof node !== 'object') return;
    for (const [fragment, child] of Object.entries(node)) {
      if (fragment === '' || fragment === '_') continue;
      const key = at + fragment;
      if (!prefix.startsWith(key) && !key.startsWith(prefix)) continue;
      if (!child || typeof child !== 'object') continue;
      const leaf = (child as any)[''];
      if (key.startsWith(prefix) && leaf && typeof leaf === 'object' && ':' in leaf) found.set(key, leaf);
      walk(child, key);
    }
  };
  walk(tree, '');
  return found;
}

/**
 * In the given radisk files, find the first event under `soulPrefix` that is chained (has a
 * numeric `seq`), was written by `device` when given, and has `field`; rewrite that field.
 * Returns the edited file's new text, or null when no such event is stored.
 */
export function tamperChainedEvent(
  files: Array<{ name: string; text: string }>,
  options: { soulPrefix?: string; field: string; device?: string },
): TamperResult | null {
  const soulPrefix = options.soulPrefix ?? 'local/ev/';
  for (const { name, text } of files) {
    let tree: any;
    try { tree = JSON.parse(text); } catch { continue; }
    const leaves = leavesUnder(tree, soulPrefix);
    const souls = new Set([...leaves.keys()].map((key) => key.slice(0, key.indexOf(ESC))).filter(Boolean));
    for (const soul of [...souls].sort()) {
      const at = (field: string) => leaves.get(`${soul}${ESC}${field}`);
      const seq = at('seq')?.[':'];
      const device = String(at('device')?.[':'] ?? '');
      const target = at(options.field);
      if (typeof seq !== 'number' || !target) continue;
      if (options.device && device !== options.device) continue;
      const before = target[':'];
      const after = `HACKED ${String(before)}`;
      target[':'] = after;
      return { file: name, text: JSON.stringify(tree), soul, seq, device, before, after };
    }
  }
  return null;
}

/** The same edit on a radata folder on this machine (a stopped phone-path node's data). */
export function tamperRadataDir(radataDir: string, options: { soulPrefix?: string; field: string; device?: string }): TamperResult {
  const files = fs.readdirSync(radataDir)
    .filter((name) => fs.statSync(path.join(radataDir, name)).isFile())
    .map((name) => ({ name, text: fs.readFileSync(path.join(radataDir, name), 'utf8') }));
  const result = tamperChainedEvent(files, options);
  if (!result) throw new Error(`tamper: no chained event with ${options.field} under ${options.soulPrefix ?? 'local/ev/'} in ${radataDir}`);
  fs.writeFileSync(path.join(radataDir, result.file), result.text);
  return result;
}
