import { PlaceChatClient } from '../../web/services/place-chat-client';

const stored = {
  id: 'message_1',
  text: 'hello',
  senderId: 'person_1',
  senderName: 'Person 1',
  timestamp: '2027-01-15T08:00:00.000Z',
};

describe('PlaceChatClient', () => {
  it('reads bounded pages with the cursor and posts messages through HTTP', async () => {
    const fetchMock = jest.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ messages: [stored], cursor: 'boot:1', dropped: false }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ message: stored }), { status: 201 }));
    const client = new PlaceChatClient(() => 'https://hub.test', fetchMock as typeof fetch);

    await expect(client.page('place_a')).resolves.toEqual({ messages: [stored], cursor: 'boot:1', dropped: false });
    await expect(client.send('place_a', stored)).resolves.toEqual(stored);
    expect(fetchMock.mock.calls[0]?.[0]).toContain('/api/chatrooms/place_a/messages?limit=50');
    expect(fetchMock.mock.calls[1]?.[1]).toEqual(expect.objectContaining({ method: 'POST' }));
  });
});
