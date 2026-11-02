import { LanGunDiscovery, isUsableLanAddress } from '../../server/services/lan-gun-discovery';

const mockBonjour = jest.fn();

jest.mock('bonjour-service', () => ({
  Bonjour: jest.fn().mockImplementation((...args: unknown[]) => {
    mockBonjour(...args);
    return {
      publish: () => ({ stop: () => undefined }),
      find: () => ({ stop: () => undefined }),
      destroy: () => undefined,
    };
  }),
}));

describe('LAN Gun discovery', () => {
  test.each(['10.0.0.2', '172.16.0.2', '172.31.255.254', '192.168.10.48', '169.254.1.2'])(
    'accepts private/link-local IPv4 address %s',
    (address) => expect(isUsableLanAddress(address)).toBe(true),
  );

  test.each(['127.0.0.1', '8.8.8.8', '172.32.0.1', '::1', 'bad-address'])(
    'rejects loopback/public/invalid address %s',
    (address) => expect(isUsableLanAddress(address)).toBe(false),
  );

  // C10, 1.0.217: a phone answered an mDNS query with no network and Node exited with status 7.
  test('an mDNS send failure does not throw out of discovery', () => {
    mockBonjour.mockClear();
    const discovery = new LanGunDiscovery({}, 8088);
    discovery.start();

    const onError = mockBonjour.mock.calls[0]?.[1] as ((error: Error) => void) | undefined;
    expect(onError).toEqual(expect.any(Function));
    const error = Object.assign(new Error('send ENETUNREACH 224.0.0.251:5353'), { code: 'ENETUNREACH' });
    expect(() => onError?.(error)).not.toThrow();
    discovery.stop();
  });
});
