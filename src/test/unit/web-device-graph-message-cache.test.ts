/** @jest-environment jsdom */

import { mergeMessagesWithGraph } from '../../web/services/web-device-sync-message-cache';

describe('device-graph conversation message projection', () => {
  beforeEach(() => localStorage.clear());

  it('renders graph-only history and lets the live copy supply delivery state', () => {
    const graph = [
      {
        eventId: 'event-1',
        when: 1_000,
        direction: 'sent' as const,
        otherUserId: 'eve',
        text: 'older graph message',
        sourceMessageId: 'message-1',
        talkId: 'talk-1',
      },
      {
        eventId: 'event-2',
        when: 2_000,
        direction: 'received' as const,
        otherUserId: 'eve',
        text: 'graph-only reply',
      },
    ];
    const live = [{
      id: 'message-1',
      senderId: 'me',
      text: 'older graph message',
      timestamp: new Date(1_000),
      deliveryState: 'sent',
    }];

    expect(mergeMessagesWithGraph('conversation-1', live, graph, 'me')).toEqual([
      expect.objectContaining({ id: 'message-1', deliveryState: 'sent' }),
      expect.objectContaining({
        id: 'graph:event-2',
        graphEventId: 'event-2',
        senderId: 'eve',
        text: 'graph-only reply',
      }),
    ]);
  });
});
