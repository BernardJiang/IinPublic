import type express from 'express';
import { generateTurnCredentials } from '../services/turn-credentials';

/**
 * GET /api/turn-credentials — mints short-lived TURN credentials for the client's
 * RTCPeerConnection ICE server list (see src/web/services/p2p-webrtc-session.ts's
 * resolveIceServers). Returns `{ urls: [] }` when no TURN server is configured
 * (TURN_SHARED_SECRET/TURN_SERVER_HOST unset) — the client falls back to STUN-only, matching
 * today's behavior everywhere this hasn't been deployed (dev, CI, any relay without a TURN
 * server set up).
 */
export function registerTurnRoutes(app: express.Application): void {
  app.get('/api/turn-credentials', (_req, res) => {
    const secret = process.env.TURN_SHARED_SECRET;
    const host = process.env.TURN_SERVER_HOST;
    if (!secret || !host) {
      res.json({ urls: [] });
      return;
    }
    const port = process.env.TURN_SERVER_PORT || '3478';
    const urls = [`turn:${host}:${port}?transport=udp`, `turn:${host}:${port}?transport=tcp`];
    res.json(generateTurnCredentials({ secret, urls }));
  });
}
