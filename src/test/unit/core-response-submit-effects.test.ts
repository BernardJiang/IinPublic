import {
  ResponseSubmitEffects,
  type ResponseSubmitEffectsPorts,
  type ResponseSubmitParams,
} from '../../core/response-submit-effects';

const talk = {
  id: 'talk-1',
  type: 'tag',
  title: 'Tennis',
  questions: [{
    id: 'q1',
    text: 'Tennis?',
    answers: [
      { id: 'yes', text: 'Yes', isMatch: true },
      { id: 'no', text: 'No', isIgnore: true },
    ],
  }],
};
const yes = [{ questionId: 'q1', answerId: 'yes', answerText: 'Yes' }];
const no = [{ questionId: 'q1', answerId: 'no', answerText: 'No' }];

const params = (overrides: Partial<ResponseSubmitParams> = {}): ResponseSubmitParams => ({
  talkId: 'talk-1',
  talkData: talk,
  answers: yes,
  isChatbotResponse: false,
  authorId: 'ann',
  authorName: 'Ann',
  isAutoResponse: false,
  ...overrides,
});

const ports = (overrides: Partial<ResponseSubmitEffectsPorts> = {}) => {
  const value: ResponseSubmitEffectsPorts = {
    currentUser: jest.fn(() => ({ id: 'bob', stageName: 'Bob', epub: 'bob-epub' })),
    acceptsAuthor: jest.fn(() => true),
    resolveSelfTag: jest.fn(async () => undefined),
    shouldSkipDelivery: jest.fn(() => false),
    encrypt: jest.fn(async () => 'SEA{ciphertext}'),
    commit: jest.fn(async (input) => ({
      payload: {
        responseId: `response-${input.authorId}`,
        talkId: input.talkId,
        authorId: input.authorId,
        responderId: input.responderId,
        submittedAt: input.submittedAt,
        respondedAt: input.submittedAt,
        version: 2,
        encryption: 'sea-ecdh-v1' as const,
        payloadCiphertext: input.payloadCiphertext,
        transportMode: 'mesh-p2p' as const,
      },
      isContentChange: false,
    })),
    ensureGraphLinks: jest.fn(async () => undefined),
    sendGraphAnswer: jest.fn(async () => ({ sent: true })),
    showExchangeActivity: jest.fn(),
    recordDelivery: jest.fn(async () => undefined),
    isRetracted: jest.fn(async () => false),
    otherSenders: jest.fn(() => []),
    refreshExchangeState: jest.fn(async () => undefined),
    recordAnsweredLedger: jest.fn(),
    answeredRow: jest.fn(() => undefined),
    recordExchange: jest.fn(),
    createConversation: jest.fn(async () => 'conversation-1'),
    recordNeed: jest.fn(),
    resolveResponderSourceTalkId: jest.fn(async () => undefined),
    recordDealTalk: jest.fn(),
    showSafetyToast: jest.fn(),
    upsertConversation: jest.fn(),
    transportMode: jest.fn(() => 'direct-p2p'),
    setMemberMatched: jest.fn(),
    recordMatchLedger: jest.fn(),
    now: jest.fn(() => new Date('2026-11-27T12:00:00.000Z')),
    onEvent: jest.fn(),
    ...overrides,
  };
  return value;
};

