import fs from 'fs';
import path from 'path';
import type express from 'express';
import { logger } from '../logger';
import { clearExactChatbotMemoryCacheForTesting } from '../exact-chatbot-memory-store';
import type { GunService } from '../services/gun-service';
import {
  applyP2PNeighborCacheAction,
  applyLocalNodeAction,
  createConversationTransportDiagnostics,
  createDataMigrationPlan,
  createDataOwnershipPolicy,
  createDataOwnershipRequest,
  createDeviceLocalDataDeletion,
  createP2PNeighborCacheState,
  createP2PNodeProtocolSpec,
  createRelayOnlyTtlPolicy,
  createTransportDiagnosticEvent,
  createDirectP2PMessageEnvelope,
  createLocalNodeSupervisorSnapshot,
  p2pRelaySigningPayload,
  verifySignedP2PEnvelopeProof,
  getP2PBootstrapCandidates,
  upsertP2PNeighbor,
  resolveP2PRuntimeFlags,
  scanRelayStorageForSeaLeaks,
  SEA_IDENTITY_POLICY,
  STAR_GUN_PATH_CLASSIFICATIONS,
  type P2PNeighborCacheAction,
  type P2PNeighborCacheState,
  type P2PNeighborEndpointStatus,
  type P2PNeighborTransportType,
  type P2PNeighborTrustStatus,
  type P2PNodeCapability,
  type DataOwnershipRequest,
  type DataOwnershipRequestType,
  type DeviceLocalDataDeletion,
  type TransportDiagnosticEvent,
  type LocalNodeAction,
  type LocalNodeSupervisorSnapshot,
  type DirectP2PMessageEnvelope,
} from '../../shared/p2p-runtime';
import {
  createPeerAckMessage,
  createPresenceRecord,
  listNearbyPresence,
  prunePresenceRecords,
  verifySignedPeerAckMessage,
  type PeerAckMessage,
  type PresenceRecord,
} from '../../shared/p2p-presence';
import { TechSupportMessageStore } from '../services/techsupport-message-store';
import { BoundedNonceCache, P2PAbuseDefenseContext } from '../../shared/p2p-abuse-defense';

/** Gun radisk default directory (see node_modules/gun/lib/radisk.js). */
function clearRadiskOnDisk(): string[] {
  const root = process.cwd();
  const removed: string[] = [];
  let names: string[];
  try {
    names = fs.readdirSync(root);
  } catch {
    return removed;
  }
  for (const name of names) {
    const isRadiskDir = name === 'radata' || /^radata_w\d+$/.test(name);
    const isGunJson = name === 'data.json' || name === 'data.json.tmp';
    if (!isRadiskDir && !isGunJson) continue;
    const target = path.join(root, name);
    fs.rmSync(target, { recursive: true, force: true });
    if (isRadiskDir) fs.mkdirSync(target, { recursive: true });
    removed.push(name);
  }
  return removed;
}

export type E2eServerSnapshot = {
  version: 1;
  gunGraph: Record<string, unknown>;
};

type RegisterSystemRoutesDeps = {
  gun: any;
  gunService?: GunService;
  /** P0 step 7: clear broadcastTagPopularityStore + mailboxStore for testing. */
  clearForTesting?: () => void;
  /** Recreate public bootstrap data after the test-only graph reset. */
  onClearDatabase?: () => void | Promise<void>;
  nodeEnv: string | undefined;
  /** P2P-V: optional override for abuse defense config (useful in integration tests). */
  abuseDefenseConfig?: import('../../shared/p2p-abuse-defense').AbuseDefenseConfig;
};

