import { mapMatchCounts, type MapMatchSource } from '../../shared/map-matches';
import { onExchangesChanged, readExchanges } from './exchange-view';

/** GUI adapter for the core-backed exchange view. Storage and migration stay in that view. */
export const exchangeMapMatchSource: MapMatchSource = {
  subscribe(onUpdate) {
    const publish = () => onUpdate({
      type: 'snapshot',
      counts: Object.fromEntries(mapMatchCounts(readExchanges())),
    });
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
