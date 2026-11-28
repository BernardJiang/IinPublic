/** @jest-environment jsdom */
import { registerTalkEventHandlers } from '../../web/app/talk-event-handlers';

describe('registerTalkEventHandlers', () => {
  it('registers the complete Talk command surface', () => {
    const names: string[] = [];
    const ui = { on: (name: string) => names.push(name) };
    registerTalkEventHandlers({
      ui: ui as any,
      talks: {} as any,
      currentUser: () => undefined,
      authorLocation: () => undefined,
      publishMediaFile: jest.fn(),
      pinAttachments: jest.fn(),
      broadcastCreated: jest.fn(),
      emitLedger: jest.fn(),
      exchangeCurrentList: jest.fn(),
      schedulePublishedExchange: jest.fn(),
      retractTalk: jest.fn(),
      resolveFullTalk: jest.fn(),
      loadFullTalkByIdentity: jest.fn(),
      refreshIncoming: jest.fn(),
      applyStats: jest.fn(),
      completeTalk: jest.fn(),
      syncBackgroundAgent: jest.fn(),
    });
    expect(names).toEqual([
      'sendTalkToUser', 'createTalk', 'finalizeCaptureSession', 'updateTalk', 'withdrawTalk',
      'publishTalk', 'retractTalk', 'demandFullTalk', 'demandFullTalkByIdentity', 'loadTalkForEdit',
      'needIncomingTalkClusters', 'needTalkStats', 'talkCompleted', 'answerQuestion',
    ]);
  });
});
