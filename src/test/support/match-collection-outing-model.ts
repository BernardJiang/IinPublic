import { rankMatchCollectionPeople, type CollectionRankTalk } from '../../shared/match-collection-ranking';

export type SimulatedOuting = ReturnType<typeof simulateMatchCollectionOuting>;

/** Deterministic crowd model: no timers, network, or random source, so regressions reproduce. */
export function simulateMatchCollectionOuting(input: {
  people: number;
  talkIds: string[];
  delayedModulo?: number;
  repeatedModulo?: number;
  coldStartModulo?: number;
}) {
  const delayedModulo = input.delayedModulo ?? 5;
  const repeatedModulo = input.repeatedModulo ?? 7;
  const coldStartModulo = input.coldStartModulo ?? 6;
  const talks: Record<string, CollectionRankTalk> = Object.fromEntries(input.talkIds.map((talkId, index) => [
    talkId,
    index === 0
      ? { collectionImportance: 'must-have' as const }
      : index === 1 ? { collectionImportance: 'important' as const } : {},
  ]));
  const people = Array.from({ length: input.people }, (_, index) => {
    const peerId = `peer-${String(index).padStart(4, '0')}`;
    const autoAnswerReady = index % coldStartModulo !== 0;
    const latestOutcomes = input.talkIds.flatMap((talkId, talkIndex) => {
      if (!autoAnswerReady) return [];
      if ((index + talkIndex) % 4 === 0) return [];
      const outcome = (index + talkIndex) % 3 === 0 ? 'mismatch' as const : 'match' as const;
      return [{ talkId, outcome, capturedAt: new Date(Date.UTC(2026, 9, 20, 10, index % 60)).toISOString() }];
    });
    return {
      peerId,
      pinned: index === 11,
      dismissed: index === input.people - 1,
      latestOutcomes,
      encounterDistancesMeters: [250 + index * 25],
      delayed: index % delayedModulo === 0,
      repeated: index % repeatedModulo === 0,
      autoAnswerReady,
    };
  });
  const ranked = rankMatchCollectionPeople({ people, talks, now: new Date('2026-10-20T12:00:00Z') });
  return {
    people,
    ranked,
    deliveredPairs: input.people * input.talkIds.length,
    pendingPairs: people.reduce((count, person) => count + input.talkIds.length - person.latestOutcomes.length, 0),
    delayedPeople: people.filter((person) => person.delayed).length,
    repeatedPeople: people.filter((person) => person.repeated).length,
    coldStartPeople: people.filter((person) => !person.autoAnswerReady).length,
    coldStartPendingPairs: people.filter((person) => !person.autoAnswerReady).length * input.talkIds.length,
  };
}
