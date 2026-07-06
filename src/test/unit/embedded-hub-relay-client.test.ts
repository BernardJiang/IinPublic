import {
  assertRelayMetadataPath,
  EmbeddedHubRelayClient,
} from '../../node-app/embedded-hub-relay-client';

describe('EmbeddedHubRelayClient', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('allows only relay metadata paths through the explicit hub channel', () => {
    expect(() => assertRelayMetadataPath(['chatrooms', 'global', 'users', 'alice'])).not.toThrow();

    for (const path of [
      ['talks', 'talk_1'],
      ['conversations', 'conv_1'],
      ['pairConversations', 'alice__bob', 'conv_1'],
      ['pairTalkResponses', 'alice__bob', 'talk_1'],
      ['incomingTalksByUser', 'bob', 'talk_1'],
      ['ownerIncomingTalkIndex', 'bob', 'talk_1'],
    ]) {
      expect(() => assertRelayMetadataPath(path)).toThrow(/refuses non-metadata path/);
    }
  });

  it('fetches and normalizes hub room members', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => [
        { userId: 'alice', stageName: 'Alice' },
        { userId: 'bob' },
        { userId: '' },
      ],
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const client = new EmbeddedHubRelayClient({
      upstreamHubBaseUrl: 'http://127.0.0.1:8080/',
      requestTimeoutMs: 500,
    });

    await expect(client.listMembers('global')).resolves.toEqual([
      { userId: 'alice', stageName: 'Alice' },
      { userId: 'bob', stageName: 'bob' },
    ]);
    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:8080/api/chatrooms/global/members',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it('posts membership metadata to the hub route', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const client = new EmbeddedHubRelayClient({
      upstreamHubBaseUrl: 'http://127.0.0.1:8080',
      requestTimeoutMs: 500,
    });

    await client.addMember('global', 'alice', 'Alice');
    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:8080/api/chatrooms/global/members',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: 'alice', stageName: 'Alice' }),
      }),
    );
  });
});
