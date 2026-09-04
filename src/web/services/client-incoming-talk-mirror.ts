import {
  OWNER_INCOMING_TALK_INDEX_ROOT,
  mergeIncomingTalkCluster,
  planIncomingTalkClusterPrune,
  type IncomingTalkClusterWire,
} from '../../shared/peer-talk-delivery';
import type { P2PRuntimeFlags } from '../../shared/p2p-runtime';
import type { WebGunService } from './web-gun-service';

type StoredIncomingTalkCluster = Omit<IncomingTalkClusterWire, 'senders' | 'talkIds' | 'identityAliases'> & {
  senders?: IncomingTalkClusterWire['senders'];
  talkIds?: IncomingTalkClusterWire['talkIds'];
  identityAliases?: IncomingTalkClusterWire['identityAliases'];
  sendersJson?: string;
  talkIdsJson?: string;
  identityAliasesJson?: string;
};

type OwnerIncomingTalkEnvelope = {
  version: 1;
  clustersJson: string;
  updatedAt: string;
};

const ownerEnvelopeWriteQueues = new WeakMap<WebGunService, Promise<void>>();

function ownerEnvelopeSoul(gunService: WebGunService, receiverUserId: string): string {
  const ownerSeaPub = String(gunService.getStoredPair()?.pub || receiverUserId);
  return `users/${encodeURIComponent(ownerSeaPub)}/incomingTalkClusters`;
}

async function readOwnerEnvelopeClusters(
  gunService: WebGunService,
  receiverUserId: string,
): Promise<IncomingTalkClusterWire[]> {
  let raw: OwnerIncomingTalkEnvelope | null;
  try {
    raw = await gunService.get(ownerEnvelopeSoul(gunService, receiverUserId)) as OwnerIncomingTalkEnvelope | null;
  } catch {
    // First delivery on a device has no owner envelope yet. WebGunService.get distinguishes
    // "missing" by rejecting; for an append/upsert store that is the normal empty state.
    return [];
  }
  if (!raw || raw.version !== 1 || typeof raw.clustersJson !== 'string') return [];
  try {
    const stored = JSON.parse(raw.clustersJson) as StoredIncomingTalkCluster[];
    return stored.map(hydrateCluster).filter((cluster): cluster is IncomingTalkClusterWire => !!cluster?.identityKey);
  } catch {
    return [];
  }
}

function serializeCluster(cluster: IncomingTalkClusterWire): StoredIncomingTalkCluster {
  const { senders, talkIds, identityAliases, ...rest } = cluster;
  return {
    ...rest,
    sendersJson: JSON.stringify(senders || {}),
    talkIdsJson: JSON.stringify(talkIds || {}),
    identityAliasesJson: JSON.stringify(identityAliases || {}),
  };
}

function hydrateCluster(raw: unknown): IncomingTalkClusterWire | null {
  if (!raw || typeof raw !== 'object') return null;
  const stored = raw as StoredIncomingTalkCluster;
  const parseMap = <T>(json: string | undefined, fallback: T): T => {
    if (!json) return fallback;
    try {
      return JSON.parse(json) as T;
    } catch {
      return fallback;
    }
  };
  return {
    ...stored,
    senders: parseMap(stored.sendersJson, stored.senders || {}),
    talkIds: parseMap(stored.talkIdsJson, stored.talkIds || {}),
    identityAliases: parseMap(stored.identityAliasesJson, stored.identityAliases || {}),
  };
}

export function mirrorIncomingTalkClustersToLocalGun(
  gunService: WebGunService,
  userId: string,
  clusters: unknown[],
  flags: P2PRuntimeFlags,
): void {
  if (!flags.p2pClientTalkMirror || !userId || !Array.isArray(clusters)) return;
  for (const raw of clusters) {
    const cluster = raw as { identityKey?: string };
    if (!cluster?.identityKey) continue;
    void persistIncomingTalkClusterToLocalGun(gunService, userId, raw as IncomingTalkClusterWire).catch((error) => {
      console.warn('[client-incoming-talk-mirror] owner envelope mirror failed:', error);
    });
  }
}

function persistIncomingTalkClusterToLocalGun(
  gunService: WebGunService,
  receiverUserId: string,
  cluster: IncomingTalkClusterWire,
): Promise<void> {
  return persistIncomingTalkClustersToLocalGun(gunService, receiverUserId, [cluster]);
}