describe('ResponseSubmitEffects', () => {
  it('rejects disallowed and incomplete responses before commit', async () => {
    const blocked = ports({ acceptsAuthor: jest.fn(() => false) });
    await expect(new ResponseSubmitEffects(blocked).submit(params())).resolves.toBe('ignored');
    expect(blocked.resolveSelfTag).not.toHaveBeenCalled();

    const incomplete = ports();
    await expect(new ResponseSubmitEffects(incomplete).submit(params({
      talkData: { ...talk, type: 'survey', questions: [...talk.questions, { id: 'q2', answers: [] }] },
    }))).resolves.toBe('incomplete');
    expect(incomplete.commit).not.toHaveBeenCalled();
    expect(incomplete.onEvent).toHaveBeenCalledWith({
      type: 'incomplete',
      talkId: 'talk-1',
      answered: 1,
    });
  });

  it('commits before graph delivery, records the exchange before release, then creates a match', async () => {
    const order: string[] = [];
    const releaseLine = jest.fn(() => order.push('release'));
    const host = ports({
      commit: jest.fn(async (input) => {
        order.push('commit');
        return {
          payload: {
            responseId: 'response-ann',
            talkId: input.talkId,
            authorId: input.authorId,
            responderId: input.responderId,
            submittedAt: input.submittedAt,
            respondedAt: input.submittedAt,
            version: 3,
            encryption: 'sea-ecdh-v1' as const,
            payloadCiphertext: input.payloadCiphertext,
            transportMode: 'mesh-p2p' as const,
          },
          isContentChange: false,
        };
      }),
      sendGraphAnswer: jest.fn(async () => { order.push('send'); return { sent: true }; }),
      recordExchange: jest.fn(() => order.push('exchange')),
      createConversation: jest.fn(async () => { order.push('conversation'); return 'conversation-1'; }),
    });
    const effects = new ResponseSubmitEffects(host);

    await expect(effects.submit(params({ releaseLine }))).resolves.toBe('match');
    expect(order).toEqual(['commit', 'send', 'exchange', 'release', 'conversation']);
    expect(host.sendGraphAnswer).toHaveBeenCalledWith(expect.objectContaining({
      talkId: 'talk-1',
      authorId: 'ann',
      answers: [{ questionId: 'q1', answerId: 'yes' }],
      mode: 'manual',
      context: expect.objectContaining({ responseId: 'response-ann', version: 3 }),
    }));
    expect(host.recordAnsweredLedger).toHaveBeenCalledWith({
      talkId: 'talk-1',
      responseId: 'response-ann',
      outcome: 'match',
    });
    expect(host.recordExchange).toHaveBeenCalledWith(expect.objectContaining({
      outcome: 'match',
      meta: expect.objectContaining({ version: 3, direction: 'received' }),
    }));
    expect(host.upsertConversation).toHaveBeenCalledWith(expect.objectContaining({
      conversationId: 'conversation-1',
      otherUserId: 'ann',
      transportMode: 'direct-p2p',
    }));
    expect(host.recordMatchLedger).toHaveBeenCalled();
  });

  it('fans a changed answer out to other senders but skips retracted targets', async () => {
    const host = ports({
      commit: jest.fn(async (input) => ({
        payload: {
          responseId: `response-${input.authorId}`,
          talkId: input.talkId,
          authorId: input.authorId,
          responderId: input.responderId,
          submittedAt: input.submittedAt,
          respondedAt: input.submittedAt,
          version: 4,
          encryption: 'sea-ecdh-v1' as const,
          payloadCiphertext: input.payloadCiphertext,
          transportMode: 'mesh-p2p' as const,
        },
        isContentChange: input.authorId === 'ann',
      })),
      otherSenders: jest.fn(() => [
        { senderId: 'cy', senderName: 'Cy', talkId: 'talk-cy' },
        { senderId: 'dee', senderName: 'Dee', talkId: 'talk-dee' },
      ]),
      isRetracted: jest.fn(async (talkId) => talkId === 'talk-dee'),
    });
    const effects = new ResponseSubmitEffects(host);

    await expect(effects.submit(params({ answers: no }))).resolves.toBe('mismatch');
    expect(host.commit).toHaveBeenCalledTimes(2);
    expect(host.commit).toHaveBeenCalledWith(expect.objectContaining({
      authorId: 'cy',
      talkId: 'talk-cy',
    }));
    expect(host.commit).not.toHaveBeenCalledWith(expect.objectContaining({ authorId: 'dee' }));
    expect(host.onEvent).toHaveBeenCalledWith({ type: 'fanout', authorId: 'cy' });
    expect(host.onEvent).toHaveBeenCalledWith({
      type: 'retracted',
      talkId: 'talk-dee',
      authorId: 'dee',
    });
  });

  it('records local mismatch state when delivery is deliberately skipped', async () => {
    const host = ports({ shouldSkipDelivery: jest.fn(() => true) });
    const releaseLine = jest.fn();
    const effects = new ResponseSubmitEffects(host);

    await expect(effects.submit(params({ answers: no, releaseLine }))).resolves.toBe('mismatch');
    expect(host.encrypt).not.toHaveBeenCalled();
    expect(host.commit).not.toHaveBeenCalled();
    expect(host.recordExchange).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'mismatch' }));
    expect(host.recordAnsweredLedger).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'mismatch' }));
    expect(releaseLine).toHaveBeenCalledTimes(1);
  });

  it('keeps a retracted primary talk out of commit and conversation creation', async () => {
    const host = ports({ isRetracted: jest.fn(async () => true) });
    const effects = new ResponseSubmitEffects(host);

    await expect(effects.submit(params({ answers: no }))).resolves.toBe('mismatch');
    expect(host.commit).not.toHaveBeenCalled();
    expect(host.createConversation).not.toHaveBeenCalled();
    expect(host.onEvent).toHaveBeenCalledWith({
      type: 'retracted',
      talkId: 'talk-1',
      authorId: 'ann',
    });
  });

  it('records a deal source talk only after a deal-eligible match', async () => {
    const dealTalk = {
      ...talk,
      questions: [{
        ...talk.questions[0],
        reciprocalTagContext: true,
      }],
    };
    const host = ports({ resolveResponderSourceTalkId: jest.fn(async () => 'my-deal-talk') });
    const effects = new ResponseSubmitEffects(host);

    await expect(effects.submit(params({ talkData: dealTalk }))).resolves.toBe('match');
    expect(host.resolveResponderSourceTalkId).toHaveBeenCalledWith(dealTalk, yes);
    expect(host.recordDealTalk).toHaveBeenCalledWith(
      'conversation-1',
      'my-deal-talk',
      dealTalk,
    );
  });
});
