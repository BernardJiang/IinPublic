/** Offline Nearby board channels (`nearby-v3-local.ts`): neighbours read each other, far phones do not. */
import { nearbyLocalPostChannel, nearbyLocalReadChannels } from '../../shared/nearby-v3-local';

const SD = { latitude: 32.7157, longitude: -117.1611 };

describe('Nearby local board channels', () => {
  it('a phone reads the channel of anyone within one cell (about 39 km), not across the country', () => {
    const neighbour = { latitude: 32.92, longitude: -117.05 }; // ~25 km away, maybe across a cell edge
    expect(nearbyLocalReadChannels(SD)).toContain(nearbyLocalPostChannel(neighbour));
    expect(nearbyLocalReadChannels(neighbour)).toContain(nearbyLocalPostChannel(SD));
    expect(nearbyLocalReadChannels(SD)).not.toContain(nearbyLocalPostChannel({ latitude: 40.71, longitude: -74.0 }));
    expect(new Set(nearbyLocalReadChannels(SD)).size).toBe(9);
  });

  it('wraps around the date line', () => {
    const east = { latitude: 0, longitude: 179.99 };
    const west = { latitude: 0, longitude: -179.99 };
    expect(nearbyLocalReadChannels(east)).toContain(nearbyLocalPostChannel(west));
  });
});
