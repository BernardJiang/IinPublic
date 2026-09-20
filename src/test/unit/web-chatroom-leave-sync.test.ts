/** @jest-environment jsdom */

import { WebChatroomService } from '../../web/services/web-chatroom-service';

function gunChain(): any {
  const chain: any = {
    get: jest.fn(() => chain),
    put: jest.fn((_value: unknown, callback?: (ack: Record<string, unknown>) => void) => {
      callback?.({ ok: 1 });
      return chain;
    }),
  };
  return chain;
}

describe('WebChatroomService leave relay synchronization', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('deletes the server fast-index membership after writing the local inactive record', async () => {
    const gun = gunChain();
    const fetchMock = jest.fn().mockResolvedValue({ ok: true });
    global.fetch = fetchMock as typeof fetch;
    const service = new WebChatroomService({ getGun: () => gun } as any);

    await service.leaveChatroom('room / one', 'user / one');

    expect(gun.put).toHaveBeenCalledWith(
      expect.objectContaining({ isActive: false, leftAt: expect.any(String) }),
      expect.any(Function),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringMatching(/\/api\/chatrooms\/room%20%2F%20one\/members\/user%20%2F%20one$/),
      expect.objectContaining({ method: 'DELETE', signal: expect.any(AbortSignal) }),
    );
  });

  it('keeps offline-first leave successful when the server index is unavailable', async () => {
    const gun = gunChain();
    global.fetch = jest.fn().mockRejectedValue(new Error('offline')) as typeof fetch;
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    const service = new WebChatroomService({ getGun: () => gun } as any);

    await expect(service.leaveChatroom('global', 'user-1')).resolves.toBeUndefined();
    expect(gun.put).toHaveBeenCalled();
  });
});
