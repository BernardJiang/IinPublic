import type { P2PMeshTalkResponsePayload } from '../../shared/p2p-mesh-protocol';
import type { OutcomeRecord } from '../../core/device-graph/exchanged';
import {
  ResponseIngestEffects,
  type ResponseIngestEffectsPorts,
} from '../../core/response-ingest-effects';

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

const payload = (overrides: Partial<P2PMeshTalkResponsePayload> = {}): P2PMeshTalkResponsePayload => ({
  responseId: 'response-1',
  talkId: 'talk-1',
  authorId: 'ann',
  responderId: 'bob',
  submittedAt: '2026-11-27T12:00:00.000Z',
  respondedAt: '2026-11-27T12:00:00.000Z',
  version: 1,
  encryption: 'sea-ecdh-v1',
  payloadCiphertext: 'SEA{}',
  transportMode: 'mesh-p2p',
  ...overrides,
});

const ports = (overrides: Partial<ResponseIngestEffectsPorts> = {}) => {
  const value: ResponseIngestEffectsPorts = {
    currentUser: jest.fn(() => ({ id: 'ann', stageName: 'Ann' })),
    acceptsResponder: jest.fn(() => true),
    hasProcessed: jest.fn(() => false),
    markProcessed: jest.fn(),
    resolveTalk: jest.fn(async () => talk),
    decrypt: jest.fn(async () => ({
      answers: yes,
      responderName: 'Bob',
      isChatbotResponse: false,
    })),
    responseState: jest.fn(async () => ({ prior: null, retractedAt: null })),
    recordExchange: jest.fn(),
    createConversation: jest.fn(async () => 'conversation-1'),
    recordDealTalk: jest.fn(),
    recordNeed: jest.fn(),
    showSafetyToast: jest.fn(),
    upsertConversation: jest.fn(),
    transportMode: jest.fn(() => 'direct-p2p'),
    showFirstMatch: jest.fn(),
    showNowMatch: jest.fn(),
    showNoLongerMatch: jest.fn(),
    markConversationEnded: jest.fn(),
    shareAttachments: jest.fn(async () => undefined),
    setMemberMatched: jest.fn(),
    onEvent: jest.fn(),
    ...overrides,
  };
  return value;
};

const prior = (outcome: OutcomeRecord['outcome'], version = 1): OutcomeRecord => ({
  outcome,
  version,
  responseId: 'old-response',
  respondedAt: '2026-11-27T11:00:00.000Z',
});

