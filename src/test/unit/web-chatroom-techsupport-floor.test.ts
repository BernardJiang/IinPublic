import { WebChatroomService } from '../../web/services/web-chatroom-service';
import type { WebGunService } from '../../web/services/web-gun-service';

class MockWebGunService implements Partial<WebGunService> {
  getGun(): any {
    return null;
  }

  getStoredPair(): any {
    return { pub: 'test-pub' };
  }
}

describe('WebChatroomService — TechSupport remains Contacts-only', () => {
  it('has no synthetic room-roster floor', () => {
    const service = new WebChatroomService(new MockWebGunService() as any);
    expect((service as any).rosterWithTechSupportFloor).toBeUndefined();
  });
});
