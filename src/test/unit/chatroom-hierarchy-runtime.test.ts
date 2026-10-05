import {
  CHATROOM_HIERARCHY,
  applyPublicChatroomHierarchy,
  getAllChatroomIds,
  mergeChatroomHierarchy,
} from '../../shared/chatroom-hierarchy';

describe('public chatroom hierarchy bootstrap', () => {
  it('keeps the bundled hierarchy and accepts remote child additions', () => {
    const merged = mergeChatroomHierarchy(CHATROOM_HIERARCHY, {
      ...CHATROOM_HIERARCHY,
      children: [...(CHATROOM_HIERARCHY.children || []), {
        id: 'remote-room', name: 'Remote Room', icon: '#', description: 'Published room',
      }],
    });
    expect(merged.children?.some((child) => child.id === 'remote-room')).toBe(true);
    expect(merged.children?.some((child) => child.id === 'north-america')).toBe(true);
  });

  it('rejects malformed remote hierarchy data', () => {
    expect(mergeChatroomHierarchy(CHATROOM_HIERARCHY, { id: 'global', children: [{ id: 'bad' }] }))
      .toBe(CHATROOM_HIERARCHY);
  });

  it('applies serialized public additions to the runtime room list', () => {
    applyPublicChatroomHierarchy(JSON.stringify({
      ...CHATROOM_HIERARCHY,
      children: [...(CHATROOM_HIERARCHY.children || []), {
        id: 'remote-runtime-room', name: 'Runtime Room', icon: '#', description: 'Remote addition',
      }],
    }));
    expect(getAllChatroomIds()).toContain('remote-runtime-room');
    applyPublicChatroomHierarchy(CHATROOM_HIERARCHY);
  });
});
