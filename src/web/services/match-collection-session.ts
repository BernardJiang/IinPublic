/**
 * A local, durable record of one real-world match-collection outing.
 *
 * The delivery association is deliberately stored separately from `localTalkExchanges`: the
 * latter keeps only the latest peer + Talk outcome, while an outing must remain reviewable after
 * the same Talk is sent to the same person on another day. Nothing in this store is published.
 */
import { appStorage } from './core-storage';

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

export type MatchCollectionLocationSample = {
  id: string;
  capturedAt: string;
  source: 'gps' | 'traveler' | 'place' | 'unavailable';
  point?: MatchCollectionPoint;
  /** Exact GPS accuracy is never stored; this is the public grid size when a point exists. */
  precisionMeters?: number;
  /** True when this send moved into a different public grid cell from the previous send. */
  areaChanged?: boolean;
};

export type MatchCollectionResult = {
  peerId: string;
  talkId: string;
  outcome: MatchCollectionOutcome;
  capturedAt: string;
};

export type MatchCollectionPeerReview = {
  pinned?: boolean;
  dismissed?: boolean;
  note?: string;
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
  peerReviews?: Record<string, MatchCollectionPeerReview>;
  locationSamples?: MatchCollectionLocationSample[];
};

export type MatchCollectionSummary = {
  reached: number;
  deliveries: number;
  replies: number;
  pending: number;
  matches: number;
  mismatches: number;
  ignored: number;
  late: number;
  elapsedMs: number;
};

export type MatchCollectionReviewPerson = {
  peerId: string;
  talkIds: string[];
  pending: number;
  results: MatchCollectionResult[];
  latestOutcomes: Array<{ talkId: string; outcome: MatchCollectionOutcome; capturedAt: string; late: boolean }>;
  pinned: boolean;
  dismissed: boolean;
  note: string;
  encounterDistancesMeters: number[];
};

type DeliveryAssociation = {
  sessionId: string;
  peerId: string;
  talkId: string;
  sentAt: string;
  locationSampleId?: string;
  encounterDistanceMeters?: number;
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
  const peerReviews = row.peerReviews && typeof row.peerReviews === 'object'
    ? Object.fromEntries(Object.entries(row.peerReviews).flatMap(([peerIdInput, candidate]) => {
        const peerId = clean(peerIdInput);
        if (!peerId || !candidate || typeof candidate !== 'object') return [];
        const review = candidate as MatchCollectionPeerReview;
        const note = clean(review.note).slice(0, 2_000);
        return [[peerId, {
          ...(review.pinned ? { pinned: true } : {}),
          ...(review.dismissed ? { dismissed: true } : {}),
          ...(note ? { note } : {}),
        }]];
      }))
    : {};
  const locationSamples = Array.isArray(row.locationSamples)
    ? row.locationSamples.flatMap((candidate): MatchCollectionLocationSample[] => {
        if (!candidate || typeof candidate !== 'object') return [];
        const sample = candidate as Partial<MatchCollectionLocationSample>;
        const id = clean(sample.id);
        const capturedAt = clean(sample.capturedAt);
        if (!id || !capturedAt || Number.isNaN(Date.parse(capturedAt))) return [];
        if (sample.source !== 'gps' && sample.source !== 'traveler'
          && sample.source !== 'place' && sample.source !== 'unavailable') return [];
        const point = validPoint(sample.point) ? sample.point : undefined;
        return [{
          id,
          capturedAt,
          source: sample.source,
          ...(point ? { point, precisionMeters: point.precisionMeters } : {}),
          ...(sample.areaChanged ? { areaChanged: true } : {}),
        }];
      }).slice(-500)
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
    ...(Object.keys(peerReviews).length ? { peerReviews } : {}),
    ...(locationSamples.length ? { locationSamples } : {}),
  };
}

