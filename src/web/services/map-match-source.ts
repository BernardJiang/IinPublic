import { mapMatchCounts, mapTalkIds, type MapMatchSource } from '../../shared/map-matches';
import { onExchangesChanged, readExchanges } from './exchange-view';

/** GUI adapter for the core-backed exchange view. Storage and migration stay in that view. */
export const exchangeMapMatchSource: MapMatchSource = {
  subscribe(onUpdate) {
    const publish = () => {
      const exchanges = readExchanges();
      onUpdate({ type: 'snapshot', counts: Object.fromEntries(mapMatchCounts(exchanges)),
        talkIdsByPeer: Object.fromEntries(mapTalkIds(exchanges)) });
    };
    const unsubscribe = onExchangesChanged(publish);
    try {
      publish();
    } catch (error) {
      unsubscribe();
      throw error;
    }
    return unsubscribe;
  },
};
