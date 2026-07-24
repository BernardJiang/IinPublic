/**
 * Dev libp2p circuit-relay-v2 for local content-node (IPFS) peering.
 *
 * Browser IPFS nodes can't accept inbound connections and, in dev, can't reach the public
 * libp2p relays (the `*.libp2p.direct` dials all fail). This tiny relay gives both browsers a
 * reachable rendezvous: each dials it over WebSocket, gets a reservation, and then connects to
 * the other browser via WebRTC — so shared media flows P2P and content-addressed (no central
 * content server; the relay only brokers the connection, like STUN/TURN for WebRTC).
 *
 * A DETERMINISTIC key gives a stable peerId, so the dial multiaddr is a fixed string the web
 * bundle can default to (IINPUBLIC_P2P_BOOTSTRAP_PEERS). Run: `node scripts/dev-libp2p-relay.mjs`.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createLibp2p } from 'libp2p';
import { webSockets } from '@libp2p/websockets';
import { noise } from '@chainsafe/libp2p-noise';
import { yamux } from '@chainsafe/libp2p-yamux';
import { identify } from '@libp2p/identify';
import { circuitRelayServer } from '@libp2p/circuit-relay-v2';
import { generateKeyPairFromSeed } from '@libp2p/crypto/keys';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WS_PORT = Number(process.env.IINPUBLIC_RELAY_WS_PORT || 4444);
// Fixed 32-byte seed → deterministic Ed25519 key → stable peerId → stable dial multiaddr.
const seed = new Uint8Array(32);
for (let i = 0; i < seed.length; i += 1) seed[i] = (i * 7 + 3) & 0xff;
const privateKey = await generateKeyPairFromSeed('Ed25519', seed);

// Serve secure WebSocket (wss) with the dev cert so https dev:multi pages can dial it without
// mixed-content blocking; plain ws is fine for http (e2e) pages.
const keyPath = process.env.TLS_KEY_PATH || path.resolve(__dirname, '../certs/dev-key.pem');
const certPath = process.env.TLS_CERT_PATH || path.resolve(__dirname, '../certs/dev-cert.pem');
const hasCert = fs.existsSync(keyPath) && fs.existsSync(certPath);
const listen = hasCert
  ? [`/ip4/0.0.0.0/tcp/${WS_PORT}/tls/ws`]
  : [`/ip4/0.0.0.0/tcp/${WS_PORT}/ws`];
const wsInit = hasCert
  ? { https: { key: fs.readFileSync(keyPath), cert: fs.readFileSync(certPath) } }
  : {};

const relay = await createLibp2p({
  privateKey,
  addresses: { listen },
  transports: [webSockets(wsInit)],
  connectionEncrypters: [noise()],
  streamMuxers: [yamux()],
  services: {
    identify: identify(),
    relay: circuitRelayServer({
      reservations: { maxReservations: Infinity, defaultDurationLimit: 10 * 60 * 1000 },
    }),
  },
});

const peerId = relay.peerId.toString();
const scheme = hasCert ? 'tls/ws' : 'ws';
console.log(`🛰  dev libp2p relay listening (peerId ${peerId}, ${hasCert ? 'wss' : 'ws'})`);
for (const ma of relay.getMultiaddrs()) console.log('   ', ma.toString());
// The address a browser on the same host should dial (set as IINPUBLIC_P2P_BOOTSTRAP_PEERS):
console.log(`   dial: /ip4/127.0.0.1/tcp/${WS_PORT}/${scheme}/p2p/${peerId}`);

const shutdown = async () => { await relay.stop().catch(() => {}); process.exit(0); };
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
