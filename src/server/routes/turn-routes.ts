import type express from 'express';
import { generateTurnCredentials } from '../services/turn-credentials';
import type { EmbeddedHubRelayClientLike } from '../../node-app/embedded-hub-relay-client';

export type RegisterTurnRoutesDeps = {
  hubRelayClient?: EmbeddedHubRelayClientLike;
};

/**
 * GET /api/turn-credentials — mints short-lived TURN credentials for the client's
 * RTCPeerConnection ICE server list (see src/web/services/p2p-webrtc-session.ts's
 * resolveIceServers). Returns `{ urls: [] }` when no TURN server is configured
 * (TURN_SHARED_SECRET/TURN_SERVER_HOST unset) and there is no hub to forward to — the client
 * falls back to STUN-only, matching today's behavior everywhere this hasn't been deployed (dev,
 * CI, any relay without a TURN server set up).
 *
 * On an embedded mobile node, the client's own apiBase resolves to its local loopback server
 * (see deriveBackendApiBaseFromLocation in web-gun-service.ts), which never has
 * TURN_SHARED_SECRET/TURN_SERVER_HOST set — those are VPS-only systemd env vars, and baking the
 * shared secret into every distributed APK would turn it into a leaked-by-default open relay
 * credential. So instead this route forwards to the hub over the same hubRelayClient already used
 * for signaling/chatroom membership (src/node-app/embedded-hub-relay-client.ts), which mints the
 * credential server-side on the VPS and returns it to the phone.
 */
export function registerTurnRoutes(app: express.Application, deps: RegisterTurnRoutesDeps = {}): void {
  const { hubRelayClient } = deps;
  app.get('/api/turn-credentials', async (_req, res) => {
    const secret = process.env.TURN_SHARED_SECRET;
    const host = process.env.TURN_SERVER_HOST;
    if (secret && host) {
      const port = process.env.TURN_SERVER_PORT || '3478';
      const urls = [`turn:${host}:${port}?transport=udp`, `turn:${host}:${port}?transport=tcp`];
      res.json(generateTurnCredentials({ secret, urls }));
      return;
    }
    if (hubRelayClient) {
      try {
        res.json(await hubRelayClient.getTurnCredentials());
        return;
      } catch {
        // Hub unreachable (offline embedded node) — fall through to STUN-only.
      }
    }
    res.json({ urls: [] });
  });
}