function persistIncomingTalkClustersToLocalGun(
  gunService: WebGunService,
  receiverUserId: string,
  clusters: IncomingTalkClusterWire[],
): Promise<void> {
  const queued = (ownerEnvelopeWriteQueues.get(gunService) || Promise.resolve())
    .catch(() => undefined)
    .then(async () => {
      const current = await readOwnerEnvelopeClusters(gunService, receiverUserId);
      const byIdentity = new Map(current.map((item) => [item.identityKey, item]));
      let changed = false;
      for (const cluster of clusters) {
        const stored = byIdentity.get(cluster.identityKey);
        // Server/UI refreshes mirror their current rows back through this helper. Rewriting an
        // identical row changes updatedAt, fires the owner-envelope subscription, refreshes the
        // UI again, and creates a write/refresh feedback loop (especially costly on Android).
        if (stored && JSON.stringify(serializeCluster(stored)) === JSON.stringify(serializeCluster(cluster))) {
          continue;
        }
        byIdentity.set(cluster.identityKey, cluster);
        changed = true;
      }
      if (!changed) return;
      const envelope: OwnerIncomingTalkEnvelope = {
        version: 1,
        clustersJson: JSON.stringify([...byIdentity.values()].map(serializeCluster)),
        updatedAt: new Date().toISOString(),
      };
      const soul = ownerEnvelopeSoul(gunService, receiverUserId);
      await gunService.put(soul, envelope);
      // put() already applied this envelope to the local Gun graph synchronously — the read-back
      // below is a paranoid double-check, not the real commit. In this deployment (relay-only
      // hub, no local persistence) get() on a freshly-written soul can hang for its full
      // multi-second timeout and reject even though the write succeeded, which used to turn a
      // successful incoming-talk mirror into a reported delivery failure. Log and continue.
      try {
        const verified = await gunService.get(soul) as OwnerIncomingTalkEnvelope | null;
        if (verified?.version !== 1 || verified.clustersJson !== envelope.clustersJson) {
          console.warn(`incoming talk envelope read-back inconclusive (continuing — write already committed locally): ${clusters.map((c) => c.identityKey).join(',')}`);
        }
      } catch (error) {
        console.warn(`incoming talk envelope read-back timed out (continuing — write already committed locally): ${clusters.map((c) => c.identityKey).join(',')}`, error);
      }
    });
  ownerEnvelopeWriteQueues.set(gunService, queued);
  return queued;
}

export async function upsertLocalIncomingTalkClusters(
  gunService: WebGunService,
  receiverUserId: string,
  items: Array<{
    talkId: string;
    talkData: Record<string, unknown>;
    senderId: string;
    senderName: string;
  }>,
  flags: P2PRuntimeFlags,
): Promise<IncomingTalkClusterWire[]> {
  const ownerClusters = flags.p2pClientTalkMirror
    ? await readOwnerEnvelopeClusters(gunService, receiverUserId)
    : [];
  const byIdentity = new Map(ownerClusters.map((cluster) => [cluster.identityKey, cluster]));
  const results: IncomingTalkClusterWire[] = [];
  for (const params of items) {
    const draft = mergeIncomingTalkCluster(null, params);
    const cluster = mergeIncomingTalkCluster(byIdentity.get(draft.identityKey), params);
    byIdentity.set(cluster.identityKey, cluster);
    results.push(cluster);
  }
  if (flags.p2pClientTalkMirror && results.length > 0) {
    await persistIncomingTalkClustersToLocalGun(gunService, receiverUserId, results);
    void pruneIncomingTalkClustersIfNeeded(gunService, receiverUserId, flags).catch((err) => {
      console.warn('[client-incoming-talk-mirror] incoming-talk-cluster prune failed (non-fatal):', receiverUserId, err);
    });
  }
  return results;
}

export async function upsertLocalIncomingTalkCluster(
  gunService: WebGunService,
  receiverUserId: string,
  params: {
    talkId: string;
    talkData: Record<string, unknown>;
    senderId: string;
    senderName: string;
  },
  flags: P2PRuntimeFlags,
  existingCluster?: IncomingTalkClusterWire | null,
): Promise<IncomingTalkClusterWire> {
  const draft = mergeIncomingTalkCluster(existingCluster, params);
  const ownerClusters = flags.p2pClientTalkMirror
    ? await readOwnerEnvelopeClusters(gunService, receiverUserId)
    : [];
  const durableExisting = ownerClusters.find((item) => item.identityKey === draft.identityKey) || existingCluster;
  const cluster = mergeIncomingTalkCluster(durableExisting, params);
  if (!flags.p2pClientTalkMirror) return cluster;
  // The mesh ACK must mean the receiver can reopen this talk, not merely that an in-memory
  // callback ran. Await the nested Gun write acknowledgement before handleMeshTalkBody returns.
  // A failure now withholds the mesh ACK, allowing the sender's existing mailbox fallback to
  // retry instead of silently losing the row from the receiver's Talks UI.
  await persistIncomingTalkClusterToLocalGun(gunService, receiverUserId, cluster);
  // docs/TODO.md §Y2: fire-and-forget, mirroring the visit-counter prune trigger
  // (WebChatroomService.recordRoomVisit) — every device prunes its own local Gun graph
  // independently, there is no single authoritative pruner under the P2P model.
  void pruneIncomingTalkClustersIfNeeded(gunService, receiverUserId, flags).catch((err) => {
    console.warn('[client-incoming-talk-mirror] incoming-talk-cluster prune failed (non-fatal):', receiverUserId, err);
  });
  return cluster;
}

