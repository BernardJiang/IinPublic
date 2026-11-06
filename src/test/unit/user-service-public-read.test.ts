import { AGE_VERIFICATION_PUBLIC_READ_MS, UserService } from '../../server/services/user-service';
import type { GunService } from '../../server/services/gun-service';

/** An embedded node's hub requests give up at this point (embedded-hub-relay-client.ts). */
const EMBEDDED_RELAY_LIMIT_MS = 2_500;

describe('public user read', () => {
  it('stays inside the embedded relay limit for someone with no age-verification record', async () => {
    const getPath = jest.fn(async () => null);
    const service = new UserService({
      getOptional: async (key: string) => (key === 'users/person' ? { id: 'person', stageName: 'Person', pub: 'p', epub: 'e', reputation: {} } : null),
      getPath,
    } as unknown as GunService);

    await service.getUser('person', { viewerId: null });

    const [, , waitMs] = getPath.mock.calls[0] as unknown as [string[], number, number];
    expect(AGE_VERIFICATION_PUBLIC_READ_MS).toBeLessThan(EMBEDDED_RELAY_LIMIT_MS / 2);
    expect(waitMs).toBe(AGE_VERIFICATION_PUBLIC_READ_MS);
  });
});
