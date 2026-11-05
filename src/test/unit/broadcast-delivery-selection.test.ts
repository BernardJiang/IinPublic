/** Which of my Talks each person is still owed (the broadcast's target selection). */
import {
  type BroadcastDeliverySelectionDeps,
  getUnsentBroadcastTalkIds,
  getUnsentBroadcastTalkIdsForReceiver,
  getUnsentBroadcastTalkReceiverIds,
  isBroadcastUnsentForReceiver,
} from '../../web/ui/broadcast-delivery-selection';

const flowTalk = {
  id: 'flow-1',
  type: 'flow',
  title: 'Flow',
  questions: [{ id: 'q1', text: 'Ready?', answers: [{ id: 'yes', text: 'Yes' }] }],
};

function makeDeps(overrides: Partial<BroadcastDeliverySelectionDeps> = {}): BroadcastDeliverySelectionDeps {
  return {
    getMyTalks: () => ({
      'flow-1': { role: 'created', fullTalk: flowTalk },
      'flow-2': { role: 'created', fullTalk: { ...flowTalk, id: 'flow-2', questions: [{ id: 'q1', text: 'Ready again?', answers: [{ id: 'yes', text: 'Yes' }] }] } },
    }),
    getBroadcastableTalkIds: () => ['flow-1', 'flow-2'],
    owedTo: () => true,
    ...overrides,
  };
}

describe('broadcast delivery selection', () => {
  it('treats a missing local talk as unsent without asking', () => {
    const owedTo = jest.fn(() => false);
    expect(isBroadcastUnsentForReceiver('peer-1', 'missing', makeDeps({ owedTo }))).toBe(true);
    expect(owedTo).not.toHaveBeenCalled();
  });

  it('asks with the stored body, wrapped or bare', () => {
    const owedTo = jest.fn(() => false);
    expect(isBroadcastUnsentForReceiver('peer-1', 'flow-1', makeDeps({ owedTo }))).toBe(false);
    expect(owedTo).toHaveBeenCalledWith('peer-1', 'flow-1', flowTalk);
    const bare = { ...flowTalk, id: 'bare' };
    isBroadcastUnsentForReceiver('peer-1', 'bare', makeDeps({ owedTo, getMyTalks: () => ({ bare }) }));
    expect(owedTo).toHaveBeenLastCalledWith('peer-1', 'bare', bare);
  });

  it('selects talks owed to at least one receiver, to one receiver, and per talk', () => {
    const owedTo = (receiverId: string, talkId: string) => !(receiverId === 'peer-1' && talkId === 'flow-1');
    const deps = makeDeps({ owedTo });
    expect(getUnsentBroadcastTalkIds(['peer-1'], deps)).toEqual(['flow-2']);
    expect(getUnsentBroadcastTalkIds(['peer-1', 'peer-2'], deps)).toEqual(['flow-1', 'flow-2']);
    expect(getUnsentBroadcastTalkIdsForReceiver('peer-1', deps)).toEqual(['flow-2']);
    expect(getUnsentBroadcastTalkReceiverIds(['flow-1', 'flow-2'], ['peer-1', 'peer-2'], deps)).toEqual({
      'flow-1': ['peer-2'],
      'flow-2': ['peer-1', 'peer-2'],
    });
  });
});
