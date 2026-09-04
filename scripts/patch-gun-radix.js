#!/usr/bin/env node
/**
 * Patches a real, reproducible bug in Gun.js's on-disk radix-tree implementation
 * (node_modules/gun/lib/radix.js, used by Radisk for on-device persistence on embedded/mobile
 * nodes — the production relay never hits this since it runs permanently ephemeral).
 *
 * A tree position can end up holding a raw primitive (observed: a bare HAM timestamp number)
 * instead of an object. Two sites in this file assume every tree node is an object and crash
 * when it isn't:
 *   - Radix()'s write path: `at[''] = val` throws "Cannot create property '' on number '...'".
 *   - Radix.map's read path: `t[_] = ...` throws the same shape (the property name there is a
 *     non-printable control character, invisible in logs, so it also *looks* like an empty
 *     property name even though it's a different site).
 *
 * Reproduced live, 2026-09-04: this corrupts itself from a completely empty on-device store
 * within seconds of a fresh boot under normal write activity, not just from stale/legacy data —
 * confirmed by wiping the relay and all three affected phones simultaneously and watching it
 * recur. A process-level guard (quarantine + restart, src/node-app/embedded-node.ts) could not
 * keep up: the corruption regenerates fast enough to crash-loop indefinitely. Patching the
 * actual defect is the only fix that stops the loop rather than just reacting to it.
 *
 * Runs as an npm `postinstall` hook on the root package so the patch survives `npm
 * install`/`npm ci` there (the VPS, any future `npm ci`), and is also invoked explicitly
 * against every OTHER location that installs its own separate copy of gun:
 *   - platforms/desktop/.prod-deps-staging (scripts/stage-desktop-prod-deps.sh) — desktop
 *     (Windows/macOS) ships the unbundled dist/server tree and requires('gun') from here at
 *     real runtime, with IINPUBLIC_EMBEDDED_NODE=1 (real on-device radisk persistence) — so
 *     this copy is just as exposed to the corruption as the root copy.
 * The Android build does NOT need a separate call: its server code is esbuild-bundled from
 * the ROOT node_modules/gun straight into dist/embedded-mobile/server/node-app/embedded-node.js
 * (see scripts/build-embedded-mobile.js), so patching the root copy before that bundle step is
 * sufficient. platforms/mobile/nodejs-project's OWN node_modules/gun is a separate, unrelated
 * copy served as static browser assets only (public/worker.js's importScripts) to the
 * WebView's client-side Gun instance, which always runs radisk:false (browser origin) and
 * therefore never exercises the Radisk radix-tree code path this bug lives in — no patch
 * needed there.
 *
 * Idempotent: safe to run against an already-patched file (checks for the marker comment
 * first). Target defaults to node_modules/gun relative to the repo root; pass a directory as
 * argv[2] to instead resolve node_modules/gun under that directory (used for the desktop
 * staging dir, whose gun copy lives at <dir>/node_modules/gun).
 */
const fs = require('fs');
const path = require('path');

const targetRoot = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.resolve(__dirname, '..');
const TARGET = path.join(targetRoot, 'node_modules', 'gun', 'lib', 'radix.js');
const MARKER = 'IinPublic patch (scripts/patch-gun-radix.js)';

function main() {
  if (!fs.existsSync(TARGET)) {
    console.warn(`[patch-gun-radix] ${TARGET} not found — gun not installed yet? skipping.`);
    return;
  }
  let source = fs.readFileSync(TARGET, 'utf8');
  if (source.includes(MARKER)) {
    console.log('[patch-gun-radix] already applied, skipping.');
    return;
  }

  const writePathFind = `\t\t\tif(u === val){ return (u === (tmp = at['']))? at : ((radix.unit = 1) && tmp) } // temporary help??
\t\t\t\tat[''] = val;`;
  const writePathReplace = `\t\t\tif(u === val){ return (u === (tmp = at['']))? at : ((radix.unit = 1) && tmp) } // temporary help??
\t\t\t\t// ${MARKER}: a corrupted tree position can hold a raw primitive (observed: a bare HAM
\t\t\t\t// timestamp number) instead of an object, which throws "Cannot create property '' on
\t\t\t\t// number" on the plain assignment below and crashes the process. Self-heal by promoting
\t\t\t\t// it to a proper object first, preserving the old primitive as its own '' leaf value.
\t\t\t\tif(at && 'object' != typeof at){ at = t[k] = {'': at}; }
\t\t\t\tat[''] = val;`;

  const readPathFind = `\t\t\tif(!t){ return }
\t\t\tif('string' == typeof t){ if(Radix.debug){ throw ['BUG:', radix, cb, opt, pre] } return; }
\t\t\tvar keys = (t[_]||no).sort`;
  const readPathReplace = `\t\t\tif(!t){ return }
\t\t\tif('string' == typeof t){ if(Radix.debug){ throw ['BUG:', radix, cb, opt, pre] } return; }
\t\t\t// ${MARKER}: same corruption as the write-path patch above — a tree position can hold a
\t\t\t// raw primitive instead of an object. \`t[_] = ...\` below throws "Cannot create property
\t\t\t// '<ctrl>' on number" (a non-printable control char, invisible in logs) and crashes the
\t\t\t// process. A primitive here has no children to enumerate, so stop this branch instead.
\t\t\tif('object' != typeof t){ return }
\t\t\tvar keys = (t[_]||no).sort`;

  if (!source.includes(writePathFind)) {
    throw new Error(
      '[patch-gun-radix] write-path anchor text not found in radix.js — gun.js was likely ' +
        'updated and this patch needs to be re-derived against the new source before it can be ' +
        'safely applied. Failing the install rather than silently skipping a known crash fix.',
    );
  }
  if (!source.includes(readPathFind)) {
    throw new Error(
      '[patch-gun-radix] read-path anchor text not found in radix.js — gun.js was likely ' +
        'updated and this patch needs to be re-derived against the new source before it can be ' +
        'safely applied. Failing the install rather than silently skipping a known crash fix.',
    );
  }

  source = source.split(writePathFind).join(writePathReplace);
  source = source.split(readPathFind).join(readPathReplace);
  fs.writeFileSync(TARGET, source);
  console.log('[patch-gun-radix] applied write-path and read-path fixes to', TARGET);
}

main();
