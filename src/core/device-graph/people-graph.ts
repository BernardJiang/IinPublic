/**
 * People in the device graph (spec §31.6). A person is keyed by user ID, not by public key or stage
 * name (owner decision 2026-11-03): one person may hold several user IDs, one per device or one used
 * over Wi-Fi Direct, and each user ID has its own public key, which signs that user's records and
 * receives the keys of what they are sent.
 *
 *   person/<userId>   { userId, pub?, firstSeen }     state; pub is filled in once it is known
 */
import type { GraphNode, NodeStore } from './node-store';

export const personSoul = (prefix: string, userId: string) => `${prefix}person/${encodeURIComponent(userId)}`;

/** The user ID a `person/…` soul names, or '' for any other soul. */
export function personIdOf(prefix: string, soul: string | undefined): string {
  const head = `${prefix}person/`;
  return soul && soul.startsWith(head) ? decodeURIComponent(soul.slice(head.length)) : '';
}

/**
 * The writes that make these people known: a new person node, or the public key added to one that
 * lacked it. Nothing for people already complete, so a repeat arrival writes no person.
 */
export async function personWrites(
  store: NodeStore,
  prefix: string,
  people: Array<{ userId: string; pub?: string | undefined }>,
  when: number,
): Promise<Array<[string, GraphNode]>> {
  const unique = new Map<string, string | undefined>();
  for (const person of people) {
    if (!person.userId) continue;
    unique.set(person.userId, person.pub || unique.get(person.userId));
  }
  const out: Array<[string, GraphNode]> = [];
  await Promise.all([...unique].map(async ([userId, pub]) => {
    const soul = personSoul(prefix, userId);
    const known = await store.get(soul);
    if (!known) out.push([soul, pub ? { userId, pub, firstSeen: when } : { userId, firstSeen: when }]);
    else if (pub && !known.pub) out.push([soul, { pub }]);
  }));
  return out;
}

/** A person's public key, if this device knows it. */
export async function personPub(store: NodeStore, prefix: string, userId: string): Promise<string | undefined> {
  const node = await store.get(personSoul(prefix, userId));
  return typeof node?.pub === 'string' && node.pub ? node.pub : undefined;
}
