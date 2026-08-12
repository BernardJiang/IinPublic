import type { Talk } from '../../shared/types';

export type ReceivedTalkSource = { listReceivedTalksFromGun: () => Promise<Talk[]> };
export type IncomingTalkRenderer = (value: {
  id: string;
  title: string;
  authorName: string;
  type: Talk['type'];
  questionCount: number;
  timestamp: string;
  isOwnTalk: false;
  fullTalk: Talk;
}) => void;

/** Rebuilds accepted incoming-Talk UI solely from the local Gun graph. */
export async function restoreReceivedTalkHistory(
  source: ReceivedTalkSource,
  render: IncomingTalkRenderer,
): Promise<number> {
  const seen = new Set<string>();
  let restored = 0;
  for (const talk of await source.listReceivedTalksFromGun()) {
    if (!talk?.id || seen.has(talk.id)) continue;
    seen.add(talk.id);
    render({
      id: talk.id,
      title: talk.title || 'Talk',
      authorName: String((talk as Talk & { authorName?: string }).authorName || 'Unknown'),
      type: talk.type,
      questionCount: Array.isArray(talk.questions) ? talk.questions.length : 0,
      timestamp: talk.createdAt instanceof Date ? talk.createdAt.toISOString() : String(talk.createdAt || ''),
      isOwnTalk: false,
      fullTalk: talk,
    });
    restored += 1;
  }
  return restored;
}

