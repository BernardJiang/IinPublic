import { computeTalkIdFromTalkData } from '../../shared/cid';
import { buildTagIdentityKeys } from '../../shared/talk-ledger';
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
      'flow-2': {
        role: 'created',
        fullTalk: {
          ...flowTalk,
          id: 'flow-2',
          title: 'Flow 2',
          questions: [{ id: 'q1', text: 'Ready again?', answers: [{ id: 'yes', text: 'Yes' }] }],
        },
      },
    }),
    getBroadcastableTalkIds: () => ['flow-1', 'flow-2'],
    shouldSuppressForPeer: () => false,
    ...overrides,
  };
}

describe('broadcast delivery selection', () => {
  it('treats a missing local talk as unsent without consulting the ledger', () => {
    const shouldSuppressForPeer = jest.fn(() => true);
    expect(isBroadcastUnsentForReceiver('peer-1', 'missing', makeDeps({ shouldSuppressForPeer })))
      .toBe(true);
    expect(shouldSuppressForPeer).not.toHaveBeenCalled();
  });

  it('checks a non-tag talk by its whole-content identity', () => {
    const shouldSuppressForPeer = jest.fn(() => true);
    expect(isBroadcastUnsentForReceiver('peer-1', 'flow-1', makeDeps({ shouldSuppressForPeer })))
      .toBe(false);
    expect(shouldSuppressForPeer).toHaveBeenCalledWith(
      'peer-1',
      computeTalkIdFromTalkData(flowTalk),
    );
  });

  it('uses a bare stored talk when no fullTalk wrapper is present', () => {
    const bareTalk = { ...flowTalk, id: 'bare' };
    const shouldSuppressForPeer = jest.fn(() => false);
    const deps = makeDeps({ getMyTalks: () => ({ bare: bareTalk }), shouldSuppressForPeer });
    expect(isBroadcastUnsentForReceiver('peer-1', 'bare', deps)).toBe(true);
    expect(shouldSuppressForPeer).toHaveBeenCalledWith(
      'peer-1',
      computeTalkIdFromTalkData(bareTalk),
    );
  });

  it('keeps a multi-option tag talk unsent while any tag identity is still owed', () => {
    const tagTalk = {
      id: 'tag-1',
      type: 'tag',
      questions: [{ text: 'Pick one', answers: [{ text: 'Tennis' }, { text: 'Chess' }] }],
    };
    const keys = buildTagIdentityKeys(tagTalk, computeTalkIdFromTalkData(tagTalk));
    const shouldSuppressForPeer = jest.fn((_peerId: string, key: string) => key === keys[0]);
    const deps = makeDeps({
      getMyTalks: () => ({ 'tag-1': { fullTalk: tagTalk } }),
      shouldSuppressForPeer,
    });
    expect(isBroadcastUnsentForReceiver('peer-1', 'tag-1', deps)).toBe(true);
    expect(shouldSuppressForPeer.mock.calls.map(([, key]) => key)).toEqual(keys);
  });

  it('suppresses a multi-option tag talk only when every tag identity was sent', () => {
    const tagTalk = {
      id: 'tag-1',
      type: 'tag',
      questions: [{ text: 'Pick one', answers: [{ text: 'Tennis' }, { text: 'Chess' }] }],
    };
    const deps = makeDeps({
      getMyTalks: () => ({ 'tag-1': { fullTalk: tagTalk } }),
      shouldSuppressForPeer: () => true,
    });
    expect(isBroadcastUnsentForReceiver('peer-1', 'tag-1', deps)).toBe(false);
  });

  it('selects broadcastable talks owed to at least one receiver', () => {
    const deps = makeDeps({
      shouldSuppressForPeer: (receiverId, identityKey) =>
        receiverId === 'peer-1' || identityKey === computeTalkIdFromTalkData(flowTalk),
    });
    expect(getUnsentBroadcastTalkIds(['peer-1', 'peer-2'], deps)).toEqual(['flow-2']);
  });

  it('selects broadcastable talks for one receiver', () => {
    const flow1Key = computeTalkIdFromTalkData(flowTalk);
    const deps = makeDeps({ shouldSuppressForPeer: (_receiverId, key) => key === flow1Key });
    expect(getUnsentBroadcastTalkIdsForReceiver('peer-1', deps)).toEqual(['flow-2']);
  });

  it('builds an independent receiver list for every requested talk', () => {
    const flow1Key = computeTalkIdFromTalkData(flowTalk);
    const deps = makeDeps({
      shouldSuppressForPeer: (receiverId, key) => receiverId === 'peer-1' && key === flow1Key,
    });
    expect(getUnsentBroadcastTalkReceiverIds(['flow-1', 'flow-2'], ['peer-1', 'peer-2'], deps))
      .toEqual({
        'flow-1': ['peer-2'],
        'flow-2': ['peer-1', 'peer-2'],
      });
  });
});
