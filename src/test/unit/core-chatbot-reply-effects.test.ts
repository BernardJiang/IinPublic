import {
  ChatbotReplyEffects,
  type ChatbotDecisionWithAnswers,
  type ChatbotReplyEffectsPorts,
  type ChatbotReplyParams,
} from '../../core/chatbot-reply-effects';
import { buildTalkIdentityKey } from '../../shared/cid';

const params: ChatbotReplyParams = {
  talkId: 'talk-1',
  talkData: { questions: [{ id: 'q1' }] },
  authorId: 'author-1',
  authorName: 'Author',
};

function ports(overrides: Partial<ChatbotReplyEffectsPorts> = {}): ChatbotReplyEffectsPorts {
  return {
    currentUserId: jest.fn(() => 'me'),
    decide: jest.fn(async (): Promise<ChatbotDecisionWithAnswers> => ({ act: 'answer', contentId: 'content-1', answers: [{ questionId: 'q1', answerId: 'a1' }] })),
    recordPass: jest.fn(),
    resolveAnswers: jest.fn(async (_params, answers) => answers),
    submitAnswer: jest.fn(),
    classifyOutcome: jest.fn(async () => 'match'),
    recordAnswer: jest.fn(),
    incomingRows: jest.fn(async () => []),
    talkBody: jest.fn(async () => null),
    schedule: jest.fn(),
    onEvent: jest.fn(),
    onFailure: jest.fn(),
    ...overrides,
  };
}

describe('ChatbotReplyEffects', () => {
  it('records a passed tag locally without sending a response', async () => {
    const host = ports({ decide: jest.fn(async (): Promise<ChatbotDecisionWithAnswers> => ({ act: 'pass', contentId: 'content-1' })) });
    const effects = new ChatbotReplyEffects(host);

    await expect(effects.reply(params)).resolves.toBe('passed');
    expect(effects.isHandled(params.talkId, params.authorId, params.talkData)).toBe(true);
    expect(host.recordPass).toHaveBeenCalledWith(params);
    expect(host.submitAnswer).not.toHaveBeenCalled();
  });

  it('owns one bounded retry timer per talk/author revision', async () => {
    const scheduled: Array<() => void> = [];
    const host = ports({
      decide: jest.fn(async (): Promise<ChatbotDecisionWithAnswers> => ({ act: 'wait', contentId: 'content-1' })),
      schedule: jest.fn((task) => { scheduled.push(task); }),
    });
    const effects = new ChatbotReplyEffects(host, {
      fastRetries: 1,
      slowRetries: 1,
      fastDelayMs: 10,
      slowDelayMs: 20,
    });

    await expect(effects.reply(params)).resolves.toBe('waiting');
    await expect(effects.reply(params)).resolves.toBe('waiting');
    expect(host.schedule).toHaveBeenCalledTimes(1);
    expect(host.schedule).toHaveBeenLastCalledWith(expect.any(Function), 10);

    scheduled.shift()!();
    await Promise.resolve();
    await Promise.resolve();
    expect(host.schedule).toHaveBeenLastCalledWith(expect.any(Function), 20);
  });

  it('marks before dispatch and releases the pair when no usable answer exists', async () => {
    const host = ports({ resolveAnswers: jest.fn(async () => null) });
    const effects = new ChatbotReplyEffects(host);

    await expect(effects.reply(params)).resolves.toBe('failed');
    expect(effects.isHandled(params.talkId, params.authorId, params.talkData)).toBe(false);
    expect(host.submitAnswer).not.toHaveBeenCalled();
  });

  it('submits, classifies and records a reusable answer in order', async () => {
    const order: string[] = [];
    const answers = [{ questionId: 'q1', answerId: 'a1' }];
    const host = ports({
      resolveAnswers: jest.fn(async () => { order.push('resolve'); return answers; }),
      submitAnswer: jest.fn(() => { order.push('submit'); }),
      classifyOutcome: jest.fn(async () => { order.push('classify'); return 'mismatch'; }),
      recordAnswer: jest.fn(() => { order.push('record'); }),
    });
    const effects = new ChatbotReplyEffects(host);

    await expect(effects.reply(params)).resolves.toBe('answered');
    expect(order).toEqual(['resolve', 'submit', 'classify', 'record']);
    expect(host.recordAnswer).toHaveBeenCalledWith(params, answers, 'mismatch');
  });

  it('answers matching starter-tag senders from live host rows', async () => {
    const starter = { type: 'tag', tag: 'cats', questions: [{ id: 'q1', text: 'Cats?' }] };
    const identityKey = buildTalkIdentityKey(starter);
    const host = ports({
      incomingRows: jest.fn(async () => [{
        identityKey,
        senders: {
          one: { senderId: 'author-1', senderName: 'Author', lastTalkId: 'talk-1' },
          self: { senderId: 'me', senderName: 'Me', lastTalkId: 'talk-self' },
        },
      }]),
      talkBody: jest.fn(async () => ({ ...starter })),
    });

    await expect(new ChatbotReplyEffects(host).answerSendersOfStarterTag(starter)).resolves.toBe(1);
    expect(host.talkBody).toHaveBeenCalledTimes(1);
    expect(host.submitAnswer).toHaveBeenCalledTimes(1);
  });
});
