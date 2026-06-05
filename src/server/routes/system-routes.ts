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
  createP2PDiscoveryMessage,
  createP2PNeighborCacheState,
  createP2PNodeProtocolSpec,
  createP2PSignalingEnvelope,
  createRelayOnlyTtlPolicy,
  createTransportDiagnosticEvent,
  createDirectP2PMessageEnvelope,
  createLocalNodeSupervisorSnapshot,
  p2pDiscoverySigningPayload,
  p2pRelaySigningPayload,
  p2pSignalingSigningPayload,
  verifySignedP2PEnvelopeProof,
  getP2PBootstrapCandidates,
  upsertP2PNeighbor,
  resolveP2PRuntimeFlags,
  usesDirectTalkDelivery,
  scanRelayStorageForSeaLeaks,
  SEA_IDENTITY_POLICY,
  STAR_GUN_PATH_CLASSIFICATIONS,
  type P2PSignalingEnvelope,
  type P2PSignalingKind,
  type P2PDiscoveryMessage,
  type P2PNeighborCacheAction,
  type P2PNeighborCacheState,
  type P2PNeighborEndpointStatus,
  type P2PNeighborTransportType,
  type P2PNeighborTrustStatus,
  type P2PNodeCapability,
  type P2PPlatformId,
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
  incomingTalks: Record<string, Record<string, unknown>>;
  conversations: Record<string, Record<string, unknown>>;
  talkResponses: Record<string, unknown[]>;
  statsIdx: {
    byDay: Record<string, string[]>;
    byRegion: Record<string, string[]>;
    byTalkAnswer: Record<string, string[]>;
  };
};

function mapOfMapsToObject(m: Map<string, Map<string, any>>): Record<string, Record<string, unknown>> {
  const out: Record<string, Record<string, unknown>> = {};
  for (const [k, inner] of m) {
    out[k] = Object.fromEntries(inner);
  }
  return out;
}

function statsIdxToObject(statsIdx: {
  byDay: Map<string, Set<string>>;
  byRegion: Map<string, Set<string>>;
  byTalkAnswer: Map<string, Set<string>>;
}): E2eServerSnapshot['statsIdx'] {
  const sets = (s: Map<string, Set<string>>) =>
    Object.fromEntries([...s.entries()].map(([k, v]) => [k, [...v]]));
  return {
    byDay: sets(statsIdx.byDay),
    byRegion: sets(statsIdx.byRegion),
    byTalkAnswer: sets(statsIdx.byTalkAnswer),
  };
}

function statsIdxFromObject(raw: E2eServerSnapshot['statsIdx']): {
  byDay: Map<string, Set<string>>;
  byRegion: Map<string, Set<string>>;
  byTalkAnswer: Map<string, Set<string>>;
} {
  const from = (o: Record<string, string[]>) => {
    const m = new Map<string, Set<string>>();
    for (const [k, arr] of Object.entries(o || {})) {
      m.set(k, new Set(arr));
    }
    return m;
  };
  return {
    byDay: from(raw?.byDay || {}),
    byRegion: from(raw?.byRegion || {}),
    byTalkAnswer: from(raw?.byTalkAnswer || {}),
  };
}

type RegisterSystemRoutesDeps = {
  gun: any;
  gunService?: GunService;
  incomingTalksMap: Map<string, Map<string, any>>;
  conversationsMap: Map<string, Map<string, any>>;
  talkResponsesMap: Map<string, unknown[]>;
  statsIdx: {
    byDay: Map<string, Set<string>>;
    byRegion: Map<string, Set<string>>;
    byTalkAnswer: Map<string, Set<string>>;
  };
  clearTalkResponseStats: () => void;
  onClearDatabase?: () => void;
  nodeEnv: string | undefined;
};

