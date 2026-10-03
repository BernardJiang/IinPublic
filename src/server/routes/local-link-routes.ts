import type express from 'express';
import { LocalLinkTurnRelay } from '../services/local-link-turn-relay';

/** Wi-Fi Direct group subnet (Android group owner is always 192.168.49.1). */
const GROUP_ADDRESS = /^192\.168\.49\.(\d{1,3})$/;

function isGroupAddress(value: unknown): value is string {
  const match = typeof value === 'string' ? GROUP_ADDRESS.exec(value) : null;
  return !!match && Number(match[1]) >= 1 && Number(match[1]) <= 254;
}

function isLoopbackRequest(req: express.Request): boolean {
  const address = req.socket.remoteAddress ?? '';
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';
}

/**
 * Embedded (on-device) node only: start/stop the loopback TURN relay that carries this device's
 * WebRTC traffic across a Wi-Fi Direct group (OPEN-36, `local-link-turn-relay.ts`). Registered only
 * when the server runs as a loopback-only embedded node, and every call must come from loopback —
 * the hub never exposes it.
 */
export function registerLocalLinkRoutes(app: express.Application): void {
  let relay: LocalLinkTurnRelay | null = null;

  app.post('/api/local-link/relay', async (req, res) => {
    if (!isLoopbackRequest(req)) return void res.status(403).json({ error: 'loopback only' });
    const relayAddress = (req.body as { relayAddress?: unknown } | undefined)?.relayAddress;
    if (!isGroupAddress(relayAddress)) return void res.status(400).json({ error: 'relayAddress must be a Wi-Fi Direct group address' });
    if (relay && relay.relayAddress !== relayAddress) { relay.stop(); relay = null; }
    try {
      relay ??= new LocalLinkTurnRelay(relayAddress);
      res.json(await relay.start());
    } catch (err) {
      relay?.stop();
      relay = null;
      res.status(503).json({ error: `relay unavailable: ${err instanceof Error ? err.message : String(err)}` });
    }
  });

  app.delete('/api/local-link/relay', (req, res) => {
    if (!isLoopbackRequest(req)) return void res.status(403).json({ error: 'loopback only' });
    relay?.stop();
    relay = null;
    res.json({ stopped: true });
  });
}
