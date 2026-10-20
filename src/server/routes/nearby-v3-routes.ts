import type express from 'express';
import { CONFIG } from '../../shared/config';
import { nearbyV3ConfigFromManifest, type NearbyV3Config } from '../../shared/nearby-v3-config';
import { BUNDLED_PROTOCOL_MANIFEST_HISTORY } from '../../shared/production-protocol-manifest';
import { parseMapBounds } from '../../shared/map-dots';
import { NearbyV3Hub } from '../services/nearby-v3-hub';
import { NEARBY_KNOCK_MAX_WAIT_MS, type NearbyKnockMailbox } from '../services/nearby-knock-mailbox';

/**
 * Nearby v3 hub endpoints (§3.7): card heartbeats, a newcomer's introductions, statistics, and the
 * knock mailbox.
 * A phone's embedded node has no hub state of its own and forwards these to the hub (`relay`).
 */
export function hubNearbyV3Config(): NearbyV3Config {
  const latest = BUNDLED_PROTOCOL_MANIFEST_HISTORY.at(-1)?.body;
  return nearbyV3ConfigFromManifest({
    // CONFIG.CHATROOM_MAX_CAPACITY is the manifest's C, or an E2E/local override.
    chatroomCapacity: CONFIG.CHATROOM_MAX_CAPACITY,
    ...(latest?.extensions ? { extensions: latest.extensions } : {}),
  });
}

export function registerNearbyV3Routes(
  app: express.Application,
  deps: {
    hub: NearbyV3Hub;
    knocks: NearbyKnockMailbox;
    /** Forwards to the hub; returns false when this server is the hub. */
    relay: (res: express.Response, path: string, method: 'GET' | 'POST', body?: unknown, timeoutMs?: number) => Promise<boolean>;
  },
): void {
  const { hub, knocks, relay } = deps;

  app.post('/api/nearby/v3/knocks', async (req, res) => {
    if (await relay(res, '/api/nearby/v3/knocks', 'POST', req.body || {})) return;
    try {
      await knocks.post(req.body?.knock);
      res.json({ accepted: true });
    } catch (error) {
      res.status(400).json({ error: (error as Error).message });
    }
  });

  // A long poll: answers as soon as a knock for this channel arrives, or empty after `waitMs`.
  app.get('/api/nearby/v3/knocks/:channel', async (req, res) => {
    const channel = String(req.params.channel || '');
    if (!/^[0-9a-f]{64}$/.test(channel)) {
      res.status(400).json({ error: 'channel must be a knock channel' });
      return;
    }
    const cursor = Math.max(0, Math.floor(Number(req.query.after) || 0));
    const waitMs = Math.max(0, Math.min(NEARBY_KNOCK_MAX_WAIT_MS, Math.floor(Number(req.query.waitMs) || 0)));
    const path = `/api/nearby/v3/knocks/${channel}?after=${cursor}&waitMs=${waitMs}`;
    if (await relay(res, path, 'GET', undefined, waitMs + 5_000)) return;
    res.json(await knocks.read(channel, cursor, waitMs));
  });

  app.post('/api/nearby/v3/card', async (req, res) => {
    if (await relay(res, '/api/nearby/v3/card', 'POST', req.body || {})) return;
    try {
      res.json(await hub.heartbeat(req.body?.card));
    } catch (error) {
      res.status(400).json({ error: (error as Error).message });
    }
  });

  app.post('/api/nearby/v3/introductions', async (req, res) => {
    if (await relay(res, '/api/nearby/v3/introductions', 'POST', req.body || {})) return;
    const point = req.body?.point;
    const latitude = Number(point?.latitude);
    const longitude = Number(point?.longitude);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) {
      res.status(400).json({ error: 'point.latitude and point.longitude are required' });
      return;
    }
    const scope = typeof req.body?.scope === 'string' ? req.body.scope : 'nearby';
    const excludePub = typeof req.body?.excludePub === 'string' ? req.body.excludePub : undefined;
    res.json(hub.introductions({ point: { latitude, longitude }, scope, ...(excludePub ? { excludePub } : {}) }));
  });

  app.get('/api/nearby/v3/stats', async (req, res) => {
    const query = req.query as Record<string, unknown>;
    const bounds = parseMapBounds(query);
    const passthrough = bounds
      ? `?${new URLSearchParams(Object.entries(bounds).map(([key, value]) => [key, String(value)]))}`
      : '';
    if (await relay(res, `/api/nearby/v3/stats${passthrough}`, 'GET')) return;
    res.json(hub.stats(bounds ?? undefined));
  });
}
