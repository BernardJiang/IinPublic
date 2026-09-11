/** @jest-environment jsdom */

import { setTalkDisabled } from '../../web/ui/talk-broadcast-toggle';
import { getMyTalks, setMyTalks, type MyTalkMap } from '../../web/ui/my-talks-storage';

const t = (key: string): string => key;

function seedTalk(talkId: string, disabled = false): void {
  const talks: MyTalkMap = {
    [talkId]: {
      talkId,
      title: 'My Talk',
      type: 'flow',
      timestamp: new Date().toISOString(),
      role: 'created',
      fullTalk: {},
      disabled,
    },
  };
  setMyTalks(talks);
}

function deps(overrides: Partial<Parameters<typeof setTalkDisabled>[2]> = {}) {
  return { emit: jest.fn(), t, displayTalksList: jest.fn(), ...overrides };
}

beforeEach(() => {
  localStorage.clear();
  document.body.innerHTML = '<div id="talks-list"></div>';
});

describe('setTalkDisabled', () => {
  it('is a no-op when the talk does not exist in myTalks', () => {
    const d = deps();
    setTalkDisabled('missing', true, d);
    expect(d.emit).not.toHaveBeenCalled();
    expect(d.displayTalksList).not.toHaveBeenCalled();
  });

  it('persists the disabled flag to myTalks storage', () => {
    seedTalk('t1', false);
    setTalkDisabled('t1', true, deps());
    expect(getMyTalks().t1.disabled).toBe(true);
  });

  it('emits withdrawTalk and retractTalk when disabling', () => {
    seedTalk('t1');
    const d = deps();
    setTalkDisabled('t1', true, d);
    expect(d.emit).toHaveBeenCalledWith('withdrawTalk', { talkId: 't1' });
    expect(d.emit).toHaveBeenCalledWith('retractTalk', expect.objectContaining({ talkId: 't1' }));
  });

  it('emits nothing when re-enabling', () => {
    seedTalk('t1', true);
    const d = deps();
    setTalkDisabled('t1', false, d);
    expect(d.emit).not.toHaveBeenCalled();
  });

  it('patches an already-rendered row in place instead of re-rendering the full list', () => {
    seedTalk('t1');
    document.getElementById('talks-list')!.innerHTML = `
      <div class="talk-list-item" data-talk-id="t1">
        <span class="talk-icon-badge"><input type="checkbox" class="talk-broadcast-toggle-checkbox" checked></span>
      </div>
    `;
    const d = deps();
    setTalkDisabled('t1', true, d);

    const row = document.querySelector('.talk-list-item')!;
    expect(row.classList.contains('talk-broadcast-disabled')).toBe(true);
    expect(row.classList.contains('talk-broadcast-enabled')).toBe(false);
    const checkbox = row.querySelector('.talk-broadcast-toggle-checkbox') as HTMLInputElement;
    expect(checkbox.checked).toBe(false);
    expect((checkbox.closest('.talk-icon-badge') as HTMLElement).title).toBe('talksBroadcastOff');
    expect(d.displayTalksList).not.toHaveBeenCalled();
  });

  it('falls back to a full re-render when the talk has no rendered row', () => {
    seedTalk('t1');
    const d = deps();
    setTalkDisabled('t1', true, d);
    expect(d.displayTalksList).toHaveBeenCalledTimes(1);
  });

  it('re-enabling sets the enabled class/badge/checkbox state on an existing row', () => {
    seedTalk('t1', true);
    document.getElementById('talks-list')!.innerHTML = `
      <div class="talk-list-item talk-broadcast-disabled" data-talk-id="t1">
        <span class="talk-icon-badge"><input type="checkbox" class="talk-broadcast-toggle-checkbox"></span>
      </div>
    `;
    setTalkDisabled('t1', false, deps());
    const row = document.querySelector('.talk-list-item')!;
    expect(row.classList.contains('talk-broadcast-enabled')).toBe(true);
    expect((row.querySelector('.talk-broadcast-toggle-checkbox') as HTMLInputElement).checked).toBe(true);
  });
});
