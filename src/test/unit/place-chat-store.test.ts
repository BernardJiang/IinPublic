import { PlaceChatStore } from '../../server/services/place-chat-store';
import { PLACE_CHAT_PAGE_SIZE } from '../../shared/place-chat';

function message(index: number) {
  return {
    id: `message_${index}`,
    text: `hello ${index}`,
    senderId: `person_${index}`,
    senderName: `Person ${index}`,
    timestamp: new Date(1_800_000_000_000 + index).toISOString(),
  };
}

describe('bounded Place chat store (OPEN-80)', () => {
  it('retains a bounded recent window and returns only one page after 10,000 messages', () => {
    const capacity = 498;
    const store = new PlaceChatStore(capacity * 4);
    for (let index = 0; index < 10_000; index += 1) store.append('place_test', message(index));

    const page = store.read('place_test');
    expect(store.retained('place_test')).toBe(capacity * 4);
    expect(page.messages).toHaveLength(PLACE_CHAT_PAGE_SIZE);
    expect(page.messages[0]?.id).toBe('message_9950');
    expect(page.messages.at(-1)?.id).toBe('message_9999');
    expect(page.dropped).toBe(true);
  });

  it('uses an opaque cursor, deduplicates ids, and drops an overrun rather than syncing it all', () => {
    const store = new PlaceChatStore(100);
    store.append('place_test', message(1));
    store.append('place_test', message(1));
    const first = store.read('place_test');
    expect(first.messages.map((row) => row.id)).toEqual(['message_1']);

    for (let index = 2; index <= 80; index += 1) store.append('place_test', message(index));
    const next = store.read('place_test', { after: first.cursor, limit: 10 });
    expect(next.messages).toHaveLength(10);
    expect(next.messages[0]?.id).toBe('message_71');
    expect(next.messages.at(-1)?.id).toBe('message_80');
    expect(next.dropped).toBe(true);
  });

  it('rejects malformed or oversized public messages', () => {
    const store = new PlaceChatStore(10);
    expect(() => store.append('place_test', { ...message(1), text: 'x'.repeat(2_001) })).toThrow(
      'invalid Place chat message',
    );
  });
});
