import {
  PLACE_CHAT_PAGE_SIZE,
  parsePlaceChatMessage,
  type PlaceChatMessage,
  type PlaceChatPage,
} from '../../shared/place-chat';

export const PLACE_CHAT_POLL_MS = 5_000;

type FetchLike = typeof fetch;

/** HTTP client for OPEN-80's bounded recent Place feed. */
export class PlaceChatClient {
  constructor(
    private readonly apiBase: () => string,
    private readonly fetchImpl: FetchLike = fetch,
  ) {}

  async page(placeId: string, after?: string): Promise<PlaceChatPage> {
    const params = new URLSearchParams({ limit: String(PLACE_CHAT_PAGE_SIZE) });
    if (after) params.set('after', after);
    const response = await this.fetchImpl(
      `${this.apiBase()}/api/chatrooms/${encodeURIComponent(placeId)}/messages?${params.toString()}`,
      { cache: 'no-store' },
    );
    if (!response.ok) throw new Error(`Place chat read failed (${response.status})`);
    const body = (await response.json()) as { messages?: unknown; cursor?: unknown; dropped?: unknown };
    return {
      messages: Array.isArray(body.messages)
        ? body.messages.map(parsePlaceChatMessage).filter((message): message is PlaceChatMessage => message !== null)
        : [],
      cursor: typeof body.cursor === 'string' ? body.cursor : '',
      dropped: body.dropped === true,
    };
  }

  async send(placeId: string, message: PlaceChatMessage): Promise<PlaceChatMessage> {
    const response = await this.fetchImpl(
      `${this.apiBase()}/api/chatrooms/${encodeURIComponent(placeId)}/messages`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(message),
      },
    );
    if (!response.ok) throw new Error(`Place chat send failed (${response.status})`);
    const body = (await response.json()) as { message?: unknown };
    const stored = parsePlaceChatMessage(body.message);
    if (!stored) throw new Error('Place chat server returned an invalid message');
    return stored;
  }

  /** Recursive polling prevents overlapping requests on a slow phone. */
  subscribe(
    placeId: string,
    onMessages: (messages: readonly PlaceChatMessage[], dropped: boolean) => void,
    onError: (error: unknown) => void = () => undefined,
  ): () => void {
    let active = true;
    let cursor: string | undefined;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const poll = async () => {
      try {
        const page = await this.page(placeId, cursor);
        if (!active) return;
        if (page.cursor) cursor = page.cursor;
        if (page.messages.length || page.dropped) onMessages(page.messages, page.dropped);
      } catch (error) {
        if (active) onError(error);
      } finally {
        if (active) timer = setTimeout(() => { void poll(); }, PLACE_CHAT_POLL_MS);
      }
    };
    void poll();
    return () => {
      active = false;
      if (timer) clearTimeout(timer);
    };
  }
}
