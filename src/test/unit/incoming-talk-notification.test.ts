/** @jest-environment jsdom */

import { displayIncomingTalk } from '../../web/ui/incoming-talk-notification';

const tf = (key: string, vars: Record<string, string | number>): string => `${key}(${JSON.stringify(vars)})`;

function deps(overrides: Partial<Parameters<typeof displayIncomingTalk>[1]> = {}) {
  return {
    showNotification: jest.fn(),
    tf,
    flashMemberForNewTalk: jest.fn(),
    refreshTalksListIfActive: jest.fn(),
    ...overrides,
  };
}

function talk(overrides: Partial<Parameters<typeof displayIncomingTalk>[0]> = {}) {
  return {
    id: 't1',
    title: 'My Talk',
    authorName: 'Alice',
    type: 'flow',
    questionCount: 1,
    timestamp: new Date().toISOString(),
    isOwnTalk: false,
    fullTalk: { authorId: 'u1' },
    ...overrides,
  };
}

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('displayIncomingTalk', () => {
  it('shows a notification and flashes the author for a talk from someone else', () => {
    const d = deps();
    displayIncomingTalk(talk(), d);
    expect(d.showNotification).toHaveBeenCalledWith(
      tf('newTalkNotification', { name: 'Alice', title: 'My Talk' }),
      'info',
    );
    expect(d.flashMemberForNewTalk).toHaveBeenCalledWith('u1');
  });

  it('does not notify or flash for the user\'s own talk', () => {
    const d = deps();
    displayIncomingTalk(talk({ isOwnTalk: true }), d);
    expect(d.showNotification).not.toHaveBeenCalled();
    expect(d.flashMemberForNewTalk).not.toHaveBeenCalled();
  });

  it('does not flash when the full talk has no authorId', () => {
    const d = deps();
    displayIncomingTalk(talk({ fullTalk: {} }), d);
    expect(d.showNotification).toHaveBeenCalledTimes(1);
    expect(d.flashMemberForNewTalk).not.toHaveBeenCalled();
  });

  it('refreshes the talks list only when the Talks tab is currently active', () => {
    const d = deps();
    displayIncomingTalk(talk(), d);
    expect(d.refreshTalksListIfActive).not.toHaveBeenCalled();

    document.body.innerHTML = '<div id="tab-talks" class="active"></div>';
    displayIncomingTalk(talk(), d);
    expect(d.refreshTalksListIfActive).toHaveBeenCalledTimes(1);
  });

  it('still refreshes the talks list for the user\'s own talk when the Talks tab is active', () => {
    document.body.innerHTML = '<div id="tab-talks" class="active"></div>';
    const d = deps();
    displayIncomingTalk(talk({ isOwnTalk: true }), d);
    expect(d.refreshTalksListIfActive).toHaveBeenCalledTimes(1);
  });
});