export function registerSystemRoutes(
  app: express.Application,
  {
    gun,
    gunService,
    incomingTalksMap,
    conversationsMap,
    talkResponsesMap,
    statsIdx,
    clearTalkResponseStats,
    onClearDatabase,
    nodeEnv,
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
  const signalingByConversation = new Map<string, P2PSignalingEnvelope[]>();
  const relayByConversation = new Map<string, DirectP2PMessageEnvelope[]>();
  const discoveryMessages = new Map<string, P2PDiscoveryMessage>();
  const presenceByUserId = new Map<string, PresenceRecord>();
  const peerAckInbox = new Map<string, PeerAckMessage[]>();
  const peerAckNonces = new Set<string>();
  const signalingNonces = new Set<string>();
  const relayNonces = new Set<string>();
  const discoveryNonces = new Set<string>();
  const techSupportMessages = new TechSupportMessageStore();
  const directTalkDelivery = usesDirectTalkDelivery(resolveP2PRuntimeFlags(process.env));

  const prunePresence = (now = new Date()): void => {
    prunePresenceRecords(presenceByUserId, now);
    for (const [toPub, inbox] of peerAckInbox) {
      const fresh = inbox.filter((ack) => new Date(ack.expiresAt).getTime() > now.getTime());
      if (fresh.length === 0) peerAckInbox.delete(toPub);
      else peerAckInbox.set(toPub, fresh);
    }
  };

  const pruneSignaling = (now = new Date()): void => {
    for (const [conversationId, envelopes] of signalingByConversation) {
      const fresh = envelopes.filter((envelope) => new Date(envelope.expiresAt).getTime() > now.getTime());
      if (fresh.length === 0) signalingByConversation.delete(conversationId);
      else signalingByConversation.set(conversationId, fresh);
    }
  };

  const pruneConversationRelay = (now = new Date()): void => {
    for (const [conversationId, envelopes] of relayByConversation) {
      const fresh = envelopes.filter((envelope) => new Date(envelope.expiresAt).getTime() > now.getTime());
      if (fresh.length === 0) relayByConversation.delete(conversationId);
      else relayByConversation.set(conversationId, fresh);
    }
  };

  const pruneDiscovery = (now = new Date()): void => {
    for (const [senderPub, message] of discoveryMessages) {
      if (new Date(message.expiresAt).getTime() <= now.getTime()) {
        discoveryMessages.delete(senderPub);
      }
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

  app.get('/api/p2p/signaling/:conversationId', (req, res) => {
    pruneSignaling();
    const conversationId = String(req.params.conversationId || '');
    res.json({
      conversationId,
      envelopes: signalingByConversation.get(conversationId) || [],
    });
  });

  app.post('/api/p2p/signaling/:conversationId', async (req, res) => {
    try {
      pruneSignaling();
      const conversationId = String(req.params.conversationId || '');
      const body = req.body || {};
      const kind = body.kind as P2PSignalingKind;
      const senderPub = String(body.senderPub || '');
      const recipientPub = String(body.recipientPub || '');
      const signalCiphertext = String(body.signalCiphertext || '');
      const verification = await verifySignedP2PEnvelopeProof({
        proof: {
          peerId: String(body.senderPeerId || body.peerId || ''),
          pub: senderPub,
          timestamp: String(body.timestamp || ''),
          nonce: String(body.nonce || ''),
          payloadHash: String(body.payloadHash || ''),
          signature: String(body.signature || ''),
        },
        payload: p2pSignalingSigningPayload({ conversationId, kind, senderPub, recipientPub, signalCiphertext }),
        nonceCache: signalingNonces,
      });
      if (!verification.ok) {
        res.status(400).json({ error: verification.reason });
        return;
      }
      const envelope = createP2PSignalingEnvelope({
        conversationId,
        kind,
        senderPeerId: String(body.senderPeerId || body.peerId || ''),
        senderPub,
        recipientPub,
        signalCiphertext,
        timestamp: String(body.timestamp || ''),
        payloadHash: String(body.payloadHash || ''),
        signature: String(body.signature || ''),
        nonce: String(body.nonce || ''),
      });
      const current = signalingByConversation.get(conversationId) || [];
      signalingByConversation.set(conversationId, [...current, envelope]);
      res.json({ stored: true, envelope });
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

    app.get('/api/p2p/discovery', (_req, res) => {
      pruneDiscovery();
      res.json({
        protocol: createP2PNodeProtocolSpec(),
        messages: Array.from(discoveryMessages.values()),
      });
    });

    app.post('/api/p2p/discovery', async (req, res) => {
      try {
        pruneDiscovery();
        const body = req.body || {};
        const platform = String(body.platform || '') as P2PPlatformId;
        const senderPub = String(body.senderPub || '');
        const capabilities = Array.isArray(body.capabilities) ? (body.capabilities as P2PNodeCapability[]) : [];
        const endpointHints = Array.isArray(body.endpointHints) ? body.endpointHints.map(String) : [];
        const routeHint = body.routeHint ? String(body.routeHint) : undefined;
        const verification = await verifySignedP2PEnvelopeProof({
          proof: {
            peerId: String(body.peerId || ''),
            pub: senderPub,
            timestamp: String(body.timestamp || ''),
            nonce: String(body.nonce || ''),
            payloadHash: String(body.payloadHash || ''),
            signature: String(body.signature || ''),
          },
          payload: p2pDiscoverySigningPayload({
            platform,
            senderPub,
            capabilities,
            endpointHints,
            ...(routeHint ? { routeHint } : {}),
          }),
          nonceCache: discoveryNonces,
        });
        if (!verification.ok) {
          res.status(400).json({ error: verification.reason });
          return;
        }
        const message = createP2PDiscoveryMessage({
          platform,
          peerId: String(body.peerId || ''),
          senderPub,
          capabilities,
          endpointHints,
          timestamp: String(body.timestamp || ''),
          payloadHash: String(body.payloadHash || ''),
          signature: String(body.signature || ''),
          nonce: String(body.nonce || ''),
          expiresAt: String(body.expiresAt || ''),
          ...(routeHint ? { routeHint } : {}),
          ...(body.bodyPlaintext ? { bodyPlaintext: String(body.bodyPlaintext) } : {}),
        });
        discoveryMessages.set(message.senderPub, message);
        res.json({ stored: true, message });
      } catch (error) {
        res.status(400).json({ error: (error as Error).message });
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

    app.get('/api/test/user-conversations/:userId', (req, res) => {
      const { userId } = req.params;
      const userMap = conversationsMap.get(userId);
      const conversations = userMap ? Array.from(userMap.values()) : [];
      res.json({ conversations, count: conversations.length });
    });

    app.post('/api/test/clear-database', (_req, res) => {
      try {
        // Clear Gun.js in-memory graph
        // Gun stores data in gun._.graph which is the in-memory cache
        if (gun && gun._ && gun._.graph) {
          logger.info('🧹 Clearing Gun.js in-memory database...');
          gun._.graph = {};
          if (gunService) clearExactChatbotMemoryCacheForTesting(gunService);
          incomingTalksMap.clear();
          conversationsMap.clear();
          clearTalkResponseStats();
          onClearDatabase?.();
          const radiskDirs = clearRadiskOnDisk();
          logger.info({ radiskDirs }, '✅ Gun.js in-memory database cleared');
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
          incomingTalks: mapOfMapsToObject(incomingTalksMap),
          conversations: mapOfMapsToObject(conversationsMap),
          talkResponses: directTalkDelivery ? {} : Object.fromEntries(talkResponsesMap),
          statsIdx: statsIdxToObject(statsIdx),
        };
        res.json(snapshot);
      } catch (error) {
        logger.error({ err: error }, 'Error exporting E2E snapshot');
        res.status(500).json({ error: (error as Error).message });
      }
    });

    app.post('/api/test/import-snapshot', (req, res) => {
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
        incomingTalksMap.clear();
        conversationsMap.clear();
        for (const [uid, inner] of Object.entries(body.incomingTalks || {})) {
          incomingTalksMap.set(uid, new Map(Object.entries(inner || {})));
        }
        for (const [uid, inner] of Object.entries(body.conversations || {})) {
          conversationsMap.set(uid, new Map(Object.entries(inner || {})));
        }
        talkResponsesMap.clear();
        if (!directTalkDelivery) {
          for (const [talkId, rows] of Object.entries(body.talkResponses || {})) {
            talkResponsesMap.set(talkId, Array.isArray(rows) ? rows : []);
          }
        }
        const restored = statsIdxFromObject(body.statsIdx);
        statsIdx.byDay.clear();
        statsIdx.byRegion.clear();
        statsIdx.byTalkAnswer.clear();
        for (const [k, v] of restored.byDay) statsIdx.byDay.set(k, v);
        for (const [k, v] of restored.byRegion) statsIdx.byRegion.set(k, v);
        for (const [k, v] of restored.byTalkAnswer) statsIdx.byTalkAnswer.set(k, v);
        logger.info('✅ E2E snapshot imported');
        res.json({ success: true });
      } catch (error) {
        logger.error({ err: error }, 'Error importing E2E snapshot');
        res.status(500).json({ error: (error as Error).message });
      }
    });
  }
}
