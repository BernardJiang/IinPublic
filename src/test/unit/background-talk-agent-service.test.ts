import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import SEA from 'gun/sea';
import { BackgroundTalkAgent } from '../../server/services/background-talk-agent';
import type { BackgroundTalkAgentConfig } from '../../shared/background-talk-agent';
import type { P2PMeshTalkBodyPayload, P2PMeshTalkResponsePayload } from '../../shared/p2p-mesh-protocol';

const intakeFilters = {
  contactsOnlyTalks: false,
  allowedLanguages: ['en'],
  requireGoodGrammar: false,
  blockDirtyWords: false,
  allowedTalkTypes: ['flow', 'survey', 'tag', 'route'] as Array<'flow' | 'survey' | 'tag' | 'route'>,
  customBlockedTerms: [],
  dirtyWords: [],
};

describe('BackgroundTalkAgent encrypted mailbox cycle', () => {
  let directory = '';
  const originalFetch = global.fetch;

  beforeEach(async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'iinpublic-background-agent-'));
  });

  afterEach(async () => {
    global.fetch = originalFetch;
    await fs.rm(directory, { recursive: true, force: true });
  });

  test('decrypts, exact-auto-answers, relays, journals, and only then acks', async () => {
    const author = await SEA.pair();
    const receiver = await SEA.pair();
    const talk = {
      id: 'talk-1',
      type: 'flow',
      title: 'Coffee',
      questions: [{
        id: 'q1',
        text: 'Coffee?',
        answers: [{ id: 'yes', text: 'Yes', isMatch: true }, { id: 'no', text: 'No' }],
      }],
    };
    const payload: P2PMeshTalkBodyPayload = {
      roomId: 'room-1',
      broadcastAt: new Date(0).toISOString(),
      talkId: 'talk-1',
      authorId: 'author',
      authorName: 'Author',
      authorEpub: author.epub,
      title: 'Coffee',
      questionCount: 1,
      talkData: talk,
    };
    const outerSecret = await SEA.secret(receiver.epub, author);
    const outer = JSON.stringify({
      senderEpub: author.epub,
      ct: await SEA.encrypt(JSON.stringify(payload), outerSecret!),
    });
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    global.fetch = jest.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, ...(init ? { init } : {}) });
      if (url.includes('/block-status/')) {
        return new Response(JSON.stringify({ eitherBlocked: false }), { status: 200 });
      }
      if (!init?.method) {
        return new Response(JSON.stringify({ envelopes: [{ id: 'body-1', ciphertext: outer }] }), { status: 200 });
      }
      if (init.method === 'POST') return new Response(JSON.stringify({ stored: true }), { status: 201 });
      if (init.method === 'DELETE') return new Response(JSON.stringify({ deleted: true }), { status: 200 });
      return new Response('', { status: 500 });
    }) as typeof fetch;
    const relayed: Array<{ recipientId: string; envelope: { id: string; ciphertext: string } }> = [];
    const agent = new BackgroundTalkAgent(
      'http://127.0.0.1:8088',
      path.join(directory, 'journal.sea'),
      async (recipientId, envelope) => { relayed.push({ recipientId, envelope }); },
    );
    const config: BackgroundTalkAgentConfig = {
      version: 1,
      enabled: true,
      userId: 'receiver',
      stageName: 'Receiver',
      activeRoomId: 'room-1',
      autoAnswerEnabled: true,
      answerRules: [{
        questionText: 'Coffee?',
        answerTexts: ['Yes', 'No'],
        selectedAnswerTexts: ['Yes'],
        selectionMode: 'single',
      }],
      chatbotTemplates: {},
      authoredTalks: {},
      intakeFilters,
      ageVerified: true,
    };
    await agent.provision(config, receiver as any);
    const events = await agent.drain();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ kind: 'incoming-talk', envelopeId: 'body-1' });
    expect(relayed).toHaveLength(1);
    expect(relayed[0]?.recipientId).toBe('author');
    expect(calls.at(-1)?.init?.method).toBe('DELETE');

    const responseWrapper = JSON.parse(relayed[0]!.envelope.ciphertext);
    const authorSecret = await SEA.secret(responseWrapper.senderEpub, author);
    const response = await SEA.decrypt(responseWrapper.ct, authorSecret!) as P2PMeshTalkResponsePayload;
    expect(response).toMatchObject({ talkId: 'talk-1', authorId: 'author', responderId: 'receiver', version: 1 });
    const responseSecret = await SEA.secret(response.responderEpub!, author);
    const privatePayload = await SEA.decrypt(response.payloadCiphertext, responseSecret!) as any;
    expect(privatePayload.answers).toEqual([
      { questionId: 'q1', answerId: 'yes', answerText: 'Yes', mode: 'auto' },
    ]);

    const restored = new BackgroundTalkAgent('http://127.0.0.1:8088', path.join(directory, 'journal.sea'));
    await restored.provision(config, receiver as any);
    expect(restored.listEvents()).toHaveLength(1);
    await restored.acknowledge([events[0]!.id]);
    expect(restored.listEvents()).toEqual([]);
  });

  test('does not delete the incoming Talk when durable relay fails', async () => {
    const author = await SEA.pair();
    const receiver = await SEA.pair();
    const payload: P2PMeshTalkBodyPayload = {
      roomId: 'room-1', broadcastAt: new Date(0).toISOString(), talkId: 'talk-1', authorId: 'author',
      authorName: 'Author', authorEpub: author.epub, title: 'Coffee', questionCount: 1,
      talkData: { id: 'talk-1', type: 'flow', questions: [{ id: 'q1', text: 'Coffee?', answers: [{ id: 'yes', text: 'Yes', isMatch: true }] }] },
    };
    const secret = await SEA.secret(receiver.epub, author);
    const ciphertext = JSON.stringify({ senderEpub: author.epub, ct: await SEA.encrypt(JSON.stringify(payload), secret!) });
    const methods: string[] = [];
    global.fetch = jest.fn(async (input: string | URL | Request, init?: RequestInit) => {
      methods.push(init?.method || 'GET');
      if (String(input).includes('/block-status/')) {
        return new Response(JSON.stringify({ eitherBlocked: false }), { status: 200 });
      }
      if (!init?.method) return new Response(JSON.stringify({ envelopes: [{ id: 'body-1', ciphertext }] }), { status: 200 });
      return new Response(JSON.stringify({ stored: true }), { status: 201 });
    }) as typeof fetch;
    const agent = new BackgroundTalkAgent(
      'http://127.0.0.1:8088',
      path.join(directory, 'journal.sea'),
      async () => { throw new Error('hub offline'); },
    );
    await agent.provision({
      version: 1, enabled: true, userId: 'receiver', stageName: 'Receiver', activeRoomId: 'room-1',
      autoAnswerEnabled: true,
      answerRules: [{ questionText: 'Coffee?', answerTexts: ['Yes'], selectedAnswerTexts: ['Yes'], selectionMode: 'single' }],
      chatbotTemplates: {}, authoredTalks: {}, intakeFilters, ageVerified: true,
    }, receiver as any);
    await expect(agent.drain()).resolves.toEqual([]);
    expect(methods).toEqual(['GET', 'GET', 'POST']);
    expect(agent.listEvents()).toEqual([]);
  });

  test('consumes a blocked Talk without answering or journaling it', async () => {
    const author = await SEA.pair();
    const receiver = await SEA.pair();
    const payload: P2PMeshTalkBodyPayload = {
      roomId: 'room-1', broadcastAt: new Date(0).toISOString(), talkId: 'talk-1', authorId: 'blocked-author',
      authorName: 'Blocked', authorEpub: author.epub, title: 'Coffee', questionCount: 1,
      talkData: { id: 'talk-1', type: 'flow', language: 'en', questions: [{ id: 'q1', text: 'Coffee?', answers: [{ id: 'yes', text: 'Yes' }] }] },
    };
    const secret = await SEA.secret(receiver.epub, author);
    const ciphertext = JSON.stringify({ senderEpub: author.epub, ct: await SEA.encrypt(JSON.stringify(payload), secret!) });
    const methods: string[] = [];
    global.fetch = jest.fn(async (input: string | URL | Request, init?: RequestInit) => {
      methods.push(init?.method || 'GET');
      if (String(input).includes('/block-status/')) {
        return new Response(JSON.stringify({ eitherBlocked: true }), { status: 200 });
      }
      if (!init?.method) return new Response(JSON.stringify({ envelopes: [{ id: 'blocked-1', ciphertext }] }), { status: 200 });
      if (init.method === 'DELETE') return new Response(JSON.stringify({ deleted: true }), { status: 200 });
      return new Response('', { status: 500 });
    }) as typeof fetch;
    const relay = jest.fn(async () => undefined);
    const agent = new BackgroundTalkAgent('http://127.0.0.1:8088', path.join(directory, 'journal.sea'), relay);
    await agent.provision({
      version: 1, enabled: true, userId: 'receiver', stageName: 'Receiver', activeRoomId: 'room-1',
      autoAnswerEnabled: true,
      answerRules: [{ questionText: 'Coffee?', answerTexts: ['Yes'], selectedAnswerTexts: ['Yes'], selectionMode: 'single' }],
      chatbotTemplates: {}, authoredTalks: {}, intakeFilters, ageVerified: true,
    }, receiver as any);

    await expect(agent.drain()).resolves.toEqual([]);
    expect(methods).toEqual(['GET', 'GET', 'DELETE']);
    expect(relay).not.toHaveBeenCalled();
    expect(agent.listEvents()).toEqual([]);
  });
});
