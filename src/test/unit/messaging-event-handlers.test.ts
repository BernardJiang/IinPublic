import {
  registerMessagingEventHandlers,
  type MessagingEventHandlerDeps,
} from '../../web/app/messaging-event-handlers';

const setup = () => {
  const handlers = new Map<string, (...args: any[]) => unknown>();
  const ui: Record<string, any> = {
    on: jest.fn((name: string, handler: (...args: any[]) => unknown) => handlers.set(name, handler)),
    showNotification: jest.fn(),
    displayChatroomMessage: jest.fn(),
    displayConversationMessages: jest.fn(async () => undefined),
    syncConversationMessageSummary: jest.fn(),
    getMyConversations: jest.fn(() => ({
      'conversation-1': { otherUserId: 'peer' },
      'support-1': { otherUserId: 'iinpublic-root-techsupport', supportChannel: true },
    })),
    formatNotInChatroom: jest.fn(() => 'not in room'),
    formatMessageSent: jest.fn(() => 'sent'),
    formatMessageSendFailed: jest.fn((message) => `failed: ${message}`),
    formatConversationLoadFailed: jest.fn((message) => `load failed: ${message}`),
  };
  const conversations = {
    subscribeToMessages: jest.fn(() => () => undefined),
    sendMessage: jest.fn(async () => undefined),
  };
  const deps = {
    ui,
    chatrooms: { getCurrentChatroomId: jest.fn(() => 'nearby-v3') },
    placeChat: { send: jest.fn(async (_roomId, message) => message) },
    conversations,
    currentUser: jest.fn(() => ({ id: 'me', stageName: 'Mine' })),
    graphMessages: jest.fn(async () => []),
    recordSupportMessages: jest.fn(),
    fetchSharedAttachment: jest.fn(async () => undefined),
    handleSupportQuestion: jest.fn(async () => undefined),
    recordConversationLedger: jest.fn(),
    now: jest.fn(() => Date.parse('2026-11-27T12:00:00.000Z')),
    random: jest.fn(() => 0.5),
  } as unknown as MessagingEventHandlerDeps;
  registerMessagingEventHandlers(deps);
  return { deps, handlers, ui, conversations };
};

describe('registerMessagingEventHandlers', () => {
  it('registers place send, conversation load and direct send handlers', () => {
    const { handlers } = setup();
    expect([...handlers.keys()]).toEqual([
      'sendMessage',
      'loadConversation',
      'sendConversationMessage',
    ]);
  });

  it('persists a place message before rendering and acknowledging it', async () => {
    const { deps, handlers, ui } = setup();
    const onPersisted = jest.fn();
    await handlers.get('sendMessage')?.({
      conversationId: 'unused',
      message: 'hello room',
      onPersisted,
    });

    expect(deps.placeChat.send).toHaveBeenCalledWith('nearby-v3', expect.objectContaining({
      text: 'hello room',
      senderId: 'me',
      senderName: 'Mine',
    }));
    expect(onPersisted).toHaveBeenCalledTimes(1);
    expect(ui.displayChatroomMessage).toHaveBeenCalledWith(expect.objectContaining({
      text: 'hello room',
      isOwnMessage: true,
    }));
  });

  it('merges live conversation messages and fetches received attachment shares', async () => {
    const { deps, handlers, ui, conversations } = setup();
    (conversations.subscribeToMessages as jest.Mock).mockImplementation(
      (_id: string, listener: (messages: any[]) => void) => {
        listener([{
          id: 'message-1',
          senderId: 'peer',
          text: 'IPFS_SHARE:{"kind":"ipfs-auto-share-v1","conversationId":"conversation-1","talkId":"talk-1","authorId":"peer","cid":"bafy-test","link":"ipfs://bafy-test","name":"photo.jpg","mimeType":"image/jpeg","sizeBytes":1,"enc":"none","keyCiphertext":"SEA{}","sharedAt":"2026-11-27T12:00:00.000Z"}',
          timestamp: '2026-11-27T12:00:00.000Z',
        }]);
        return () => undefined;
      },
    );
    await handlers.get('loadConversation')?.({ conversationId: 'conversation-1' });
    await Promise.resolve();

    expect(ui.displayConversationMessages).toHaveBeenCalled();
    expect(ui.syncConversationMessageSummary).toHaveBeenCalledWith(
      'conversation-1',
      expect.any(Array),
      'me',
    );
    expect(deps.fetchSharedAttachment).toHaveBeenCalledWith(
      expect.objectContaining({ cid: 'bafy-test' }),
      'peer',
    );
  });

  it('sends a direct support message before starting follow-up and ledger effects', async () => {
    const { deps, handlers, conversations } = setup();
    const onPersisted = jest.fn();
    await handlers.get('sendConversationMessage')?.({
      conversationId: 'support-1',
      message: 'help',
      talkId: 'talk-1',
      onPersisted,
    });

    expect(conversations.sendMessage).toHaveBeenCalledWith(
      'support-1',
      'me',
      'help',
      expect.objectContaining({
        otherUserId: 'iinpublic-root-techsupport',
        talkId: 'talk-1',
      }),
    );
    expect(onPersisted).toHaveBeenCalledTimes(1);
    expect(deps.handleSupportQuestion).toHaveBeenCalledWith(
      'support-1',
      expect.stringMatching(/^msg_/),
      'help',
    );
    expect(deps.recordConversationLedger).toHaveBeenCalledWith(
      'support-1',
      expect.stringMatching(/^msg_/),
    );
  });
});
