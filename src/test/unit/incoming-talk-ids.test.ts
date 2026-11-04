// OPEN-106 step 2e: Talks are known by their device graph id, so the incoming list must accept it
// (phone-path/09: an answered row lost its id and its place link).

import { isValidTalkId, pickLatestTalkIdFromIncomingCluster } from '../../shared/incoming-talk-ids';
import { formatEventId } from '../../core/device-graph/event-id';

describe('incoming Talk ids', () => {
  const graphId = formatEventId({ when: Date.parse('2026-11-04T18:00:00.000Z'), deviceId: 'f43ca52bdb4b741ea942133f338873f2', counter: 8 });

  it('accepts graph event ids alongside the older id forms', () => {
    expect(isValidTalkId(graphId)).toBe(true);
    expect(isValidTalkId('qa_1234abcd')).toBe(true);
    expect(isValidTalkId('not a talk')).toBe(false);
  });

  it('an answered row keyed by a graph id keeps it', () => {
    expect(pickLatestTalkIdFromIncomingCluster({ latestTalkId: graphId })).toBe(graphId);
    expect(pickLatestTalkIdFromIncomingCluster({ talkIds: { [graphId]: '2026-11-04T18:00:00.000Z' } })).toBe(graphId);
  });
});