describe('ResponseIngestEffects', () => {
  it('gates wrong authors, disallowed responders and duplicate responses before reads', async () => {
    const host = ports();
    const effects = new ResponseIngestEffects(host);
    await expect(effects.ingest(payload({ authorId: 'someone-else' }))).resolves.toBe('ignored');
    expect(host.resolveTalk).not.toHaveBeenCalled();

    (host.acceptsResponder as jest.Mock).mockReturnValue(false);
    await expect(effects.ingest(payload())).resolves.toBe('ignored');
    expect(host.resolveTalk).not.toHaveBeenCalled();

    (host.acceptsResponder as jest.Mock).mockReturnValue(true);
    (host.hasProcessed as jest.Mock).mockReturnValue(true);
    await expect(effects.ingest(payload())).resolves.toBe('ignored');
    expect(host.resolveTalk).not.toHaveBeenCalled();
  });

  it('records a first match and creates the conversation before sharing attachments', async () => {
    const order: string[] = [];
    const host = ports({
      upsertConversation: jest.fn(() => order.push('upsert')),
      shareAttachments: jest.fn(async () => { order.push('share'); }),
      setMemberMatched: jest.fn(() => order.push('matched')),
      showFirstMatch: jest.fn(() => order.push('notify')),
    });
    const effects = new ResponseIngestEffects(host);

    await expect(effects.ingest(payload(), {
      answers: yes,
      responderName: 'Bobby',
      isChatbotResponse: true,
      collectionSessionId: 'outing-1',
    })).resolves.toBe('match');

    expect(host.decrypt).not.toHaveBeenCalled();
    expect(host.markProcessed).toHaveBeenCalledWith(
      'mesh-response::talk-1::response-1::v1',
    );
    expect(host.recordExchange).toHaveBeenCalledWith(expect.objectContaining({
      peerId: 'bob',
      peerName: 'Bobby',
      outcome: 'match',
      meta: expect.objectContaining({ collectionSessionId: 'outing-1' }),
    }));
    expect(host.createConversation).toHaveBeenCalledWith(expect.objectContaining({
      currentUserId: 'ann',
      responderId: 'bob',
      respondedByBot: true,
    }));
    expect(host.upsertConversation).toHaveBeenCalledWith(expect.objectContaining({
      conversationId: 'conversation-1',
      otherUserId: 'bob',
      respondedByBot: true,
      transportMode: 'direct-p2p',
    }));
    expect(order).toEqual(['upsert', 'share', 'matched', 'notify']);
  });

  it('records a first mismatch without creating a conversation', async () => {
    const host = ports({
      decrypt: jest.fn(async () => ({ answers: no, responderName: 'Bob', isChatbotResponse: false })),
    });
    const effects = new ResponseIngestEffects(host);

    await expect(effects.ingest(payload())).resolves.toBe('mismatch');
    expect(host.recordExchange).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'mismatch' }));
    expect(host.createConversation).not.toHaveBeenCalled();
  });

  it('applies both change-of-mind transitions and unchanged version bumps', async () => {
    const nowMatch = ports({
      responseState: jest.fn(async () => ({ prior: prior('ignored'), retractedAt: null })),
    });
    await expect(new ResponseIngestEffects(nowMatch).ingest(payload({
      responseId: 'response-2',
      version: 2,
    }))).resolves.toBe('match');
    expect(nowMatch.showNowMatch).toHaveBeenCalled();
    expect(nowMatch.upsertConversation).toHaveBeenCalledWith(expect.objectContaining({
      changeOfMindAt: '2026-11-27T12:00:00.000Z',
    }));

    const ended = ports({
      decrypt: jest.fn(async () => ({ answers: no, responderName: 'Bob', isChatbotResponse: false })),
      responseState: jest.fn(async () => ({ prior: prior('matched'), retractedAt: null })),
    });
    await expect(new ResponseIngestEffects(ended).ingest(payload({
      responseId: 'response-2',
      version: 2,
    }))).resolves.toBe('ended');
    expect(ended.showNoLongerMatch).toHaveBeenCalled();
    expect(ended.markConversationEnded).toHaveBeenCalledWith(
      'bob',
      'talk-1',
      '2026-11-27T12:00:00.000Z',
    );

    const unchanged = ports({
      responseState: jest.fn(async () => ({ prior: prior('matched'), retractedAt: null })),
    });
    await expect(new ResponseIngestEffects(unchanged).ingest(payload({
      responseId: 'response-2',
      version: 2,
    }))).resolves.toBe('unchanged');
    expect(unchanged.createConversation).not.toHaveBeenCalled();
    expect(unchanged.onEvent).toHaveBeenCalledWith(expect.objectContaining({
      type: 'unchanged',
      priorVersion: 1,
      version: 2,
    }));
  });

  it('does not claim stale or retracted responses', async () => {
    const host = ports({
      responseState: jest.fn(async () => ({
        prior: prior('matched', 2),
        retractedAt: null,
      })),
    });
    const effects = new ResponseIngestEffects(host);
    await expect(effects.ingest(payload())).resolves.toBe('rejected');
    expect(host.markProcessed).not.toHaveBeenCalled();
    expect(host.recordExchange).not.toHaveBeenCalled();
    expect(host.onEvent).toHaveBeenCalledWith(expect.objectContaining({
      type: 'rejected',
      reason: 'stale',
    }));
  });
});
