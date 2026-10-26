import { mapMatchCounts, type MapMatchExchange } from '../../shared/map-matches';
const exchange = (talkId: string, outcome: MapMatchExchange['outcome'], direction: MapMatchExchange['direction'] = 'sent'): MapMatchExchange =>
  ({ peerId: 'eve', talkId, outcome, direction });

describe('map match counts', () => {
  it('counts matched Talks, deduplicating both directions and ignoring nonmatches', () => {
    expect(mapMatchCounts([exchange('one', 'match'), exchange('one', 'match', 'received'), exchange('two', 'match'), exchange('three', 'mismatch')]).get('eve')).toBe(2);
  });
  it('does not invent matches when the authoritative outcomes contain none', () => {
    expect(mapMatchCounts([exchange('one', 'mismatch')]).has('eve')).toBe(false);
    expect(mapMatchCounts([]).size).toBe(0);
  });
});