/**
 * docs/TODO.md §Y2 — once a user's live incoming-talk-cluster count exceeds
 * `DEFAULT_INCOMING_TALK_CLUSTER_MAX_SLOTS`, delete the oldest (by `updatedAt`) outright.
 * No aggregate fold needed here (see `planIncomingTalkClusterPrune`'s doc comment) — a
 * pruned cluster's own Q&A record already survives independently in the Me tab.
 */
export async function pruneIncomingTalkClustersIfNeeded(
  gunService: WebGunService,
  receiverUserId: string,
  flags: P2PRuntimeFlags,
): Promise<void> {
  if (!flags.p2pClientTalkMirror || !receiverUserId) return;
  const clusters = await collectLocalIncomingTalkClusters(gunService, receiverUserId, flags);
  const plan = planIncomingTalkClusterPrune(clusters);
  if (plan.clustersToPrune.length === 0) return;
  const gun = gunService.getGun();
  const ownerRef = gun.get(OWNER_INCOMING_TALK_INDEX_ROOT).get(receiverUserId);
  for (const cluster of plan.clustersToPrune) {
    if (cluster.identityKey) ownerRef.get(cluster.identityKey).put(null);
  }
}

export async function collectLocalIncomingTalkClusters(
  gunService: WebGunService,
  receiverUserId: string,
  _flags: P2PRuntimeFlags,
  opts: { waitMs?: number } = {},
): Promise<IncomingTalkClusterWire[]> {
  const ownerClusters = await readOwnerEnvelopeClusters(gunService, receiverUserId);
  const gun = gunService.getGun();
  const waitMs = opts.waitMs ?? 400;
  const clusters: IncomingTalkClusterWire[] = [];
  const ref = gun.get(OWNER_INCOMING_TALK_INDEX_ROOT).get(receiverUserId).map();
  await new Promise<void>((resolve) => {
    ref.once((raw: unknown, key: string) => {
      if (!raw || !key || key.startsWith('_')) return;
      const cluster = hydrateCluster(raw);
      if (cluster?.identityKey) clusters.push(cluster);
    });
    setTimeout(resolve, waitMs);
  });
  try {
    ref.off();
  } catch {
    /* ignore */
  }
  const byKey = new Map<string, IncomingTalkClusterWire>();
  for (const cluster of [...clusters, ...ownerClusters]) {
    if (cluster.identityKey) byKey.set(cluster.identityKey, cluster);
  }
  return [...byKey.values()];
}

export function subscribeLocalIncomingTalkClusters(
  gunService: WebGunService,
  receiverUserId: string,
  _flags: P2PRuntimeFlags,
  handler: (cluster: IncomingTalkClusterWire, id: string) => void,
): () => void {
  const ownerRef = gunService.getGun().get(ownerEnvelopeSoul(gunService, receiverUserId));
  const onOwnerEnvelope = (raw: OwnerIncomingTalkEnvelope | null | undefined) => {
    if (!raw || raw.version !== 1 || typeof raw.clustersJson !== 'string') return;
    try {
      const rows = JSON.parse(raw.clustersJson) as StoredIncomingTalkCluster[];
      for (const row of rows) {
        const cluster = hydrateCluster(row);
        if (cluster?.identityKey) handler(cluster, cluster.identityKey);
      }
    } catch {
      // Ignore a corrupt/incomplete replication frame; the next valid envelope update retries.
    }
  };
  ownerRef.on(onOwnerEnvelope);
  const ref = gunService.getGun().get(OWNER_INCOMING_TALK_INDEX_ROOT).get(receiverUserId).map();
  ref.on((raw: unknown, key: string) => {
    if (!raw || !key || key.startsWith('_')) return;
    const cluster = hydrateCluster(raw);
    if (cluster?.identityKey) handler(cluster, key);
  });
  return () => {
    try {
      ownerRef.off();
    } catch {
      /* ignore */
    }
    try {
      ref.off();
    } catch {
      /* ignore */
    }
  };
}
