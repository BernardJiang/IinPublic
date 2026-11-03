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
 *   - platforms/desktop/.prod-deps-staging (scripts/stage-desktop-prod-deps.mjs) — desktop
 *     (Windows/macOS) ships the unbundled dist/server tree and requires('gun') from here at
 *     real runtime, with IINPUBLIC_EMBEDDED_NODE=1 (real on-device radisk persistence) — so
 *     this copy is just as exposed to the corruption as the root copy.
 *   - platforms/mobile/nodejs-project — the Android/iOS embedded Node. Since 2026-09-23
 *     `gun`/`gun/sea` are left OUT of the esbuild bundle (scripts/build-embedded-mobile.js) and
 *     the phone's Node requires them from this copy, so it needs the patch too. The android:*
 *     build scripts in package.json patch it right after its `npm install` (found 2026-11-02:
 *     phones up to 1.0.217 ran this copy unpatched). The same copy is also served to the core
 *     worker (importScripts), which runs Radisk over IndexedDB without yson.
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

/**
 * Root cause of the corruption above (found 2026-11-02): on Node, radisk.js loads Gun's own
 * time-sliced JSON (lib/yson.js) and uses JSON.parseAsync to read every storage file.
 * yson's parser loses its place when it pauses mid-object: e.g. a stored link
 * `{"":{":":{"#":"ev/1"},">":1793…}}` comes back as `{"":{"#":"ev/1",">":1793…}}`, another
 * entry lands under the key `""`, and a state key comes back as `"undefined"`. Radisk then
 * writes the damaged tree back to disk. Gun's merge loop stops at the first entry with no
 * state, so every later field of that node is dropped on each read (a 10,000-entry list read
 * back as 2,539). Measured: 6 of 8,000 entries were damaged by one parse of an ~0.75 MB file.
 * Fix: radisk uses the plain synchronous JSON.parse/stringify (what it already does in browsers,
 * where yson is not loaded). A 1 MB file (opt.chunk) parses in a few milliseconds.
 */
const RADISK_TARGET = path.join(targetRoot, 'node_modules', 'gun', 'lib', 'radisk.js');
const RADISK_MARKER = 'IinPublic patch (scripts/patch-gun-radix.js): sync JSON';

function patchRadiskJson() {
  if (!fs.existsSync(RADISK_TARGET)) {
    console.warn(`[patch-gun-radix] ${RADISK_TARGET} not found — gun not installed yet? skipping.`);
    return;
  }
  let source = fs.readFileSync(RADISK_TARGET, 'utf8');
  if (source.includes(RADISK_MARKER)) {
    console.log('[patch-gun-radix] radisk sync JSON already applied, skipping.');
    return;
  }
  const find = `\t\tvar parse = JSON.parseAsync || function(t,cb,r){ var u; try{ cb(u, JSON.parse(t,r)) }catch(e){ cb(e) } }
\t\tvar json = JSON.stringifyAsync || function(v,cb,r,s){ var u; try{ cb(u, JSON.stringify(v,r,s)) }catch(e){ cb(e) } }`;
  const replace = `\t\t// ${RADISK_MARKER} — yson's JSON.parseAsync corrupts nested objects when it pauses
\t\t// mid-object, and radisk writes the damage back to disk. Always use the synchronous JSON.
\t\tvar parse = function(t,cb,r){ var u; try{ cb(u, JSON.parse(t,r)) }catch(e){ cb(e) } }
\t\tvar json = function(v,cb,r,s){ var u; try{ cb(u, JSON.stringify(v,r,s)) }catch(e){ cb(e) } }`;
  if (!source.includes(find)) {
    throw new Error(
      '[patch-gun-radix] radisk.js JSON anchor text not found — gun.js was likely updated and ' +
        'this patch needs to be re-derived against the new source. Failing the install rather ' +
        'than silently skipping a known data-loss fix.',
    );
  }
  source = source.split(find).join(replace);
  fs.writeFileSync(RADISK_TARGET, source);
  console.log('[patch-gun-radix] applied radisk sync JSON fix to', RADISK_TARGET);
}

main();
patchRadiskJson();
