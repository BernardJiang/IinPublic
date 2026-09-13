/** @jest-environment jsdom */

import { createBroadcastController, type BroadcastControllerDeps } from '../../web/ui/broadcast-controller';
import {
  getUnsentBroadcastTalkIds,
  getUnsentBroadcastTalkIdsForReceiver,
  getUnsentBroadcastTalkReceiverIds,
} from '../../web/ui/broadcast-delivery-selection';

jest.mock('../../web/ui/broadcast-delivery-selection', () => ({
  getUnsentBroadcastTalkIds: jest.fn(),
  getUnsentBroadcastTalkIdsForReceiver: jest.fn(),
  getUnsentBroadcastTalkReceiverIds: jest.fn(),
}));

const unsent = getUnsentBroadcastTalkIds as jest.MockedFunction<typeof getUnsentBroadcastTalkIds>;
const unsentForReceiver = getUnsentBroadcastTalkIdsForReceiver as jest.MockedFunction<typeof getUnsentBroadcastTalkIdsForReceiver>;
const receiversByTalk = getUnsentBroadcastTalkReceiverIds as jest.MockedFunction<typeof getUnsentBroadcastTalkReceiverIds>;

function makeDeps(overrides: Partial<BroadcastControllerDeps> = {}): BroadcastControllerDeps {
  return {
    getCurrentChatroom: () => 'global',
    setCurrentChatroom: jest.fn(),
    getCurrentUserId: () => 'self',
    getCurrentChatroomMembers: () => [],
    getKnownPeople: () => [],
    getBlockedUserIds: () => [],
    getBroadcastableTalkIds: () => ['talk-1'],
    getMyTalks: () => ({ 'talk-1': { title: 'First talk' } }),
    getPeerName: (userId) => userId,
    showNotification: jest.fn(),
    showTalkEditorDialog: jest.fn(),
    maybeShowPreSendSafetyToast: jest.fn(),
    emit: jest.fn(),
    t: (key) => String(key),
    tf: (key, vars) => `${String(key)}:${vars.count}`,
    ...overrides,
  };
}

describe('broadcast controller', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    jest.clearAllMocks();
    unsent.mockReturnValue(['talk-1']);
    unsentForReceiver.mockReturnValue(['talk-1']);
    receiversByTalk.mockReturnValue({ 'talk-1': ['peer-1'] });
  });

  it('deduplicates current and rendered roster peers and excludes the current user', () => {
    document.body.innerHTML = `<div id="chatroom-members-list">
      <div class="chatroom-member-item" data-user-id="peer-1" data-stage-name="Peer"></div>
      <div class="chatroom-member-item" data-user-id="self"></div>
    </div>`;
    const controller = createBroadcastController(makeDeps({
      getCurrentChatroomMembers: () => [
        { userId: 'peer-1', stageName: 'Peer' },
        { userId: 'peer-2', stageName: 'Second' },
      ],
    }));

    expect(controller.getPendingBroadcastTalkIds()).toEqual(['talk-1']);
    expect(unsent).toHaveBeenCalledWith(['peer-1', 'peer-2']);
  });

  it('catches up each late member with only that peer pending batch', () => {
    unsentForReceiver.mockImplementation((userId) => userId === 'peer-1' ? ['talk-1'] : []);
    const emit = jest.fn();
    const controller = createBroadcastController(makeDeps({ emit }));

    controller.broadcastPendingTalksToMembers([
      { userId: 'peer-1', stageName: 'One' },
      { userId: 'peer-2', stageName: 'Two' },
    ]);

    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit).toHaveBeenCalledWith('broadcastTalk', expect.objectContaining({
      chatroomId: 'global',
      talkIds: ['talk-1'],
      members: [{ userId: 'peer-1', stageName: 'One' }],
      automatic: true,
    }));
  });

  it('shows the open-room notice when neither manager nor app supplies a room', async () => {
    const showNotification = jest.fn();
    const controller = createBroadcastController(makeDeps({
      getCurrentChatroom: () => '',
      showNotification,
    }));

    await controller.runBroadcastFromCurrentRoom(false);

    expect(showNotification).toHaveBeenCalledWith('chatroomOpenFirst', 'info');
  });

  it('emits a manual room broadcast with per-talk receiver narrowing', async () => {
    document.body.innerHTML = `<div id="chatroom-members-list">
      <div class="chatroom-member-item" data-user-id="peer-1" data-stage-name="One"></div>
    </div>`;
    const emit = jest.fn();
    const maybeShowPreSendSafetyToast = jest.fn();
    const controller = createBroadcastController(makeDeps({ emit, maybeShowPreSendSafetyToast }));

    await controller.runBroadcastFromCurrentRoom(false);

    expect(receiversByTalk).toHaveBeenCalledWith(['talk-1'], ['peer-1']);
    expect(maybeShowPreSendSafetyToast).toHaveBeenCalledTimes(1);
    expect(emit).toHaveBeenCalledWith('broadcastTalk', expect.objectContaining({
      chatroomId: 'global',
      talkIds: ['talk-1'],
      talkReceiverIds: { 'talk-1': ['peer-1'] },
      automatic: false,
    }));
  });

  it('renders group membership excluding blocked peers and emits the selected target', () => {
    const emit = jest.fn();
    const controller = createBroadcastController(makeDeps({
      getKnownPeople: () => [
        { userId: 'friend', stageName: 'Friend', labels: ['friend'], addedAt: new Date(0) },
        { userId: 'blocked', stageName: 'Blocked', labels: ['friend'], addedAt: new Date(0) },
      ],
      getBlockedUserIds: () => ['blocked'],
      getPeerName: (id) => id === 'friend' ? 'Friendly' : id,
      emit,
    }));

    controller.showBroadcastToGroupDialog();
    const select = document.querySelector('[data-testid="broadcast-group-select"]') as HTMLSelectElement;
    select.value = 'friend';
    select.dispatchEvent(new Event('change'));
    expect(document.querySelector('[data-testid="broadcast-group-preview"]')?.textContent).toBe('broadcastGroupPreview:1');
    (document.querySelector('[data-testid="broadcast-group-confirm"]') as HTMLButtonElement).click();

    expect(emit).toHaveBeenCalledWith('broadcastToContactGroup', {
      talkId: 'talk-1',
      members: [{ userId: 'friend', stageName: 'Friendly' }],
    });
    expect(document.getElementById('broadcast-group-modal')).toBeNull();
  });
});
