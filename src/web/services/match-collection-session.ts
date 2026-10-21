/**
 * A local, durable record of one real-world match-collection outing.
 *
 * The delivery association is deliberately stored separately from `localTalkExchanges`: the
 * latter keeps only the latest peer + Talk outcome, while an outing must remain reviewable after
 * the same Talk is sent to the same person on another day. Nothing in this store is published.
 */

export const MATCH_COLLECTION_STORE_KEY = 'iinpublic_match_collection_sessions_v1';

const MAX_SESSIONS = 8;
const MAX_ASSOCIATIONS = 5_000;
const MAX_RESULTS_PER_SESSION = 2_500;

export type MatchCollectionOutcome = 'match' | 'mismatch' | 'ignore';

export type MatchCollectionPoint = {
  latitude: number;
  longitude: number;
  precisionMeters: number;
};

export type MatchCollectionResult = {
  peerId: string;
  talkId: string;
  outcome: MatchCollectionOutcome;
  capturedAt: string;
};

export type MatchCollectionSession = {
  version: 1;
  id: string;
  label: string;
  scopeId: string;
  startedAt: string;
  endedAt?: string;
  point?: MatchCollectionPoint;
  talkIds: string[];
  reachedPeerIds: string[];
  results: MatchCollectionResult[];
};

type DeliveryAssociation = {
  sessionId: string;
  peerId: string;
  talkId: string;
  sentAt: string;
};

type MatchCollectionStore = {
  version: 1;
  activeSessionId?: string;
  sessions: MatchCollectionSession[];
  associations: DeliveryAssociation[];
};

export type MatchCollectionTag = {
  collectionSessionId: string;
  collectionLabel: string;
  collectionStartedAt: string;
};

const emptyStore = (): MatchCollectionStore => ({ version: 1, sessions: [], associations: [] });

const clean = (value: unknown): string => String(value || '').trim();

function validPoint(value: unknown): value is MatchCollectionPoint {
  if (!value || typeof value !== 'object') return false;
  const point = value as Partial<MatchCollectionPoint>;
  return typeof point.latitude === 'number' && Number.isFinite(point.latitude)
    && point.latitude >= -90 && point.latitude <= 90
    && typeof point.longitude === 'number' && Number.isFinite(point.longitude)
    && point.longitude >= -180 && point.longitude <= 180
    && typeof point.precisionMeters === 'number' && Number.isFinite(point.precisionMeters)
    && point.precisionMeters > 0;
}

function normalizeSession(value: unknown): MatchCollectionSession | null {
  if (!value || typeof value !== 'object') return null;
  const row = value as Partial<MatchCollectionSession>;
  const id = clean(row.id);
  const label = clean(row.label);
  const scopeId = clean(row.scopeId);
  const startedAt = clean(row.startedAt);
  if (!id || !label || !scopeId || !startedAt || Number.isNaN(Date.parse(startedAt))) return null;
  const endedAt = clean(row.endedAt);
  const results = Array.isArray(row.results)
    ? row.results.flatMap((candidate): MatchCollectionResult[] => {
        if (!candidate || typeof candidate !== 'object') return [];
        const result = candidate as Partial<MatchCollectionResult>;
        const peerId = clean(result.peerId);
        const talkId = clean(result.talkId);
        const capturedAt = clean(result.capturedAt);
        if (!peerId || !talkId || !capturedAt || Number.isNaN(Date.parse(capturedAt))) return [];
        if (result.outcome !== 'match' && result.outcome !== 'mismatch' && result.outcome !== 'ignore') return [];
        return [{ peerId, talkId, outcome: result.outcome, capturedAt }];
      }).slice(-MAX_RESULTS_PER_SESSION)
    : [];
  return {
    version: 1,
    id,
    label,
    scopeId,
    startedAt,
    ...(endedAt && !Number.isNaN(Date.parse(endedAt)) ? { endedAt } : {}),
    ...(validPoint(row.point) ? { point: row.point } : {}),
    talkIds: Array.isArray(row.talkIds) ? [...new Set(row.talkIds.map(clean).filter(Boolean))] : [],
    reachedPeerIds: Array.isArray(row.reachedPeerIds)
      ? [...new Set(row.reachedPeerIds.map(clean).filter(Boolean))]
      : [],
    results,
  };
}

