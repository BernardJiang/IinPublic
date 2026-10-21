import { matchScore } from './talk-engine';

export type CollectionRankOutcome = {
  talkId: string;
  outcome: 'match' | 'mismatch' | 'ignore';
  capturedAt: string;
};

export type CollectionRankPerson = {
  peerId: string;
  pinned: boolean;
  dismissed: boolean;
  latestOutcomes: CollectionRankOutcome[];
  encounterDistancesMeters: number[];
};

export type CollectionRankTalk = {
  collectionImportance?: 'important' | 'must-have';
  questions?: Array<{
    id: string;
    collectionImportance?: 'important' | 'must-have';
    answers?: Array<{ id: string; isMatch?: boolean; isIgnore?: boolean }>;
  }>;
};

export type CollectionRankExchange = {
  peerId: string;
  talkId: string;
  answers?: Array<{ questionId: string; answerId: string }>;
};

export type CollectionRankReason = 'pinned' | 'must-have' | 'weighted-matches' | 'breadth' | 'nearby' | 'recent';

export type RankedCollectionPerson<T extends CollectionRankPerson = CollectionRankPerson> = T & {
  score: number;
  mustHaveFailures: number;
  weightedMatches: number;
  matchedTalks: number;
  reasons: CollectionRankReason[];
};

const importanceWeight = (importance: CollectionRankTalk['collectionImportance']): number => (
  importance === 'must-have' ? 8 : importance === 'important' ? 3 : 1
);

/**
 * Explainable outing ranking. The weighted-overlap term deliberately uses the same `matchScore`
 * primitive as Find Similar People; must-have failures are a separate leading sort key so a large
 * pile of low-value matches can never bury a failed hard requirement.
 */
export function rankMatchCollectionPeople<T extends CollectionRankPerson>(input: {
  people: readonly T[];
  talks: Readonly<Record<string, CollectionRankTalk | undefined>>;
  exchanges?: readonly CollectionRankExchange[];
  relationshipStrength?: Readonly<Record<string, number | undefined>>;
  now?: Date;
}): RankedCollectionPerson<T>[] {
  const nowMs = (input.now ?? new Date()).getTime();
  return input.people.map((person): RankedCollectionPerson<T> => {
    const desired: Record<string, number> = {};
    const matched: Record<string, number> = {};
    let mustHaveFailures = 0;
    let matchedTalks = 0;
    let latestReplyMs = 0;
    for (const result of person.latestOutcomes) {
      const talk = input.talks[result.talkId] ?? {};
      const talkKey = `talk:${result.talkId}`;
      desired[talkKey] = importanceWeight(talk.collectionImportance);
      if (result.outcome === 'match') {
        matched[talkKey] = 1;
        matchedTalks += 1;
      } else if (talk.collectionImportance === 'must-have') {
        mustHaveFailures += 1;
      }
      latestReplyMs = Math.max(latestReplyMs, Date.parse(result.capturedAt) || 0);

      const exchange = input.exchanges?.find((candidate) => (
        candidate.peerId === person.peerId && candidate.talkId === result.talkId
      ));
      const answers = new Map((exchange?.answers ?? []).map((answer) => [answer.questionId, answer.answerId]));
      for (const question of talk.questions ?? []) {
        const questionKey = `question:${result.talkId}:${question.id}`;
        desired[questionKey] = importanceWeight(question.collectionImportance);
        const selected = question.answers?.find((answer) => answer.id === answers.get(question.id));
        if (selected?.isMatch) matched[questionKey] = 1;
        else if (question.collectionImportance === 'must-have' && answers.has(question.id)) mustHaveFailures += 1;
      }
    }
    const weightedMatches = matchScore(desired, matched, (viewerWeight) => viewerWeight);
    const nearestMeters = person.encounterDistancesMeters.length
      ? Math.min(...person.encounterDistancesMeters)
      : Number.POSITIVE_INFINITY;
    const distanceBonus = Number.isFinite(nearestMeters) ? Math.max(0, 3 - nearestMeters / 5_000) : 0;
    const ageHours = latestReplyMs ? Math.max(0, nowMs - latestReplyMs) / 3_600_000 : Number.POSITIVE_INFINITY;
    const freshnessBonus = Number.isFinite(ageHours) ? Math.max(0, 2 - ageHours / 24) : 0;
    const relationship = Math.max(0, Number(input.relationshipStrength?.[person.peerId]) || 0);
    const score = weightedMatches + matchedTalks * 2 + relationship + distanceBonus + freshnessBonus;
    const reasons: CollectionRankReason[] = [];
    if (person.pinned) reasons.push('pinned');
    if (mustHaveFailures === 0 && Object.values(desired).some((weight) => weight === 8)) reasons.push('must-have');
    if (weightedMatches > 0) reasons.push('weighted-matches');
    if (matchedTalks > 1) reasons.push('breadth');
    if (nearestMeters <= 5_000) reasons.push('nearby');
    if (ageHours <= 24) reasons.push('recent');
    return { ...person, score, mustHaveFailures, weightedMatches, matchedTalks, reasons };
  }).sort((left, right) => {
    if (left.pinned !== right.pinned) return left.pinned ? -1 : 1;
    if (left.dismissed !== right.dismissed) return left.dismissed ? 1 : -1;
    return left.mustHaveFailures - right.mustHaveFailures
      || right.score - left.score
      || left.peerId.localeCompare(right.peerId);
  });
}
