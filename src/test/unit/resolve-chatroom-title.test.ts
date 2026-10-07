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

  it('labels non-geographic Global overflow rooms as Global groups', () => {
    expect(resolveChatroomTitle('global-unknown', [])).toBe('🌍 Global · Group 2');
    expect(resolveChatroomTitle('global-unknown_part_2', [])).toBe('🌍 Global · Group 3');
  });

  it('titles coarse coordinate cell rooms by the nearest named place, not the raw id', () => {
    hierarchy.getFlatChatroomList.mockReturnValue([
      { id: 'california', name: 'California', icon: '🌉' },
      { id: 'san-diego', name: 'San Diego', icon: '🌴' },
    ]);
    expect(resolveChatroomTitle('region_32.71_-117.17_room_0', [])).toBe('📍 Near San Diego');
    expect(resolveChatroomTitle('region_32.71_-117.17_room_2', [])).toBe('📍 Near San Diego · Group 3');
    expect(resolveChatroomTitle('region_32.71_-117.17_room_0_part_2', [])).toBe('📍 Near San Diego (2)');
    hierarchy.getFlatChatroomList.mockReturnValue([]);
    expect(resolveChatroomTitle('region_-80.00_10.00_room_0', [])).toBe('📍 Nearby');
  });
});
