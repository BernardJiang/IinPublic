import {
  appendBackgroundEvent,
  backgroundTalkPassesPolicy,
  classifyBackgroundResponse,
  resolveBackgroundTalkAnswers,
  responseIdForBackgroundAnswers,
  type BackgroundAgentEvent,
  type BackgroundTalkAgentConfig,
} from '../../shared/background-talk-agent';
import type { P2PMeshTalkBodyPayload, P2PMeshTalkResponsePayload } from '../../shared/p2p-mesh-protocol';

const talk = {
  id: 'talk-1',
  type: 'flow',
  title: 'Coffee',
  questions: [
    {
      id: 'q1',
      text: 'Coffee?',
      answers: [
        { id: 'yes', text: 'Yes', isMatch: true, nextQuestionId: 'q2' },
        { id: 'no', text: 'No' },
      ],
    },
    {
      id: 'q2',
      text: 'When?',
      answers: [
        { id: 'now', text: 'Now', isMatch: true },
        { id: 'later', text: 'Later' },
      ],
    },
  ],
};

const config = (patch: Partial<BackgroundTalkAgentConfig> = {}): BackgroundTalkAgentConfig => ({
  version: 1,
  enabled: true,
  userId: 'receiver',
  stageName: 'Receiver',
  activeRoomId: 'nearby-room',
  autoAnswerEnabled: true,
  answerRules: [
    { questionText: 'Coffee?', answerTexts: ['No', 'Yes'], selectedAnswerTexts: ['Yes'], selectionMode: 'single' },
    { questionText: 'When?', answerTexts: ['Now', 'Later'], selectedAnswerTexts: ['Now'], selectionMode: 'single' },
  ],
  chatbotTemplates: {},
  authoredTalks: {},
  ...patch,
});

const body: P2PMeshTalkBodyPayload = {
  roomId: 'nearby-room',
  broadcastAt: new Date(0).toISOString(),
  talkId: 'talk-1',
  authorId: 'author',
  authorName: 'Author',
  authorEpub: 'author-epub',
  title: 'Coffee',
  questionCount: 2,
  talkData: talk,
};

describe('background Talk agent core', () => {
  test('walks an exact approved answer path without depending on answer order', () => {
    expect(resolveBackgroundTalkAnswers(config(), body)).toEqual([
      { questionId: 'q1', answerId: 'yes', answerText: 'Yes', mode: 'auto' },
      { questionId: 'q2', answerId: 'now', answerText: 'Now', mode: 'auto' },
    ]);
  });

  test('refuses partial, changed-frame, disabled, and wrong-room automation', () => {
    expect(resolveBackgroundTalkAnswers(config({ answerRules: config().answerRules.slice(0, 1) }), body)).toBeNull();
    expect(resolveBackgroundTalkAnswers(config({ enabled: false }), body)).toBeNull();
    expect(resolveBackgroundTalkAnswers(config({ activeRoomId: 'somewhere-else' }), body)).toBeNull();
    const changed = structuredClone(body);
    (changed.talkData.questions as any[])[0]!.answers.push({ id: 'maybe', text: 'Maybe' });
    expect(resolveBackgroundTalkAnswers(config(), changed)).toBeNull();
  });

  test('uses an exact Talk template before general rules', () => {
    const answers = [{ questionId: 'q1', answerId: 'no', answerText: 'No' }];
    expect(resolveBackgroundTalkAnswers(config({
      answerRules: [],
      chatbotTemplates: { 'talk-1': { answers, talkData: talk } },
    }), body)).toEqual([{ ...answers[0], mode: 'auto' }]);
  });

  test('applies the same audience and age policy before unattended processing', () => {
    const openFilters = {
      contactsOnlyTalks: false,
      allowedLanguages: ['en'],
      requireGoodGrammar: false,
      blockDirtyWords: false,
      allowedTalkTypes: ['flow', 'survey', 'tag', 'route'] as Array<'flow' | 'survey' | 'tag' | 'route'>,
      customBlockedTerms: [],
      dirtyWords: [],
    };
    expect(backgroundTalkPassesPolicy(config({ intakeFilters: openFilters, ageVerified: true }), body)).toBe(true);
    expect(backgroundTalkPassesPolicy(config({
      intakeFilters: { ...openFilters, contactsOnlyTalks: true },
      knownContactIds: [],
      ageVerified: true,
    }), body)).toBe(false);
    expect(backgroundTalkPassesPolicy(config({
      intakeFilters: { ...openFilters, contactsOnlyTalks: true },
      knownContactIds: ['author'],
      ageVerified: true,
    }), body)).toBe(true);
    expect(backgroundTalkPassesPolicy(config({ intakeFilters: openFilters, ageVerified: false }), {
      ...body,
      isAdult: true,
    })).toBe(false);
  });

  test('response ids are deterministic for background replays', async () => {
    const answers = resolveBackgroundTalkAnswers(config(), body)!;
    await expect(responseIdForBackgroundAnswers('talk-1', 'receiver', answers))
      .resolves.toBe(await responseIdForBackgroundAnswers('talk-1', 'receiver', answers));
  });

  test('classifies an authored response and binds it to the original outing', () => {
    const payload = {
      responseId: 'response-1',
      talkId: 'talk-1',
      authorId: 'receiver',
      responderId: 'peer',
      submittedAt: new Date(0).toISOString(),
      respondedAt: new Date(0).toISOString(),
      version: 1,
      encryption: 'sea-ecdh-v1',
      payloadCiphertext: 'ciphertext',
      transportMode: 'mesh-p2p',
    } satisfies P2PMeshTalkResponsePayload;
    expect(classifyBackgroundResponse(config({
      authoredTalks: { 'talk-1': { role: 'created', fullTalk: talk } },
      matchCollectionStore: JSON.stringify({
        associations: [{ sessionId: 'outing-1', peerId: 'peer', talkId: 'talk-1' }],
      }),
    }), payload, [{ questionId: 'q2', answerId: 'now' }])).toEqual({
      outcome: 'match',
      collectionSessionId: 'outing-1',
    });
  });

  test('journal append is idempotent and bounded', () => {
    const make = (index: number) => ({
      version: 1 as const,
      id: `event-${index}`,
      kind: 'incoming-talk' as const,
      createdAt: new Date(index).toISOString(),
      envelopeId: `envelope-${index}`,
      payload: body,
    });
    let events: BackgroundAgentEvent[] = Array.from({ length: 500 }, (_, index) => make(index));
    events = appendBackgroundEvent(events, make(500));
    expect(events).toHaveLength(500);
    expect(events[0]?.id).toBe('event-1');
    events = appendBackgroundEvent(events, make(500));
    expect(events.filter((event) => event.id === 'event-500')).toHaveLength(1);
  });
});
