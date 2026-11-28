/** @jest-environment jsdom */
import { registerConnectivityEventHandlers } from '../../web/app/connectivity-event-handlers';
import { registerConversationSessionHandlers } from '../../web/app/conversation-session-handlers';

describe('final composition registrars', () => {
  it('registers connectivity commands as one feature surface', () => {
    const names: string[] = [];
    registerConnectivityEventHandlers({
      ui: { on: (name: string) => names.push(name) } as any,
      pruneContacts: jest.fn(), applySettings: jest.fn(), setMatchCollection: jest.fn(),
    });
    expect(names).toEqual(['contactsCapChanged', 'connectivitySettingsChanged', 'matchCollectionSettingChanged']);
  });

  it('registers direct conversation commands as one feature surface', () => {
    const names: string[] = [];
    registerConversationSessionHandlers({
      ui: { on: (name: string) => names.push(name) } as any,
      conversations: {} as any,
      currentUser: () => undefined,
      onConversationAdded: jest.fn(), confirmDeal: jest.fn(), isBlocked: jest.fn(), publishMedia: jest.fn(),
      findOrCreate: jest.fn(), ingestSnapshot: jest.fn(),
    });
    expect(names).toEqual([
      'conversationAdded', 'confirmDeal', 'shareConversationMedia', 'sendDirectMessage',
      'openDirectConversation', 'needConversationSync',
    ]);
  });
});
