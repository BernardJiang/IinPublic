/**
 * Incoming clusters store talkIds as { [talkId]: isoTimestamp }. Keys may be UUIDs or
 * content-hash ids (`qa_` + 8 hex). Gun.js may nest or wrap that map.
 */
export const TALK_UUID_KEY =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Content-derived talk id (same as computeTalkIdFromTalkData / server identity key). */
export const TALK_CONTENT_HASH_ID = /^qa_[0-9a-f]{8}$/i;

/** Legacy UUID or content-hash talk id. */
export function isValidTalkId(id: string | undefined | null): boolean {
  if (typeof id !== 'string') return false;
  const t = id.trim();
  return TALK_UUID_KEY.test(t) || TALK_CONTENT_HASH_ID.test(t);
}

/** @deprecated use isValidTalkId */
export function isTalkUuid(id: string | undefined | null): boolean {
  return isValidTalkId(id);
}

function isTalkIdMapKey(k: string): boolean {
  return TALK_UUID_KEY.test(k) || TALK_CONTENT_HASH_ID.test(k);
}

function visitTalkIdsNode(node: unknown, out: Record<string, string>): void {
  if (node == null || typeof node !== 'object') return;
  const n = node as Record<string, unknown>;
  if (n._isArray) {
    const len = Number(n._length) || 0;
    for (let i = 0; i < len; i++) {
      if (Object.prototype.hasOwnProperty.call(n, String(i))) visitTalkIdsNode(n[String(i)], out);
    }
    return;
  }
  for (const [k, v] of Object.entries(n)) {
    if (k.startsWith('_')) continue;
    if (isTalkIdMapKey(k)) {
      out[k] = v != null && (typeof v === 'string' || typeof v === 'number') ? String(v) : '';
    } else if (typeof v === 'object' && v !== null) {
      visitTalkIdsNode(v, out);
    }
  }
}

/** Flat map talkId -> timestamp string from raw cluster.talkIds (any Gun shape). */
export function collectTalkIdTimestamps(talkIdsRaw: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  visitTalkIdsNode(talkIdsRaw, out);
  return out;
}

function firstLastTalkIdFromSenders(sendersRaw: unknown): string {
  if (!sendersRaw || typeof sendersRaw !== 'object') return '';
  const root = sendersRaw as Record<string, unknown>;
  const rows: unknown[] = [];
  if (root._isArray) {
    const len = Number(root._length) || 0;
    for (let i = 0; i < len; i++) {
      if (Object.prototype.hasOwnProperty.call(root, String(i))) rows.push(root[String(i)]);
    }
  } else {
    for (const [k, v] of Object.entries(root)) {
      if (!k.startsWith('_')) rows.push(v);
    }
  }
  for (const s of rows) {
    if (s && typeof s === 'object' && (s as { lastTalkId?: string }).lastTalkId) {
      return String((s as { lastTalkId: string }).lastTalkId);
    }
  }
  return '';
}

/** Latest talk UUID by timestamp, or from senders[].lastTalkId, or ''. */
export function pickLatestTalkIdFromIncomingCluster(cluster: {
  latestTalkId?: unknown;
  talkIds?: unknown;
  senders?: unknown;
}): string {
  const rawLatest =
    cluster?.latestTalkId != null && cluster.latestTalkId !== ''
      ? String(cluster.latestTalkId).trim()
      : '';
  if (rawLatest && isValidTalkId(rawLatest)) return rawLatest;

  const map = collectTalkIdTimestamps(cluster?.talkIds);
  const keys = Object.keys(map);
  if (keys.length > 0) {
    return keys.sort(
      (a, b) => new Date(String(map[b] || 0)).getTime() - new Date(String(map[a] || 0)).getTime(),
    )[0];
  }
  return firstLastTalkIdFromSenders(cluster?.senders);
}
