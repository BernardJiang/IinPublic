import { ROOM_MEMBERSHIP_TIMEOUT_MS } from '../../node-app/embedded-hub-relay-client';
import { PLACE_ADMISSION_REQUEST_TIMEOUT_MS } from '../../web/services/web-chatroom-service';

describe('Place admission timeouts on the phone path', () => {
  it('the browser waits longer than the embedded node takes to relay a reserve to the hub', () => {
    // Reserve on a phone = hub member read + hub reserve, each up to ROOM_MEMBERSHIP_TIMEOUT_MS.
    expect(PLACE_ADMISSION_REQUEST_TIMEOUT_MS).toBeGreaterThan(2 * ROOM_MEMBERSHIP_TIMEOUT_MS);
  });
});
