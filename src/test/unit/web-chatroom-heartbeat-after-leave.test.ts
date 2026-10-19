/** @jest-environment jsdom */

/**
 * Found 2026-10-19 by phone-path J-PLACE-11 once Nearby became a personal list (leaving a Place got
 * faster): a Place heartbeat signs an admission claim before its PATCH. When the user left during
 * the signing, the PATCH still went out, re-added them at the hub and marked the Place visited.
 */
import { TextEncoder } from 'node:util';
import { WebChatroomService } from '../../web/services/web-chatroom-service';

Object.defineProperty(globalThis, 'TextEncoder', { value: TextEncoder, configurable: true });

describe('Place membership heartbeat after leaving', () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('sends no PATCH when the user left while the claim was being signed', async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    const service = new WebChatroomService({ getGun: () => ({}) } as never) as unknown as {
      membershipHeartbeatKey: string | null;
      createPlaceAdmissionClaim: () => Promise<unknown>;
      syncMembershipHeartbeatWithServer: (room: string, user: string, name: string, at: string, traveler: boolean) => Promise<void>;
    };
    const room = 'place_32.71_-117.17_0123456789ab';
    const fetchMock = jest.fn(async () => new Response('{}', { status: 200 }));
    global.fetch = fetchMock as never;
    let finishSigning: (claim: unknown) => void = () => undefined;
    service.createPlaceAdmissionClaim = () => new Promise((resolve) => { finishSigning = resolve; });

    service.membershipHeartbeatKey = `${room}:u1`;
    const beat = service.syncMembershipHeartbeatWithServer(room, 'u1', 'U', new Date().toISOString(), false);
    service.membershipHeartbeatKey = null; // the user leaves while the claim is signed
    finishSigning({ version: 1 });
    await beat;
    expect(fetchMock).not.toHaveBeenCalled();

    // Still in the Place: the beat goes out.
    service.createPlaceAdmissionClaim = async () => ({ version: 1 });
    service.membershipHeartbeatKey = `${room}:u1`;
    await service.syncMembershipHeartbeatWithServer(room, 'u1', 'U', new Date().toISOString(), false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
