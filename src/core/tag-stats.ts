/**
 * Live tag statistics (OPEN-113): one model, read by three views — a person's relationship with me
 * on Contacts, a tag's popularity on Talks and on Me. Pure over the person↔tag graph
 * (`tag-graph.ts`), which holds only what this device exchanged; nothing is counted on the hub.
 */
import type { TagGraph, TagNode } from './tag-graph';

export type TagPopularity = { likes: number; passes: number; /** 1 = most liked; 0 when nobody likes it. */ rank: number };
export type PersonSimilarity = {
  /** Tags we both like. */
  shared: number;
  /** shared ÷ every tag either of us likes, 0..1. */
  score: number;
  /** 1 = most alike (most tags in common, then % alike) among people I share a tag with; 0 if none. */
  rank: number;
};

/** Each tag's likes, passes and rank by likes (equal likes share a rank). */
export function tagPopularity(graph: TagGraph): Map<TagNode, TagPopularity> {
  const nodes = Array.from(new Set(graph.tags.values()));
  const ranked = nodes.filter((node) => node.likers.size > 0).sort((a, b) => b.likers.size - a.likers.size);
  const result = new Map<TagNode, TagPopularity>();
  let rank = 0;
  let previous = -1;
  ranked.forEach((node, index) => {
    if (node.likers.size !== previous) { rank = index + 1; previous = node.likers.size; }
    result.set(node, { likes: node.likers.size, passes: node.passers.size, rank });
  });
  for (const node of nodes) if (!result.has(node)) result.set(node, { likes: 0, passes: node.passers.size, rank: 0 });
  return result;
}

/** How alike each person is to me, by the tags we both like; ranked, most tags in common first. */
export function personSimilarity(graph: TagGraph): Map<string, PersonSimilarity> {
  const nodes = Array.from(new Set(graph.tags.values()));
  const mine = nodes.filter((node) => node.mine).length;
  const theirs = new Map<string, number>();
  const shared = new Map<string, number>();
  for (const node of nodes) {
    for (const peerId of node.likers.keys()) {
      theirs.set(peerId, (theirs.get(peerId) ?? 0) + 1);
      if (node.mine) shared.set(peerId, (shared.get(peerId) ?? 0) + 1);
    }
  }
  const rows = Array.from(theirs.keys()).map((peerId) => {
    const both = shared.get(peerId) ?? 0;
    const union = mine + (theirs.get(peerId) ?? 0) - both;
    return { peerId, shared: both, score: union > 0 ? both / union : 0 };
  });
  // Most tags in common first (what "most similar" means on Contacts); % alike breaks ties.
  rows.sort((a, b) => b.shared - a.shared || b.score - a.score || a.peerId.localeCompare(b.peerId));
  const result = new Map<string, PersonSimilarity>();
  let rank = 0;
  let previous: string | null = null;
  let position = 0;
  for (const row of rows) {
    if (row.shared === 0) { result.set(row.peerId, { shared: 0, score: 0, rank: 0 }); continue; }
    position += 1;
    const key = `${row.score}|${row.shared}`;
    if (key !== previous) { rank = position; previous = key; }
    result.set(row.peerId, { shared: row.shared, score: row.score, rank });
  }
  return result;
}
