/** OPEN-73 diagnostics: requests and Gun records group by shape, not by id. */
import { routeKey, soulShape } from '../../server/services/runtime-profiler';

describe('runtime profiler grouping', () => {
  it('groups request routes without ids', () => {
    expect(routeKey('GET', '/api/mailbox/4b14f5de-6c7e-407b-96b1-e451a77ff786?x=1')).toBe('GET /api/mailbox/:uuid');
    expect(routeKey('GET', '/api/chatrooms/nearby_v2_e1_926050112988aa94871fe00d/members')).toBe('GET /api/chatrooms/:id/members');
  });

  it('groups Gun souls without ids', () => {
    expect(soulShape('users/4b14f5de-6c7e-407b-96b1-e451a77ff786/status')).toBe('users/:id/status');
    expect(soulShape('chatrooms/nearby_v2_e1_926050112988aa94871fe00d/members/abc')).toBe('chatrooms/:id/members/abc');
    expect(soulShape('~pubKeyAbc.def/profile/x')).toBe('~pub/profile/x');
    expect(soulShape(undefined)).toBe('(none)');
  });
});
