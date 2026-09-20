import type express from 'express';
import type { GunService } from '../services/gun-service';
import type { EmbeddedHubRelayClientLike } from '../../node-app/embedded-hub-relay-client';

/**
 * See src/web/services/graph-relay-client.ts's doc comment for why this exists: an embedded
 * node's local Gun graph does not generically peer with the public hub, so a new Gun path is
 * invisible to a real Android/iOS/Electron device from another peer until it gets this same
 * explicit HTTP relay treatment every other cross-device path already has
 * (system-routes.ts's support-message/delegate-request/mailbox handlers).
 *
 * Deliberately generic (one route pair, not one bespoke endpoint per feature): every path here
 * is the identical shape — an opaque, already-signed-or-encrypted JSON blob at a short Gun path
 * — so there is no per-feature validation to add. `gunService` is this process's OWN Gun
 * instance: for the full production server that's the same graph a browser peer already reads
 * and writes over the Gun wire protocol directly (this route is just an HTTP door into the exact
 * same data, not a second copy); for an embedded node it's that device's on-device graph, with
 * `hubRelayClient` (present only in embedded builds) bridging to the real upstream hub.
 */
const ALLOWED_RELAY_ROOTS = new Set([
  'identity-link-requests',
  'identity-links',
  'identity-link-revocations',
  'device-sync-authorization',
  'device-sync-epub',
  'device-sync-envelope',
  'device-sync-ack',
  'identity-epub',
  'handoff',
  'handoff-ack',
]);

export type RegisterGraphRelayRoutesDeps = {
  gunService: GunService;
  hubRelayClient?: EmbeddedHubRelayClientLike;
};

function parseAllowedSegments(rest: unknown): string[] | null {
  const segments = String(rest || '').split('/').map((segment) => segment.trim()).filter(Boolean);
  if (segments.length < 2 || segments.length > 3) return null;
  if (!ALLOWED_RELAY_ROOTS.has(segments[0])) return null;
  return segments;
}

export function registerGraphRelayRoutes(
  app: express.Application,
  { gunService, hubRelayClient }: RegisterGraphRelayRoutesDeps,
): void {
  app.get('/api/relay/graph/*', async (req, res) => {
    const segments = parseAllowedSegments((req.params as Record<string, unknown>)[0]);
    if (!segments) {
      res.status(400).json({ error: 'unsupported relay path' });
      return;
    }
    let data = await gunService.getPath(segments).catch(() => undefined);
    if ((data === undefined || data === null) && hubRelayClient) {
      data = await hubRelayClient.getGraphBlob(segments).catch(() => null);
    }
    res.json({ data: data ?? null });
  });

  app.put('/api/relay/graph/*', async (req, res) => {
    const segments = parseAllowedSegments((req.params as Record<string, unknown>)[0]);
    if (!segments) {
      res.status(400).json({ error: 'unsupported relay path' });
      return;
    }
    const data = (req.body || {}).data ?? null;
    await gunService.putPath(segments, data).catch(() => undefined);
    if (hubRelayClient) await hubRelayClient.putGraphBlob(segments, data).catch(() => undefined);
    res.json({ ok: true });
  });
}
