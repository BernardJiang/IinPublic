import { isUsableLanAddress } from '../../server/services/lan-gun-discovery';

describe('LAN Gun discovery', () => {
  test.each(['10.0.0.2', '172.16.0.2', '172.31.255.254', '192.168.10.48', '169.254.1.2'])(
    'accepts private/link-local IPv4 address %s',
    (address) => expect(isUsableLanAddress(address)).toBe(true),
  );

  test.each(['127.0.0.1', '8.8.8.8', '172.32.0.1', '::1', 'bad-address'])(
    'rejects loopback/public/invalid address %s',
    (address) => expect(isUsableLanAddress(address)).toBe(false),
  );
});