function readStore(): MatchCollectionStore {
  try {
    const parsed = JSON.parse(localStorage.getItem(MATCH_COLLECTION_STORE_KEY) || 'null') as Partial<MatchCollectionStore> | null;
    if (!parsed || parsed.version !== 1) return emptyStore();
    const sessions = Array.isArray(parsed.sessions)
      ? parsed.sessions.map(normalizeSession).filter((row): row is MatchCollectionSession => row !== null).slice(-MAX_SESSIONS)
      : [];
    const sessionIds = new Set(sessions.map((session) => session.id));
    const associations = Array.isArray(parsed.associations)
      ? parsed.associations.flatMap((candidate): DeliveryAssociation[] => {
          if (!candidate || typeof candidate !== 'object') return [];
          const row = candidate as Partial<DeliveryAssociation>;
          const sessionId = clean(row.sessionId);
          const peerId = clean(row.peerId);
          const talkId = clean(row.talkId);
          const sentAt = clean(row.sentAt);
          if (!sessionIds.has(sessionId) || !peerId || !talkId || !sentAt || Number.isNaN(Date.parse(sentAt))) return [];
          return [{ sessionId, peerId, talkId, sentAt }];
        }).slice(-MAX_ASSOCIATIONS)
      : [];
    const activeSessionId = clean(parsed.activeSessionId);
    return {
      version: 1,
      ...(activeSessionId && sessions.some((session) => session.id === activeSessionId && !session.endedAt)
        ? { activeSessionId }
        : {}),
      sessions,
      associations,
    };
  } catch {
    return emptyStore();
  }
}

function writeStore(store: MatchCollectionStore): void {
  const keptSessions = store.sessions.slice(-MAX_SESSIONS);
  const ids = new Set(keptSessions.map((session) => session.id));
  const bounded: MatchCollectionStore = {
    version: 1,
    ...(store.activeSessionId && ids.has(store.activeSessionId) ? { activeSessionId: store.activeSessionId } : {}),
    sessions: keptSessions,
    associations: store.associations.filter((row) => ids.has(row.sessionId)).slice(-MAX_ASSOCIATIONS),
  };
  try {
    localStorage.setItem(MATCH_COLLECTION_STORE_KEY, JSON.stringify(bounded));
  } catch {
    // Collection history is a local UI aid. Delivery and matching must continue if storage is full.
  }
}

export function listMatchCollectionSessions(): MatchCollectionSession[] {
  return readStore().sessions;
}

export function getActiveMatchCollectionSession(): MatchCollectionSession | null {
  const store = readStore();
  return store.sessions.find((session) => session.id === store.activeSessionId && !session.endedAt) ?? null;
}

export function startMatchCollectionSession(
  input: { label: string; scopeId: string; talkIds?: string[]; point?: MatchCollectionPoint },
  now: Date = new Date(),
  random: () => number = Math.random,
): MatchCollectionSession {
  const label = clean(input.label) || 'Nearby';
  const scopeId = clean(input.scopeId);
  if (!scopeId) throw new Error('match collection needs a scope');
  const store = readStore();
  const at = now.toISOString();
  if (store.activeSessionId) {
    store.sessions = store.sessions.map((session) => session.id === store.activeSessionId && !session.endedAt
      ? { ...session, endedAt: at }
      : session);
  }
  const id = `collection_${now.getTime().toString(36)}_${Math.floor(random() * 0x1_0000_0000).toString(36)}`;
  const session: MatchCollectionSession = {
    version: 1,
    id,
    label,
    scopeId,
    startedAt: at,
    ...(input.point && validPoint(input.point) ? { point: { ...input.point } } : {}),
    talkIds: [...new Set((input.talkIds ?? []).map(clean).filter(Boolean))],
    reachedPeerIds: [],
    results: [],
  };
  store.sessions.push(session);
  store.activeSessionId = id;
  writeStore(store);
  return session;
}