function readStore(): MatchCollectionStore {
  try {
    const parsed = JSON.parse(appStorage.getItem(MATCH_COLLECTION_STORE_KEY) || 'null') as Partial<MatchCollectionStore> | null;
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
          const locationSampleId = clean(row.locationSampleId);
          const encounterDistanceMeters = Number(row.encounterDistanceMeters);
          return [{
            sessionId,
            peerId,
            talkId,
            sentAt,
            ...(locationSampleId ? { locationSampleId } : {}),
            ...(Number.isFinite(encounterDistanceMeters) && encounterDistanceMeters >= 0
              ? { encounterDistanceMeters }
              : {}),
          }];
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
    appStorage.setItem(MATCH_COLLECTION_STORE_KEY, JSON.stringify(bounded));
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

export function getLatestMatchCollectionSession(): MatchCollectionSession | null {
  return readStore().sessions.at(-1) ?? null;
}

export function getMatchCollectionSession(sessionIdInput: string): MatchCollectionSession | null {
  const sessionId = clean(sessionIdInput);
  return readStore().sessions.find((session) => session.id === sessionId) ?? null;
}

function latestResultsByPair(results: MatchCollectionResult[]): Map<string, MatchCollectionResult> {
  const latest = new Map<string, MatchCollectionResult>();
  for (const result of results) latest.set(`${result.peerId}\u0000${result.talkId}`, result);
  return latest;
}

export function summarizeMatchCollectionSession(
  sessionId: string,
  now: Date = new Date(),
): MatchCollectionSummary | null {
  const store = readStore();
  const session = store.sessions.find((candidate) => candidate.id === sessionId);
  if (!session) return null;
  const associations = store.associations.filter((row) => row.sessionId === session.id);
  const latestResults = [...latestResultsByPair(session.results).values()];
  const repliedPairs = new Set(latestResults.map((row) => `${row.peerId}\u0000${row.talkId}`));
  const endedAtMs = session.endedAt ? Date.parse(session.endedAt) : now.getTime();
  const startedAtMs = Date.parse(session.startedAt);
  const endedBoundary = session.endedAt ? Date.parse(session.endedAt) : Number.POSITIVE_INFINITY;
  return {
    reached: session.reachedPeerIds.length,
    deliveries: associations.length,
    replies: repliedPairs.size,
    pending: Math.max(0, associations.length - repliedPairs.size),
    matches: latestResults.filter((row) => row.outcome === 'match').length,
    mismatches: latestResults.filter((row) => row.outcome === 'mismatch').length,
    ignored: latestResults.filter((row) => row.outcome === 'ignore').length,
    late: latestResults.filter((row) => Date.parse(row.capturedAt) > endedBoundary).length,
    elapsedMs: Math.max(0, endedAtMs - startedAtMs),
  };
}

export function getMatchCollectionReviewPeople(sessionIdInput: string): MatchCollectionReviewPerson[] {
  const sessionId = clean(sessionIdInput);
  const store = readStore();
  const session = store.sessions.find((candidate) => candidate.id === sessionId);
  if (!session) return [];
  const associations = store.associations.filter((row) => row.sessionId === session.id);
  const endedAtMs = session.endedAt ? Date.parse(session.endedAt) : Number.POSITIVE_INFINITY;
  return session.reachedPeerIds.map((peerId) => {
    const peerAssociations = associations.filter((row) => row.peerId === peerId);
    const results = session.results.filter((row) => row.peerId === peerId);
    const latest = [...latestResultsByPair(results).values()];
    const repliedTalkIds = new Set(latest.map((row) => row.talkId));
    const review = session.peerReviews?.[peerId];
    return {
      peerId,
      talkIds: [...new Set(peerAssociations.map((row) => row.talkId))],
      pending: peerAssociations.filter((row) => !repliedTalkIds.has(row.talkId)).length,
      results,
      latestOutcomes: latest.map((result) => ({
        talkId: result.talkId,
        outcome: result.outcome,
        capturedAt: result.capturedAt,
        late: Date.parse(result.capturedAt) > endedAtMs,
      })),
      pinned: Boolean(review?.pinned),
      dismissed: Boolean(review?.dismissed),
      note: clean(review?.note),
      encounterDistancesMeters: peerAssociations.flatMap((row) => (
        row.encounterDistanceMeters === undefined ? [] : [row.encounterDistanceMeters]
      )),
    };
  });
}

export function updateMatchCollectionPeerReview(
  sessionIdInput: string,
  peerIdInput: string,
  patch: MatchCollectionPeerReview,
): MatchCollectionSession | null {
  const sessionId = clean(sessionIdInput);
  const peerId = clean(peerIdInput);
  const store = readStore();
  const session = store.sessions.find((candidate) => candidate.id === sessionId);
  if (!session || !peerId || !session.reachedPeerIds.includes(peerId)) return null;
  const previous = session.peerReviews?.[peerId] ?? {};
  const note = patch.note === undefined ? clean(previous.note) : clean(patch.note).slice(0, 2_000);
  const nextReview: MatchCollectionPeerReview = {
    ...(patch.pinned ?? previous.pinned ? { pinned: true } : {}),
    ...(patch.dismissed ?? previous.dismissed ? { dismissed: true } : {}),
    ...(note ? { note } : {}),
  };
  const peerReviews = { ...session.peerReviews, [peerId]: nextReview };
  const next = { ...session, peerReviews };
  store.sessions = store.sessions.map((candidate) => candidate.id === session.id ? next : candidate);
  writeStore(store);
  return next;
}

export function formatMatchCollectionDuration(elapsedMs: number): string {
  const minutes = Math.max(0, Math.floor(elapsedMs / 60_000));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder ? `${hours}h ${remainder}m` : `${hours}h`;
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
  location?: { source: MatchCollectionLocationSample['source']; point?: MatchCollectionPoint };
  peerPoints?: Record<string, MatchCollectionPoint>;
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
  const locationPoint = input.location?.point && validPoint(input.location.point) ? input.location.point : undefined;
  const previousPoint = [...(session.locationSamples ?? [])].reverse().find((sample) => sample.point)?.point;
  const areaChanged = Boolean(locationPoint && previousPoint && (
    locationPoint.latitude !== previousPoint.latitude
    || locationPoint.longitude !== previousPoint.longitude
    || locationPoint.precisionMeters !== previousPoint.precisionMeters
  ));
  const locationSample: MatchCollectionLocationSample | undefined = input.location ? {
    id: `location_${now.getTime().toString(36)}_${(session.locationSamples?.length ?? 0).toString(36)}`,
    capturedAt: sentAt,
    source: input.location.source,
    ...(locationPoint ? { point: { ...locationPoint }, precisionMeters: locationPoint.precisionMeters } : {}),
    ...(areaChanged ? { areaChanged: true } : {}),
  } : undefined;
  const pairKeys = new Set(intendedPairs.map(({ talkId, peerId }) => `${peerId}\u0000${talkId}`));
  store.associations = [
    ...store.associations.filter((row) => !pairKeys.has(`${row.peerId}\u0000${row.talkId}`)),
    ...intendedPairs.map(({ talkId, peerId }) => {
      const peerPoint = input.peerPoints?.[peerId];
      const encounterDistanceMeters = locationPoint && validPoint(peerPoint)
        ? Math.round(distanceMeters(locationPoint, peerPoint))
        : undefined;
      return {
        sessionId: session.id,
        talkId,
        peerId,
        sentAt,
        ...(locationSample ? { locationSampleId: locationSample.id } : {}),
        ...(encounterDistanceMeters !== undefined ? { encounterDistanceMeters } : {}),
      };
    }),
  ];
  const reachedPeerIds = [...new Set([...session.reachedPeerIds, ...intendedPairs.map((pair) => pair.peerId)])];
  const next = {
    ...session,
    talkIds: [...new Set([...session.talkIds, ...talkIds])],
    reachedPeerIds,
    ...(locationSample ? { locationSamples: [...(session.locationSamples ?? []), locationSample].slice(-500) } : {}),
  };
  store.sessions = store.sessions.map((candidate) => candidate.id === session.id ? next : candidate);
  writeStore(store);
  return next;
}

function distanceMeters(
  first: Pick<MatchCollectionPoint, 'latitude' | 'longitude'>,
  second: Pick<MatchCollectionPoint, 'latitude' | 'longitude'>,
): number {
  const earthRadiusMeters = 6_371_000;
  const radians = (degrees: number) => degrees * Math.PI / 180;
  const latitudeDelta = radians(second.latitude - first.latitude);
  const longitudeDelta = radians(second.longitude - first.longitude);
  const a = Math.sin(latitudeDelta / 2) ** 2
    + Math.cos(radians(first.latitude)) * Math.cos(radians(second.latitude))
    * Math.sin(longitudeDelta / 2) ** 2;
  return 2 * earthRadiusMeters * Math.asin(Math.sqrt(a));
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
  // Preserve the timeline: a peer can revise an answer, or the same Talk can be encountered more
  // than once during one outing. G4's review must not collapse those events to latest-only.
  const results = [...session.results, { peerId, talkId, outcome, capturedAt }]
    .slice(-MAX_RESULTS_PER_SESSION);
  store.sessions = store.sessions.map((candidate) => candidate.id === session.id ? { ...session, results } : candidate);
  writeStore(store);
  return {
    collectionSessionId: session.id,
    collectionLabel: session.label,
    collectionStartedAt: session.startedAt,
  };
}
