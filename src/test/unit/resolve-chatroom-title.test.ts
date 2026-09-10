import { resolveChatroomTitle } from '../../web/ui/chatrooms-view';
import type { CustomChatroomRow } from '../../web/ui/chatrooms-view';

jest.mock('../../shared/chatroom-hierarchy', () => ({
  getFlatChatroomList: jest.fn(),
  getActiveChatroomHierarchy: jest.fn(),
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const hierarchy = require('../../shared/chatroom-hierarchy');

function customRoom(overrides: Partial<CustomChatroomRow> = {}): CustomChatroomRow {
  return { id: 'c1', name: 'My Room', type: 'social', ...overrides };
}

beforeEach(() => {
  hierarchy.getFlatChatroomList.mockReturnValue([]);
  hierarchy.getActiveChatroomHierarchy.mockReturnValue({ id: 'global', name: 'Global', icon: '🌍', description: '' });
});

describe('resolveChatroomTitle', () => {
  it('prefers a custom social room, prefixed with 💬', () => {
    expect(resolveChatroomTitle('c1', [customRoom({ type: 'social' })])).toBe('💬 My Room');
  });

  it('prefixes a custom business room with 🏪', () => {
    expect(resolveChatroomTitle('c1', [customRoom({ type: 'business' })])).toBe('🏪 My Room');
  });

  it('falls back to the flat hierarchy list when no custom room matches', () => {
    hierarchy.getFlatChatroomList.mockReturnValue([{ id: 'global', name: 'Global', icon: '🌍' }]);
    expect(resolveChatroomTitle('global', [])).toBe('🌍 Global');
  });

  it('falls back to a depth-first tree search when the id is absent from the flat list', () => {
    hierarchy.getActiveChatroomHierarchy.mockReturnValue({
      id: 'global',
      name: 'Global',
      icon: '🌍',
      description: '',
      children: [
        { id: 'north-america', name: 'North America', icon: '🌎', description: '', children: [
          { id: 'usa', name: 'United States', icon: '🇺🇸', description: '' },
        ] },
      ],
    });
    expect(resolveChatroomTitle('usa', [])).toBe('United States');
  });

  it('falls back to a title-cased id when nothing matches anywhere', () => {
    expect(resolveChatroomTitle('some-unknown-room', [])).toBe('Some Unknown Room');
  });

  it('a custom room takes precedence over an identically-id\'d hierarchy entry', () => {
    hierarchy.getFlatChatroomList.mockReturnValue([{ id: 'global', name: 'Global', icon: '🌍' }]);
    expect(resolveChatroomTitle('global', [customRoom({ id: 'global', name: 'Custom Global' })])).toBe('💬 Custom Global');
  });
});
