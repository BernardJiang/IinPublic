#!/usr/bin/env node

const port = Number(process.argv[2] || '8080');
const p2pNodeEnabled = process.argv[3] === '1' ? '1' : '0';

if (!Number.isInteger(port) || port <= 0 || port > 65535) {
  throw new Error(`Expected a valid Gun server port; received ${process.argv[2]}`);
}

Object.assign(process.env, {
  CHATROOM_MAX_CAPACITY: '50',
  CHATROOM_ENABLE_FIFO: 'false',
  E2E_GUN_MEMORY_ONLY: '1',
  P2P_NODE_ENABLED: p2pNodeEnabled,
  P2P_RATE_LIMIT_MAX_EVENTS: '5000',
  NODE_OPTIONS: process.env.NODE_OPTIONS || '--max-old-space-size=8192',
  PORT: String(port),
});

// index.ts deliberately auto-starts only when it is the CommonJS entry point. This ESM
// wrapper imports it, so instantiate explicitly; the double `.default` handles Node's ESM
// interop around TypeScript's CommonJS default export.
const loaded = await import('../dist/server/server/index.js');
const IinPublicServer = loaded.default?.default || loaded.default;
if (typeof IinPublicServer !== 'function') {
  throw new Error('Compiled IinPublicServer constructor was not exported');
}
const server = new IinPublicServer();
server.start(port);