export function endMatchCollectionSession(now: Date = new Date()): MatchCollectionSession | null {
  const store = readStore();
  const activeId = store.activeSessionId;
  if (!activeId) return null;
  let ended: MatchCollectionSession | null = null;
  store.sessions = store.sessions.map((session) => {
    if (session.id !== activeId || session.endedAt) return session;
    ended = { ...session, endedAt: now.toISOString() };
    return ended;
  });
  delete store.activeSessionId;
  writeStore(store);
  return ended;
}

/** Associate every intended peer + Talk pair with the active outing before delivery starts. */
export function recordMatchCollectionDelivery(input: {
  talkIds: string[];
  peerIds: string[];
  talkReceiverIds?: Record<string, string[]>;
}, now: Date = new Date()): MatchCollectionSession | null {
  const store = readStore();
  const activeId = store.activeSessionId;
  const session = store.sessions.find((candidate) => candidate.id === activeId && !candidate.endedAt);
  if (!session) return null;
  const talkIds = [...new Set(input.talkIds.map(clean).filter(Boolean))];
  const peerIds = [...new Set(input.peerIds.map(clean).filter(Boolean))];
  const intendedPairs: Array<{ talkId: string; peerId: string }> = [];
  for (const talkId of talkIds) {
    const narrowed = input.talkReceiverIds?.[talkId];
    const allowed = narrowed ? new Set(narrowed.map(clean).filter(Boolean)) : null;
    for (const peerId of peerIds) {
      if (!allowed || allowed.has(peerId)) intendedPairs.push({ talkId, peerId });
    }
  }
  const sentAt = now.toISOString();
  const pairKeys = new Set(intendedPairs.map(({ talkId, peerId }) => `${peerId}\u0000${talkId}`));
  store.associations = [
    ...store.associations.filter((row) => !pairKeys.has(`${row.peerId}\u0000${row.talkId}`)),
    ...intendedPairs.map(({ talkId, peerId }) => ({ sessionId: session.id, talkId, peerId, sentAt })),
  ];
  const reachedPeerIds = [...new Set([...session.reachedPeerIds, ...intendedPairs.map((pair) => pair.peerId)])];
  const next = { ...session, talkIds: [...new Set([...session.talkIds, ...talkIds])], reachedPeerIds };
  store.sessions = store.sessions.map((candidate) => candidate.id === session.id ? next : candidate);
  writeStore(store);
  return next;
}

/** Preserve an outcome in its original outing, even if that outing has since ended. */
export function recordMatchCollectionExchange(
  peerIdInput: string,
  talkIdInput: string,
  outcome: MatchCollectionOutcome,
  now: Date = new Date(),
): MatchCollectionTag | null {
  const peerId = clean(peerIdInput);
  const talkId = clean(talkIdInput);
  if (!peerId || !talkId) return null;
  const store = readStore();
  const association = [...store.associations].reverse().find((row) => row.peerId === peerId && row.talkId === talkId);
  if (!association) return null;
  const session = store.sessions.find((candidate) => candidate.id === association.sessionId);
  if (!session) return null;
  const capturedAt = now.toISOString();
  const results = [
    ...session.results.filter((row) => row.peerId !== peerId || row.talkId !== talkId),
    { peerId, talkId, outcome, capturedAt },
  ].slice(-MAX_RESULTS_PER_SESSION);
  store.sessions = store.sessions.map((candidate) => candidate.id === session.id ? { ...session, results } : candidate);
  writeStore(store);
  return {
    collectionSessionId: session.id,
    collectionLabel: session.label,
    collectionStartedAt: session.startedAt,
  };
}

