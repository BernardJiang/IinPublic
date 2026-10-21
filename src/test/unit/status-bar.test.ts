/** @jest-environment jsdom */

import { countMatchConversations, syncStatusBarMatchCount, updateStatusBar } from '../../web/ui/status-bar';

const tf = (key: string, vars: Record<string, string | number>): string => `${key}(${vars.count})`;

beforeEach(() => {
  document.body.innerHTML = '<span id="status-bar-text"></span>';
});

describe('updateStatusBar', () => {
  it('does nothing when the status bar element is absent', () => {
    document.body.innerHTML = '';
    expect(() => updateStatusBar('Global', 3, undefined, { tf, getTotalMatches: () => 0 })).not.toThrow();
  });

  it('renders the room name and singular user count', () => {
    updateStatusBar('Global', 1, undefined, { tf, getTotalMatches: () => 0 });
    expect(document.getElementById('status-bar-text')!.textContent).toBe('Global · statusBarUser(1)');
  });

  it('renders the plural user count for any count other than 1', () => {
    updateStatusBar('Global', 5, undefined, { tf, getTotalMatches: () => 0 });
    expect(document.getElementById('status-bar-text')!.textContent).toBe('Global · statusBarUsers(5)');

    updateStatusBar('Global', 0, undefined, { tf, getTotalMatches: () => 0 });
    expect(document.getElementById('status-bar-text')!.textContent).toBe('Global · statusBarUsers(0)');
  });

  it('appends the match suffix, singular vs plural, when there are matches', () => {
    updateStatusBar('Global', 3, undefined, { tf, getTotalMatches: () => 1 });
    expect(document.getElementById('status-bar-text')!.textContent).toBe('Global · statusBarUsers(3) · statusBarMatch(1)');

    updateStatusBar('Global', 3, undefined, { tf, getTotalMatches: () => 4 });
    expect(document.getElementById('status-bar-text')!.textContent).toBe('Global · statusBarUsers(3) · statusBarMatches(4)');
  });

  it('omits the match suffix entirely when there are no matches', () => {
    updateStatusBar('Global', 3, undefined, { tf, getTotalMatches: () => 0 });
    expect(document.getElementById('status-bar-text')!.textContent).toBe('Global · statusBarUsers(3)');
  });

  it('prefers the local getTotalMatches() count over a passed-in fallback when local is positive', () => {
    updateStatusBar('Global', 3, 99, { tf, getTotalMatches: () => 2 });
    expect(document.getElementById('status-bar-text')!.textContent).toContain('statusBarMatches(2)');
  });

  it('falls back to the passed-in totalMatches when the local count is zero', () => {
    updateStatusBar('Global', 3, 7, { tf, getTotalMatches: () => 0 });
    expect(document.getElementById('status-bar-text')!.textContent).toContain('statusBarMatches(7)');
  });

  it('stores the pre-match-suffix text in data-status-bar-base', () => {
    updateStatusBar('Global', 3, undefined, { tf, getTotalMatches: () => 2 });
    expect((document.getElementById('status-bar-text') as HTMLElement).dataset.statusBarBase).toBe('Global · statusBarUsers(3)');
  });
});

describe('syncStatusBarMatchCount', () => {
  it('does nothing when the status bar element is absent', () => {
    document.body.innerHTML = '';
    expect(() => syncStatusBarMatchCount({ tf, getTotalMatches: () => 0 })).not.toThrow();
  });

  it('reuses the base stashed by updateStatusBar and appends the new match count', () => {
    updateStatusBar('Global', 3, undefined, { tf, getTotalMatches: () => 0 });
    syncStatusBarMatchCount({ tf, getTotalMatches: () => 2 });
    expect(document.getElementById('status-bar-text')!.textContent).toBe('Global · statusBarUsers(3) · statusBarMatches(2)');
  });

  it('falls back to stripping a legacy English match suffix when no base is stashed', () => {
    document.getElementById('status-bar-text')!.textContent = 'Global · 3 users · 1 match';
    syncStatusBarMatchCount({ tf, getTotalMatches: () => 5 });
    expect(document.getElementById('status-bar-text')!.textContent).toBe('Global · 3 users · statusBarMatches(5)');
  });

  it('renders the base alone when there are no matches', () => {
    updateStatusBar('Global', 3, undefined, { tf, getTotalMatches: () => 0 });
    syncStatusBarMatchCount({ tf, getTotalMatches: () => 0 });
    expect(document.getElementById('status-bar-text')!.textContent).toBe('Global · statusBarUsers(3)');
  });

  it('uses the singular match text for exactly one match', () => {
    updateStatusBar('Global', 3, undefined, { tf, getTotalMatches: () => 0 });
    syncStatusBarMatchCount({ tf, getTotalMatches: () => 1 });
    expect(document.getElementById('status-bar-text')!.textContent).toBe('Global · statusBarUsers(3) · statusBarMatch(1)');
  });
});

describe('two-line status title', () => {
  it('shows the room name and the counts on separate lines, with the full text kept and expandable', () => {
    document.body.innerHTML = '<span id="status-bar-text"></span>';
    updateStatusBar('📍 Nearby', 3, 2, { tf: (key, vars) => `${vars.count} ${key === 'statusBarUsers' ? 'users' : 'matches'}`, getTotalMatches: () => 0 });
    const bar = document.getElementById('status-bar-text')!;
    expect(bar.querySelector('.status-bar-name')?.textContent).toBe('📍 Nearby');
    expect(bar.querySelector('.status-bar-meta')?.textContent).toBe('3 users · 2 matches');
    expect(bar.textContent).toBe('📍 Nearby · 3 users · 2 matches');
    expect(bar.title).toBe('📍 Nearby · 3 users · 2 matches');
    bar.click();
    expect(bar.classList.contains('status-bar-expanded')).toBe(true);
  });
});

describe('countMatchConversations', () => {
  it('counts conversations that came from a Talk match', () => {
    expect(countMatchConversations({
      a: { talkId: 'talk_1', otherUserId: 'u1' },
      b: { talkId: 'talk_2', otherUserId: 'u2' },
    })).toBe(2);
  });

  it('does not count a DM opened by tapping a person, a support channel, or a record without a Talk', () => {
    expect(countMatchConversations({
      direct: { talkId: 'direct', otherUserId: 'u1' },
      support: { talkId: 'talk_x', supportChannel: true },
      bare: { otherUserId: 'u3' },
      junk: null,
    })).toBe(0);
  });
});
