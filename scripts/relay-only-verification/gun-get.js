#!/usr/bin/env node
/**
 * One-shot Gun client: connects to a single peer URL, reads a graph path with
 * `.once()` (bounded by a deadline), and prints whether the value was found.
 *
 * Run as its own process for the same reason as gun-put.js.
 *
 * Usage: node gun-get.js <peerUrl> <pathPartsJson> [timeoutMs]
 */
const Gun = require('gun');

const [, , peerUrl, pathPartsJson, timeoutMsRaw] = process.argv;
if (!peerUrl || !pathPartsJson) {
  console.error('usage: node gun-get.js <peerUrl> <pathPartsJson> [timeoutMs]');
  process.exit(2);
}

const pathParts = JSON.parse(pathPartsJson);
const timeoutMs = timeoutMsRaw ? parseInt(timeoutMsRaw, 10) : 4000;

const gun = Gun({ peers: [peerUrl], radisk: false, localStorage: false, axe: false, multicast: false });

let node = gun;
for (const part of pathParts) node = node.get(part);

// IMPORTANT: Gun's `.once()` callback can fire immediately with `undefined`
// before a network round-trip to peers completes — it does not guarantee a
// confirmed "no data anywhere" result. We instead use `.on()` and observe for
// the full window, keeping the last non-undefined value seen (if any), which
// correctly captures data that arrives moments after the initial empty fire.
let bestFound = false;
let bestValue = null;
let callbackCount = 0;

const off = node.on((data) => {
  callbackCount += 1;
  if (data !== undefined && data !== null) {
    bestFound = true;
    bestValue = data;
  }
});

setTimeout(() => {
  try { off && off.off && off.off(); } catch { /* ignore */ }
  console.log(JSON.stringify({ found: bestFound, value: bestValue, callbackCount }));
  process.exit(0);
}, timeoutMs);
