/** @jest-environment jsdom */
/** The AppBar's links line (owner, 2026-11-16): a tab's numbers open another tab at the same scope. */
import { clearContactsFocus, clearTalksFocus, getTalksFocus } from '../../web/ui/graph-focus';
import { renderStatusLinks, statusLinksHtml } from '../../web/ui/status-links';
import { uiText } from '../../web/ui/ui-translations';

const deps = { escapeHtml: (value: string) => value, text: (key: Parameters<typeof uiText>[1]) => uiText('en', key) };
const exchange = (peerId: string, talkId: string, roomId: string) =>
  ({ [`${peerId}::${talkId}`]: { peerId, peerName: peerId, talkId, type: 'tag', outcome: 'match', direction: 'sent', date: '2026-11-16T10:00:00.000Z', roomId, roomName: 'Nearby' } });

beforeEach(() => {
  document.body.innerHTML = `
    <button class="nav-btn" data-view="contacts"></button><button class="nav-btn" data-view="talks"></button>
    <button class="nav-btn" data-view="me"></button><button class="nav-btn" data-view="chatrooms"></button>
    <input id="contacts-filter-topic"><div id="status-bar-links" hidden></div>`;
  localStorage.clear();
  localStorage.setItem('localTalkExchanges', JSON.stringify({
    ...exchange('ann', 'tag-pizza', 'nearby-v3'),
    ...exchange('ben', 'tag-pizza', 'nearby-v3'),
    ...exchange('ben', 'tag-jazz', 'nearby-v3'),
  }));
});

afterEach(() => {
  clearContactsFocus();
  clearTalksFocus();
});

describe('status links', () => {
  it('Chatrooms: met here, Talks here', () => {
    const html = statusLinksHtml('chatrooms', { ...deps, currentChatroom: 'nearby-v3' });
    expect(html).toContain('2 met here');
    expect(html).toContain('2 Talks here');
  });

  it('Contacts: the Talks exchanged with my contacts', () => {
    const html = statusLinksHtml('contacts', deps);
    expect(html).toContain('data-testid="status-link-talks"');
    expect(html).toContain('2 Talks');
    expect(html).not.toContain('status-link-people');
  });

  it('Talks: the people these Talks reached, and a tap opens Contacts narrowed to them', () => {
    renderStatusLinks('talks', deps);
    const line = document.getElementById('status-bar-links')!;
    expect(line.hidden).toBe(false);
    const people = line.querySelector<HTMLElement>('[data-testid="status-link-people"]')!;
    expect(people.textContent).toContain('2 people');
    expect(people.dataset.peerIds!.split(' ').sort()).toEqual(['ann', 'ben']);
  });

  it('Contacts → Talks opens Talks narrowed to those Talks', () => {
    renderStatusLinks('contacts', deps);
    document.querySelector<HTMLElement>('[data-testid="status-link-talks"]')!.click();
    expect(getTalksFocus()?.talkIds.sort()).toEqual(['tag-jazz', 'tag-pizza']);
  });

  it('nothing to link: the line is hidden', () => {
    localStorage.setItem('localTalkExchanges', '{}');
    renderStatusLinks('me', deps);
    expect(document.getElementById('status-bar-links')!.hidden).toBe(true);
    expect(statusLinksHtml('settings', deps)).toBe('');
  });
});
