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
        { userId: 'alice', stageName: 'Alice', isTraveler: true },
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
      { userId: 'alice', stageName: 'Alice', isTraveler: true },
      { userId: 'bob', stageName: 'bob' },
    ]);
    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:8080/api/chatrooms/global/members',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it('publishes and lists rooms at the hub, keeping the hub status', async () => {
    const fetchMock = jest.fn()
      .mockResolvedValueOnce({ status: 400, json: async () => ({ error: 'invalid place signature' }) })
      .mockResolvedValueOnce({ ok: true, json: async () => [{ id: 'place_a' }] });
    global.fetch = fetchMock as unknown as typeof fetch;
    const client = new EmbeddedHubRelayClient({ upstreamHubBaseUrl: 'http://127.0.0.1:8080' });

    await expect(client.publishChatroom({ name: 'X' })).resolves.toEqual({
      status: 400,
      body: { error: 'invalid place signature' },
    });
    expect(fetchMock.mock.calls[0][0]).toBe('http://127.0.0.1:8080/api/chatrooms');
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: 'POST', body: JSON.stringify({ name: 'X' }) });
    await expect(client.listChatrooms()).resolves.toEqual([{ id: 'place_a' }]);
  });

  it('waits longer than the default timeout for room membership (empty rooms answer in ~2.6 s)', async () => {
    jest.useFakeTimers();
    try {
      let aborted = false;
      global.fetch = jest.fn((_url: string, init: RequestInit) => new Promise((resolve, reject) => {
        init.signal?.addEventListener('abort', () => { aborted = true; reject(new Error('aborted')); });
        setTimeout(() => resolve({ ok: true, json: async () => [] } as unknown as Response), 3_000);
      })) as unknown as typeof fetch;
      const client = new EmbeddedHubRelayClient({ upstreamHubBaseUrl: 'http://127.0.0.1:8080' });
      const pending = client.listMembers('place_bx');
      await jest.advanceTimersByTimeAsync(3_000);
      await expect(pending).resolves.toEqual([]);
      expect(aborted).toBe(false);
    } finally {
      jest.useRealTimers();
    }
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

    await client.addMember('global', 'alice', 'Alice', true);
    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:8080/api/chatrooms/global/members',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: 'alice', stageName: 'Alice', isTraveler: true }),
      }),
    );
  });

  it('fetches and normalizes hub TechSupport messages', async () => {
    const message = {
      id: 'support_1',
      conversationId: 'conv_support_iinpublic-root-techsupport_alice',
      senderId: 'alice',
      text: 'hello',
      timestamp: '2026-09-16T00:00:00.000Z',
      channel: 'public',
    };
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ messages: [message, null, 'not-an-object'] }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const client = new EmbeddedHubRelayClient({
      upstreamHubBaseUrl: 'http://127.0.0.1:8080',
      requestTimeoutMs: 500,
    });

    await expect(client.listSupportMessages(message.conversationId)).resolves.toEqual([message]);
    expect(fetchMock).toHaveBeenCalledWith(
      `http://127.0.0.1:8080/api/support/messages/${encodeURIComponent(message.conversationId)}`,
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it('posts a TechSupport message to the hub route', async () => {
    const message = {
      id: 'support_1',
      conversationId: 'conv_support_iinpublic-root-techsupport_alice',
      senderId: 'alice',
      text: 'hello',
      timestamp: '2026-09-16T00:00:00.000Z',
      channel: 'public',
    };
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ stored: true, message }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const client = new EmbeddedHubRelayClient({
      upstreamHubBaseUrl: 'http://127.0.0.1:8080',
      requestTimeoutMs: 500,
    });

    await client.postSupportMessage(message.conversationId, message);
    expect(fetchMock).toHaveBeenCalledWith(
      `http://127.0.0.1:8080/api/support/messages/${encodeURIComponent(message.conversationId)}`,
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(message),
      }),
    );
  });

  it('forwards only Nearby, room-list and bounded Place-chat paths and preserves hub status', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      status: 409,
      json: async () => ({ code: 'target-full', error: 'Nearby target cohort is full' }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;
    const client = new EmbeddedHubRelayClient({
      upstreamHubBaseUrl: 'http://127.0.0.1:8080',
      requestTimeoutMs: 500,
    });

    await expect(client.forwardHubApi('/api/nearby/v3/card', 'POST', { claim: 'signed' }))
      .resolves.toEqual({ status: 409, body: { code: 'target-full', error: 'Nearby target cohort is full' } });
    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:8080/api/nearby/v3/card',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ claim: 'signed' }),
      }),
    );
    await expect(client.forwardHubApi('/api/chatrooms/place_1/messages?limit=50', 'GET'))
      .resolves.toEqual({ status: 409, body: { code: 'target-full', error: 'Nearby target cohort is full' } });
    expect(fetchMock).toHaveBeenLastCalledWith(
      'http://127.0.0.1:8080/api/chatrooms/place_1/messages?limit=50',
      expect.objectContaining({ method: 'GET' }),
    );
    await expect(client.forwardHubApi('/api/talks/private', 'GET'))
      .rejects.toThrow(/refuses path/);
    await expect(client.forwardHubApi('/api/nearby-cohorts/reservations', 'POST'))
      .rejects.toThrow(/refuses path/);
  });
});
