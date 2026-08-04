import type { Page } from '@playwright/test';

// Quick iteration: 5 / 10 / 20. Real stress: 125 / 500 / 500.
export const NUM_TALKS_PER_TYPE = 125;
export const NUM_ANSWERS = 500;
export const NUM_CONTACTS = 500;

export const RELATIONSHIP_LABELS = [
  'friend', 'relative', 'coworker', 'acquaintance', 'partner', 'custom',
] as const;

/** Seeds myTalks (OUT, all 4 types) + myQuestionAnswers/myAnswerHistory directly into localStorage. */
export async function seedLocalData(page: Page, userId: string): Promise<void> {
  await page.evaluate(
    ({ answersCount, authorId, talksPerType }) => {
      type TalkType = 'tag' | 'flow' | 'survey' | 'route';
      const talks: Record<string, unknown> = {};
      const questionAnswers: Record<string, unknown> = {};
      const answerHistory: Record<string, unknown> = {};
      const createdAt = new Date().toISOString();

      function questionsFor(type: TalkType, index: number) {
        const prefix = `stress-${type}-${index}`;
        if (type === 'tag') {
          return [{
            id: `${prefix}-q1`, text: `Stress tag ${index}?`,
            answers: [
              { id: `${prefix}-match`, text: 'Yes', isMatch: true, isTerminal: true },
              { id: `${prefix}-ignore`, text: 'No', isIgnore: true, isTerminal: true },
            ],
          }];
        }
        if (type === 'survey') {
          return [{
            id: `${prefix}-q1`, text: `Stress survey ${index}?`, isAggregatable: true,
            answers: [1, 2, 3].map((c) => ({
              id: `${prefix}-a${c}`, text: `Option ${c}`, isTerminal: true, counter: 0,
            })),
          }];
        }
        return [
          {
            id: `${prefix}-q1`, text: `Stress ${type} ${index}: continue?`,
            answers: [
              { id: `${prefix}-continue`, text: 'Continue', nextQuestionId: `${prefix}-q2` },
              { id: `${prefix}-stop`, text: 'Stop', isIgnore: true, isTerminal: true },
            ],
          },
          {
            id: `${prefix}-q2`, text: `Stress ${type} ${index}: match?`,
            contextPath: [{ questionId: `${prefix}-q1`, answerId: `${prefix}-continue` }],
            answers: [
              { id: `${prefix}-match`, text: 'Match', isMatch: true, isTerminal: true },
              { id: `${prefix}-ignore`, text: 'Ignore', isIgnore: true, isTerminal: true },
            ],
          },
        ];
      }

      const types: TalkType[] = ['tag', 'flow', 'survey', 'route'];
      for (const type of types) {
        for (let i = 1; i <= talksPerType; i++) {
          const talkId = `stress-${type}-${i}`;
          talks[talkId] = {
            id: talkId, role: 'created', title: `Stress ${type} ${i}`,
            type, language: 'en', timestamp: createdAt, createdAt,
            status: 'OUT', stats: { responses: 0, matched: 0 }, disabled: false,
            lastInteraction: createdAt,
            fullTalk: {
              id: talkId, authorId, type, language: 'en', isAdult: false,
              tags: [{ id: `${talkId}-tag`, name: `${type}-${i}`, category: 'other', popularity: 0 }],
              questions: questionsFor(type, i), createdAt,
            },
          };
        }
      }

      for (let i = 1; i <= answersCount; i++) {
        const key = `stress-answer-${i}`;
        questionAnswers[`Stress answer question ${i}?`] = {
          questionId: `${key}-q`, questionText: `Stress answer question ${i}?`,
          answerId: `${key}-match`, answerText: `Answer ${i}`, mode: 'manual',
          language: 'en', isIgnored: false, timestamp: createdAt,
        };
        answerHistory[key] = {
          id: key, talkId: `stress-answer-talk-${i}`, title: `Stress answered talk ${i}`,
          type: 'survey', language: 'en', outcome: 'match', answeredAt: createdAt,
          senderIds: [`stress-sender-${i}`],
          items: [{
            questionId: `${key}-q`, answerId: `${key}-match`,
            prompt: `Stress answer question ${i}?`, choice: `Answer ${i}`,
            kind: 'question', contextPath: [], mode: 'manual',
          }],
        };
      }

      localStorage.setItem('myTalks', JSON.stringify(talks));
      localStorage.setItem('myQuestionAnswers', JSON.stringify(questionAnswers));
      localStorage.setItem('myAnswerHistory', JSON.stringify(answerHistory));
    },
    { answersCount: NUM_ANSWERS, authorId: userId, talksPerType: NUM_TALKS_PER_TYPE },
  );
}

