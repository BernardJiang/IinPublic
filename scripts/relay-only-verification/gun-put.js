#!/usr/bin/env node
/**
 * One-shot Gun client: connects to a single peer URL, writes a value at the
 * given graph path, waits for the local put to settle, then exits.
 *
 * Run as its own process (not required into another process) because Gun.js
 * keeps significant global/module state and multiple Gun() instances inside
 * one Node process are unreliable.
 *
 * Usage: node gun-put.js <peerUrl> <pathPartsJson> <valueJson>
 */
const Gun = require('gun');

const [, , peerUrl, pathPartsJson, valueJson] = process.argv;
if (!peerUrl || !pathPartsJson || !valueJson) {
  console.error('usage: node gun-put.js <peerUrl> <pathPartsJson> <valueJson>');
  process.exit(2);
}

const pathParts = JSON.parse(pathPartsJson);
const value = JSON.parse(valueJson);

const gun = Gun({ peers: [peerUrl], radisk: false, localStorage: false, axe: false, multicast: false });

let node = gun;
for (const part of pathParts) node = node.get(part);

// NOTE: in relay-only / axe:false configurations, Gun's put ack callback may
// never fire (no peer-exchange handshake to ack against). We don't treat a
// missing ack as failure — the local graph merge happens synchronously
// regardless of ack/peer state. We just hold the process open long enough for
// the wire to flush the put to the connected peer socket before exiting.
let acked = false;
node.put(value, (ack) => {
  acked = true;
  if (ack && ack.err) {
    console.error(JSON.stringify({ ok: false, err: ack.err }));
  }
});

setTimeout(() => {
  console.log(JSON.stringify({ ok: true, acked }));
  process.exit(0);
}, 3000);