export function registerSystemRoutes(
  app: express.Application,
  {
    gun,
    gunService,
    clearForTesting,
    onClearDatabase,
    nodeEnv,
    abuseDefenseConfig,
  }: RegisterSystemRoutesDeps,
): void {
  let localNodeSupervisor: LocalNodeSupervisorSnapshot = createLocalNodeSupervisorSnapshot();
  let neighborCache: P2PNeighborCacheState = createP2PNeighborCacheState();
  let deviceLocalDataDeletion: DeviceLocalDataDeletion = {
    deletedAt: null,
    clearedDataClasses: [],
    retainedServerHeldRequestUrl: '/api/p2p/data-ownership/request-server-data',
  };
  const dataOwnershipRequests: DataOwnershipRequest[] = [];
  const transportDiagnostics: TransportDiagnosticEvent[] = [];
  const relayByConversation = new Map<string, DirectP2PMessageEnvelope[]>();
  const presenceByUserId = new Map<string, PresenceRecord>();
  const peerAckInbox = new Map<string, PeerAckMessage[]>();
  const peerAckNonces = new BoundedNonceCache();
  const relayNonces = new BoundedNonceCache();
  // P2P-V: shared abuse-defense context for all relay POST routes.
  // When no explicit config is injected, allow env overrides so parallel E2E runs
  // (many browsers × ICE/signaling POSTs per minute sharing one per-peer budget)
  // can raise the per-peer rate cap without touching production defaults.
  const envRateLimitMaxEvents = Number(process.env.P2P_RATE_LIMIT_MAX_EVENTS);
  const envRateLimitWindowMs = Number(process.env.P2P_RATE_LIMIT_WINDOW_MS);
  const abuseCtx = new P2PAbuseDefenseContext(
    abuseDefenseConfig ?? {
      ...(Number.isFinite(envRateLimitMaxEvents) && envRateLimitMaxEvents > 0
        ? { rateLimitMaxEvents: Math.floor(envRateLimitMaxEvents) }
        : {}),
      ...(Number.isFinite(envRateLimitWindowMs) && envRateLimitWindowMs > 0
        ? { rateLimitWindowMs: Math.floor(envRateLimitWindowMs) }
        : {}),
    },
  );
  const techSupportMessages = new TechSupportMessageStore();

  const prunePresence = (now = new Date()): void => {
    prunePresenceRecords(presenceByUserId, now);
    for (const [toPub, inbox] of peerAckInbox) {
      const fresh = inbox.filter((ack) => new Date(ack.expiresAt).getTime() > now.getTime());
      if (fresh.length === 0) peerAckInbox.delete(toPub);
      else peerAckInbox.set(toPub, fresh);
    }
  };

  const pruneConversationRelay = (now = new Date()): void => {
    for (const [conversationId, envelopes] of relayByConversation) {
      const fresh = envelopes.filter((envelope) => new Date(envelope.expiresAt).getTime() > now.getTime());
      if (fresh.length === 0) relayByConversation.delete(conversationId);
      else relayByConversation.set(conversationId, fresh);
    }
  };

  // Health check
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  // Location privacy validation endpoint
  app.post('/api/validate-privacy', (_req, res) => {
    try {
      // This would validate that no high-precision location data is being sent
      res.json({ valid: true });
    } catch (error) {
      res.status(400).json({ error: (error as Error).message });
    }
  });

  // Relay hub APIs (production + dev) — presence, TechSupport store, P2P signaling
  app.post('/api/presence/register', (req, res) => {
    try {
      prunePresence();
      const body = req.body || {};
      const record = createPresenceRecord({
        userId: String(body.userId || ''),
        pub: String(body.pub || ''),
        ...(body.epub ? { epub: String(body.epub) } : {}),
        ...(body.encryptedLocation ? { encryptedLocation: String(body.encryptedLocation) } : {}),
        ...(Array.isArray(body.capabilities)
          ? { capabilities: body.capabilities.map(String) }
          : {}),
      });
      presenceByUserId.set(record.userId, record);
      res.json({ stored: true, record });
    } catch (error) {
      res.status(400).json({ error: (error as Error).message });
    }
  });

  app.get('/api/presence/nearby', (req, res) => {
    prunePresence();
    const limit = req.query.limit ? Number(req.query.limit) : 50;
    const nearbyOpts: { excludeUserId?: string; limit?: number } = { limit };
    if (req.query.excludeUserId) nearbyOpts.excludeUserId = String(req.query.excludeUserId);
    const peers = listNearbyPresence(presenceByUserId, nearbyOpts);
    res.json({ peers, count: peers.length });
  });

  app.post('/api/presence/ack', async (req, res) => {
    try {
      prunePresence();
      const body = req.body || {};
      const ackPeerId = String(body.fromPeerId || body.peerId || '');
      const ackPub = String(body.fromPub || '');
      const ackAbuseCheck = abuseCtx.checkInbound(ackPeerId || ackPub, ackPub);
      if (!ackAbuseCheck.allowed) {
        res.status(429).json({ error: ackAbuseCheck.reason });
        return;
      }
      const ack = createPeerAckMessage({
        fromUserId: String(body.fromUserId || ''),
        fromPub: String(body.fromPub || ''),
        toUserId: String(body.toUserId || ''),
        toPub: String(body.toPub || ''),
        fromPeerId: String(body.fromPeerId || body.peerId || ''),
        timestamp: String(body.timestamp || ''),
        payloadHash: String(body.payloadHash || ''),
        ...(body.nonce ? { nonce: String(body.nonce) } : {}),
        ...(body.signature ? { signature: String(body.signature) } : {}),
      });
      const validation = await verifySignedPeerAckMessage(ack, ack.toPub, new Date(), peerAckNonces);
      if (!validation.ok) {
        res.status(400).json({ error: validation.reason });
        return;
      }
      const inbox = peerAckInbox.get(ack.toPub) || [];
      peerAckInbox.set(ack.toPub, [...inbox, ack]);
      res.json(ack);
    } catch (error) {
      res.status(400).json({ error: (error as Error).message });
    }
  });

  app.get('/api/presence/ack', (req, res) => {
    prunePresence();
    const toPub = String(req.query.toPub || '');
    const inbox = (peerAckInbox.get(toPub) || []).filter(
      (ack) => !req.query.fromPub || ack.fromPub === String(req.query.fromPub),
    );
    res.json({ acknowledgements: inbox });
  });

  app.get('/api/support/messages/:conversationId', (req, res) => {
    const conversationId = String(req.params.conversationId || '');
    res.json({
      conversationId,
      messages: techSupportMessages.list(conversationId),
    });
  });

  app.post('/api/support/messages/:conversationId', (req, res) => {
    try {
      const conversationId = String(req.params.conversationId || '');
      if (!conversationId.startsWith('conv_support_')) {
        res.status(400).json({ error: 'Not a TechSupport conversation id' });
        return;
      }
      const body = req.body || {};
      const message = {
        id: String(body.id || `support_${Date.now()}`),
        conversationId,
        senderId: String(body.senderId || ''),
        text: String(body.text || ''),
        timestamp: String(body.timestamp || new Date().toISOString()),
        channel: String(body.channel || 'public'),
      };
      if (!message.senderId || !message.text) {
        res.status(400).json({ error: 'senderId and text are required' });
        return;
      }
      techSupportMessages.append(message);
      if (gunService) {
        void gunService.putPath(
          ['conversations', conversationId, 'messages', message.id],
          {
            id: message.id,
            senderId: message.senderId,
            text: message.text,
            timestamp: message.timestamp,
            channel: message.channel,
            transport: 'star-gun',
            supportMessage: true,
          },
          { supportChannel: true },
        );
      }
      res.json({ stored: true, message });
    } catch (error) {
      res.status(400).json({ error: (error as Error).message });
    }
  });

  app.get('/api/p2p/conversation-relay/:conversationId', (req, res) => {
    pruneConversationRelay();
    const conversationId = String(req.params.conversationId || '');
    const recipientPub = String(req.query.recipientPub || '');
    const envelopes = (relayByConversation.get(conversationId) || []).filter(
      (envelope) => !recipientPub || envelope.recipientPub === recipientPub,
    );
    res.json({ conversationId, envelopes });
  });

  app.post('/api/p2p/conversation-relay/:conversationId', async (req, res) => {
    try {
      pruneConversationRelay();
      const conversationId = String(req.params.conversationId || '');
      const body = req.body || {};
      const messageId = String(body.messageId || '');
      const senderPub = String(body.senderPub || '');
      const recipientPub = body.recipientPub ? String(body.recipientPub) : undefined;
      const bodyCiphertext = String(body.bodyCiphertext || '');
      const relayPeerId = String(body.peerId || '');
      const relayAbuseCheck = abuseCtx.checkInbound(relayPeerId || senderPub, senderPub);
      if (!relayAbuseCheck.allowed) {
        res.status(429).json({ error: relayAbuseCheck.reason });
        return;
      }
      const verification = await verifySignedP2PEnvelopeProof({
        proof: {
          peerId: String(body.peerId || ''),
          pub: senderPub,
          timestamp: String(body.timestamp || ''),
          nonce: String(body.nonce || ''),
          payloadHash: String(body.payloadHash || ''),
          signature: String(body.signature || ''),
        },
        payload: p2pRelaySigningPayload({ conversationId, messageId, senderPub, ...(recipientPub ? { recipientPub } : {}), bodyCiphertext }),
        nonceCache: relayNonces,
      });
      if (!verification.ok) {
        res.status(400).json({ error: verification.reason });
        return;
      }
      const envelope = createDirectP2PMessageEnvelope({
        conversationId,
        messageId,
        peerId: String(body.peerId || ''),
        senderPub,
        ...(recipientPub ? { recipientPub } : {}),
        bodyCiphertext,
        timestamp: String(body.timestamp || ''),
        payloadHash: String(body.payloadHash || ''),
        signature: String(body.signature || ''),
        nonce: String(body.nonce || ''),
        expiresAt: String(body.expiresAt || new Date(Date.now() + 120_000).toISOString()),
      });
      const current = relayByConversation.get(conversationId) || [];
      relayByConversation.set(conversationId, [...current, envelope]);
      res.json({ stored: true, envelope });
    } catch (error) {
      res.status(400).json({ error: (error as Error).message });
    }
  });



  // Test-only endpoints (non-production only)
  if (nodeEnv !== 'production') {
    // P2P-V: abuse defense diagnostics (non-secret — no private keys or message bodies)
    app.get('/api/debug/p2p-abuse', (_req, res) => {
      res.json(abuseCtx.getDiagnostics());
    });

    // P2P-Z: relay-only hub status — confirms no radata/ persistence in relay mode
    app.get('/api/debug/relay-only-status', (_req, res) => {
      const flags = resolveP2PRuntimeFlags(process.env);
      res.json({
        relayOnlyHub: flags.relayOnlyHub,
        starServerPersistence: flags.starServerPersistence,
        radiskEnabled: !flags.relayOnlyHub && flags.starServerPersistence !== 'ephemeral',
        inMemorySignaling: true,
        inMemoryRelay: true,
        inMemoryPresence: true,
        note: flags.relayOnlyHub
          ? 'Hub is relay-only: no application radata/ is used. All signaling, relay, and presence use in-memory TTL stores.'
          : 'Hub is in standard mode.',
      });
    });

    app.get('/api/debug/storage', (_req, res) => {
      try {
        if (!gun?._?.graph) {
          res.status(500).json({ error: 'Gun.js graph not accessible' });
          return;
        }
        const graph = gun._.graph as Record<string, unknown>;
        const topLevelCounts: Record<string, number> = {};
        for (const soul of Object.keys(graph)) {
          const top = soul.split('/')[0] || soul.split('#')[0] || soul;
          if (!top || top === '_') continue;
          topLevelCounts[top] = (topLevelCounts[top] || 0) + 1;
        }
        const seaStorageScan = scanRelayStorageForSeaLeaks(graph);
        res.json({
          mode: 'star',
          topology: {
            browser: 'Gun client',
            hub: 'Node Gun hub',
            routes: 'HTTP/Socket API',
          },
          flags: resolveP2PRuntimeFlags(process.env),
          relayOnlyHub: resolveP2PRuntimeFlags(process.env).relayOnlyHub,
          presenceLiveCount: presenceByUserId.size,
          localNode: localNodeSupervisor,
          neighborMemory: {
            ...neighborCache,
            bootstrapCandidates: getP2PBootstrapCandidates(neighborCache),
          },
          dataOwnership: {
            policy: createDataOwnershipPolicy(),
            localDeletion: deviceLocalDataDeletion,
            serverHeldRequests: dataOwnershipRequests,
            migrationPlan: createDataMigrationPlan(),
          },
          relayTtlPolicy: createRelayOnlyTtlPolicy(),
          transportDiagnostics,
          conversationTransport: createConversationTransportDiagnostics(resolveP2PRuntimeFlags(process.env)),
          p2pNetworkProtocol: createP2PNodeProtocolSpec(),
          seaIdentityPolicy: SEA_IDENTITY_POLICY,
          seaStorageScan,
          serverPersistence: {
            radisk: !!gun?._?.opt?.radisk,
            policy: resolveP2PRuntimeFlags(process.env).starServerPersistence,
            graphSouls: Object.keys(graph).length,
            topLevelCounts,
          },
          pathClassifications: STAR_GUN_PATH_CLASSIFICATIONS,
        });
      } catch (error) {
        logger.error({ err: error }, 'Error reading storage debug data');
        res.status(500).json({ error: (error as Error).message });
      }
    });


    app.get('/api/p2p/local-node', (_req, res) => {
      res.json(localNodeSupervisor);
    });

    app.post('/api/p2p/local-node/:action', (req, res) => {
      const action = req.params.action as LocalNodeAction;
      try {
        localNodeSupervisor = applyLocalNodeAction(localNodeSupervisor, action, new Date(), req.body);
        res.json(localNodeSupervisor);
      } catch (error) {
        res.status(400).json({ error: (error as Error).message });
      }
    });

    app.get('/api/p2p/neighbors', (_req, res) => {
      neighborCache = createP2PNeighborCacheState(neighborCache);
      res.json({
        ...neighborCache,
        bootstrapCandidates: getP2PBootstrapCandidates(neighborCache),
      });
    });

    app.post('/api/p2p/neighbors', (req, res) => {
      try {
        const body = req.body || {};
        neighborCache = upsertP2PNeighbor(neighborCache, {
          peerId: String(body.peerId || ''),
          endpointHints: Array.isArray(body.endpointHints) ? body.endpointHints.map(String) : [],
          lastSeenAt: String(body.lastSeenAt || new Date().toISOString()),
          successfulSessions: Number(body.successfulSessions || 0),
          latencyMs: Number(body.latencyMs || 0),
          transportType: (body.transportType || 'webrtc-datachannel') as P2PNeighborTransportType,
          capabilities: Array.isArray(body.capabilities) ? (body.capabilities as P2PNodeCapability[]) : [],
          trustStatus: (body.trustStatus || 'unknown') as P2PNeighborTrustStatus,
          endpointStatus: (body.endpointStatus || 'active') as P2PNeighborEndpointStatus,
          nearbyChatrooms: Array.isArray(body.nearbyChatrooms) ? body.nearbyChatrooms.map(String) : [],
          isContact: Boolean(body.isContact),
          ...(body.expiresAt ? { expiresAt: String(body.expiresAt) } : {}),
        });
        res.json({
          stored: true,
          ...neighborCache,
          bootstrapCandidates: getP2PBootstrapCandidates(neighborCache),
        });
      } catch (error) {
        res.status(400).json({ error: (error as Error).message });
      }
    });

    app.post('/api/p2p/neighbors/:action', (req, res) => {
      try {
        const action = req.params.action as P2PNeighborCacheAction;
        neighborCache = applyP2PNeighborCacheAction(neighborCache, action, req.body || {});
        res.json({
          ...neighborCache,
          bootstrapCandidates: getP2PBootstrapCandidates(neighborCache),
        });
      } catch (error) {
        res.status(400).json({ error: (error as Error).message });
      }
    });

    app.get('/api/p2p/data-ownership', (_req, res) => {
      res.json({
        policy: createDataOwnershipPolicy(),
        localDeletion: deviceLocalDataDeletion,
        serverHeldRequests: dataOwnershipRequests,
        migrationPlan: createDataMigrationPlan(),
        relayTtlPolicy: createRelayOnlyTtlPolicy(),
        transportDiagnostics,
      });
    });

    app.post('/api/p2p/data-ownership/delete-device-local', (_req, res) => {
      deviceLocalDataDeletion = createDeviceLocalDataDeletion();
      neighborCache = applyP2PNeighborCacheAction(neighborCache, 'clear');
      res.json({ localDeletion: deviceLocalDataDeletion, neighborMemory: neighborCache });
    });

    app.post('/api/p2p/data-ownership/request-server-data', (req, res) => {
      try {
        const body = req.body || {};
        const request = createDataOwnershipRequest(
          String(body.requestType || '') as DataOwnershipRequestType,
          String(body.userPub || ''),
        );
        dataOwnershipRequests.push(request);
        res.json({ request, requests: dataOwnershipRequests });
      } catch (error) {
        res.status(400).json({ error: (error as Error).message });
      }
    });

    app.post('/api/p2p/data-ownership/migrate', (req, res) => {
      const body = req.body || {};
      const paths = Array.isArray(body.paths) ? body.paths : undefined;
      res.json({ migrationPlan: createDataMigrationPlan(paths) });
    });

    app.get('/api/p2p/relay-ttl-policy', (_req, res) => {
      res.json(createRelayOnlyTtlPolicy());
    });

    app.post('/api/p2p/transport-diagnostics', (req, res) => {
      const body = req.body || {};
      const event = createTransportDiagnosticEvent(
        String(body.mode || 'star-gun') as TransportDiagnosticEvent['mode'],
        body.fallbackReason ? String(body.fallbackReason) : null,
      );
      transportDiagnostics.push(event);
      res.json({ event, events: transportDiagnostics });
    });

    app.get('/api/p2p/transport-diagnostics', (_req, res) => {
      res.json({ events: transportDiagnostics });
    });

    app.post('/api/test/clear-database', async (_req, res) => {
      try {
        // Clear Gun.js in-memory graph
        if (gun && gun._ && gun._.graph) {
          logger.info('Clearing Gun.js in-memory database...');
          gun._.graph = {};
          if (gunService) clearExactChatbotMemoryCacheForTesting(gunService);
          clearForTesting?.();
          await onClearDatabase?.();
          const radiskDirs = clearRadiskOnDisk();
          logger.info({ radiskDirs }, 'Gun.js in-memory database cleared');
          res.json({
            success: true,
            message: 'Gun.js in-memory database cleared',
            radiskDirs,
          });
        } else {
          res.status(500).json({ error: 'Gun.js graph not accessible' });
        }
      } catch (error) {
        logger.error({ err: error }, 'Error clearing Gun.js database');
        res.status(500).json({ error: (error as Error).message });
      }
    });

    app.get('/api/test/export-snapshot', (_req, res) => {
      try {
        if (!gun?._?.graph) {
          res.status(500).json({ error: 'Gun.js graph not accessible' });
          return;
        }
        const snapshot: E2eServerSnapshot = {
          version: 1,
          gunGraph: { ...gun._.graph },
        };
        res.json(snapshot);
      } catch (error) {
        logger.error({ err: error }, 'Error exporting E2E snapshot');
        res.status(500).json({ error: (error as Error).message });
      }
    });

    app.post('/api/test/import-snapshot', async (req, res) => {
      try {
        const body = req.body as E2eServerSnapshot;
        if (!body || body.version !== 1 || !body.gunGraph) {
          res.status(400).json({ error: 'Invalid snapshot payload (expected version 1)' });
          return;
        }
        if (!gun?._?.graph) {
          res.status(500).json({ error: 'Gun.js graph not accessible' });
          return;
        }
        gun._.graph = { ...body.gunGraph };
        if (gunService) clearExactChatbotMemoryCacheForTesting(gunService);
        // Snapshot imports replace the whole graph, so restore server-owned public
        // bootstrap records (hierarchy and signed TechSupport identity) afterward.
        // Without this, the usual E2E root-baseline seed silently erased them.
        await onClearDatabase?.();
        logger.info('E2E snapshot imported');
        res.json({ success: true });
      } catch (error) {
        logger.error({ err: error }, 'Error importing E2E snapshot');
        res.status(500).json({ error: (error as Error).message });
      }
    });

    app.post('/api/test/shutdown-hub', (req, res) => {
      if (process.env.DISABLE_HMR !== 'true') {
        res.status(403).json({ error: 'shutdown-hub is only available in E2E mode' });
        return;
      }

      const requestedDelay = Number(req.body?.delayMs);
      const delayMs = Number.isFinite(requestedDelay) && requestedDelay >= 0
        ? Math.floor(requestedDelay)
        : 100;

      logger.warn({ delayMs }, 'E2E requested hub shutdown');
      res.status(202).json({ accepted: true, delayMs });

      const timer = setTimeout(() => {
        process.exit(0);
      }, delayMs);
      (timer as ReturnType<typeof setTimeout> & { unref?: () => void }).unref?.();
    });
  }
}