/**
 * Contacts derive from localTalkExchanges (primary), myConversations (secondary), knownPeople
 * (tertiary). Seeding only knownPeople gets overwritten on reload — Gun hasn't propagated the
 * writes. Instead we seed both: (1) Gun user records for identities, AND (2) localTalkExchanges
 * so they derive as peers through the PRIMARY path in deriveLocalPeers().
 */
export async function seedContactsAsUsers(page: Page, userId: string): Promise<void> {
  const baseURL = await page.evaluate(() =>
    String((window as any).__iinpublic_app?.getApp()?.getBackendApiBase?.() || 'http://127.0.0.1:3001'));

  const client = page.context().request;

  // Step 1: Create user records in Gun so their profiles exist on the mesh.
  // We only need these for profile lookups — NOT for contacts derivation (that comes from exchanges).
  const batchSize = 50;
  for (let start = 1; start <= NUM_CONTACTS; start += batchSize) {
    const end = Math.min(start + batchSize - 1, NUM_CONTACTS);
    await Promise.all(Array.from({ length: end - start + 1 }, (_, i) => {
      const num = start + i;
      return client.post(`${baseURL}/api/users`, { data: {
        id: `sc-${num}`, stageName: `Stress Contact ${num}`, profile: [], reputation: {},
        location: { region: '', chatrooms: [] }, languages: ['en'], interests: [],
      }});
    }));
  }

  // Step 2: Seed localTalkExchanges so contacts derive through the PRIMARY source in
  // deriveLocalPeers(). Each peer gets one 'match' exchange — enough to appear with stats.
  await page.evaluate(({ contactsCount }) => {
    const exchanges = JSON.parse(localStorage.getItem('localTalkExchanges') || '{}');
    const createdAt = new Date().toISOString();
    for (let i = 1; i <= contactsCount; i++) {
      const peerId = `sc-${i}`;
      exchanges[`${peerId}::stress-contact-talk-${i}`] = {
        peerId,
        peerName: `Stress Contact ${i}`,
        talkId: `stress-contact-talk-${i}`,
        title: `Stress contact talk ${i}`,
        type: 'flow',
        language: 'en',
        outcome: 'match' as const,
        direction: 'sent' as const,
        date: createdAt,
      };
    }
    localStorage.setItem('localTalkExchanges', JSON.stringify(exchanges));
  }, { contactsCount: NUM_CONTACTS });

  // Step 3: Also add as known-people so the contacts tab shows labels/nicknames alongside them.
  for (let start = 1; start <= NUM_CONTACTS; start += batchSize) {
    const end = Math.min(start + batchSize - 1, NUM_CONTACTS);
    await Promise.all(Array.from({ length: end - start + 1 }, (_, i) => {
      const num = start + i;
      const label = RELATIONSHIP_LABELS[num % RELATIONSHIP_LABELS.length];
      return client.post(`${baseURL}/api/users/${encodeURIComponent(userId)}/known-people`, { data: {
        targetId: `sc-${num}`, label, nickname: `Stress Contact ${num}`,
        ...(label === 'custom' ? { customLabel: `Custom ${num}` } : {}),
      }});
    }));
  }
}
