import { randomBytes } from 'crypto';
import {
  clampPlaceChatPageLimit,
  parsePlaceChatMessage,
  type PlaceChatMessage,
  type PlaceChatPage,
} from '../../shared/place-chat';

type StoredMessage = PlaceChatMessage & { sequence: number };
type Feed = { messages: StoredMessage[]; nextSequence: number; touchedAt: number };

/**
 * Recent, deliberately ephemeral Place chat. The limit bounds both server memory and the amount
 * recoverable by a newly opened client; a restart clearing a casual public feed is preferable to
 * rebuilding the old unbounded replicated history.
 */
export class PlaceChatStore {
  private readonly feeds = new Map<string, Feed>();
  private readonly bootId = randomBytes(8).toString('hex');

  constructor(
    private readonly maxMessagesPerPlace: number,
    private readonly maxPlaces = 2_048,
  ) {
    if (!Number.isSafeInteger(maxMessagesPerPlace) || maxMessagesPerPlace < 1) {
      throw new Error('maxMessagesPerPlace must be a positive integer');
    }
  }

  append(placeId: string, value: unknown): PlaceChatMessage {
    const message = parsePlaceChatMessage(value);
    if (!message) throw new Error('invalid Place chat message');
    const feed = this.feed(placeId);
    const duplicate = feed.messages.find((row) => row.id === message.id);
    if (duplicate) return this.publicMessage(duplicate);
    feed.messages.push({ ...message, sequence: feed.nextSequence++ });
    if (feed.messages.length > this.maxMessagesPerPlace) {
      feed.messages.splice(0, feed.messages.length - this.maxMessagesPerPlace);
    }
    feed.touchedAt = Date.now();
    return message;
  }

  read(placeId: string, input: { after?: string; limit?: unknown } = {}): PlaceChatPage {
    const feed = this.feeds.get(placeId);
    if (!feed) return { messages: [], cursor: `${this.bootId}:0`, dropped: false };
    feed.touchedAt = Date.now();
    const limit = clampPlaceChatPageLimit(input.limit);
    const after = this.parseCursor(input.after);
    const candidates = after === null
      ? feed.messages
      : feed.messages.filter((message) => message.sequence > after);
    const dropped = candidates.length > limit;
    // Recency wins: if a busy feed outruns one poll, omit the middle instead of making the client
    // download an unbounded catch-up backlog.
    const page = candidates.slice(-limit).map((message) => this.publicMessage(message));
    const latest = feed.messages.at(-1)?.sequence ?? 0;
    return { messages: page, cursor: `${this.bootId}:${latest}`, dropped };
  }

  retained(placeId: string): number {
    return this.feeds.get(placeId)?.messages.length ?? 0;
  }

  private feed(placeId: string): Feed {
    const existing = this.feeds.get(placeId);
    if (existing) return existing;
    if (this.feeds.size >= this.maxPlaces) {
      const oldest = [...this.feeds.entries()].sort((a, b) => a[1].touchedAt - b[1].touchedAt)[0]?.[0];
      if (oldest) this.feeds.delete(oldest);
    }
    const created: Feed = { messages: [], nextSequence: 1, touchedAt: Date.now() };
    this.feeds.set(placeId, created);
    return created;
  }

  private parseCursor(cursor: string | undefined): number | null {
    if (!cursor) return null;
    const [bootId, rawSequence, extra] = cursor.split(':');
    const sequence = Number.parseInt(rawSequence || '', 10);
    return !extra && bootId === this.bootId && Number.isSafeInteger(sequence) && sequence >= 0
      ? sequence
      : null;
  }

  private publicMessage(message: StoredMessage): PlaceChatMessage {
    const { sequence: _sequence, ...plain } = message;
    return plain;
  }
}
