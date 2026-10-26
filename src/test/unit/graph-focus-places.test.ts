/** @jest-environment jsdom */
/** OPEN-89: where exchanges happened — a place leads to its people and Talks, an answer and a person to their place. */
import {
  bindGraphLinks,
  clearContactsFocus,
  clearTalksFocus,
  getContactsFocus,
  getTalksFocus,
  placeLinkHtml,
  placeLinksHtml,
  placesOf,
  placeSummary,
} from '../../web/ui/graph-focus';
import { uiText } from '../../web/ui/ui-translations';

const deps = { escapeHtml: (value: string) => value, text: (key: Parameters<typeof uiText>[1]) => uiText('en', key) };
const exchange = (peerId: string, talkId: string, roomId: string, roomName: string, date: string) =>
  ({ [`${peerId}::${talkId}`]: { peerId, peerName: peerId, talkId, type: 'tag', outcome: 'match', direction: 'sent', date, roomId, roomName } });

beforeEach(() => {
  document.body.innerHTML = `
    <button class="nav-btn" data-view="contacts"></button><button class="nav-btn" data-view="talks"></button>
    <button class="nav-btn" data-view="chatrooms"></button><input id="contacts-filter-topic">
    <div id="chatroom-list"><div class="chatroom-item" data-chatroom-id="place_coffee"></div></div>`;
  localStorage.clear();
  localStorage.setItem('localTalkExchanges', JSON.stringify({
    ...exchange('ann', 'tag-pizza', 'nearby-v3', 'Nearby', '2026-10-25T10:00:00.000Z'),
    ...exchange('ben', 'tag-pizza', 'place_coffee', 'Coffee Room', '2026-10-25T11:00:00.000Z'),
    ...exchange('ben', 'tag-jazz', 'nearby-v3', 'Nearby', '2026-10-25T12:00:00.000Z'),
    ...{ 'cy::tag-old': { peerId: 'cy', talkId: 'tag-old', outcome: 'match', direction: 'sent', date: '2026-10-01T00:00:00.000Z' } },
  }));
});

afterEach(() => {
  clearContactsFocus();
  clearTalksFocus();
});

describe('places in the graph', () => {
  it('knows where a Talk and a person were exchanged, latest first; older exchanges have no place', () => {
    expect(placesOf({ talkIds: ['tag-pizza'] }).map((place) => place.roomName)).toEqual(['Coffee Room', 'Nearby']);
    expect(placesOf({ peerId: 'ben' }).map((place) => place.roomId)).toEqual(['nearby-v3', 'place_coffee']);
    expect(placesOf({ peerId: 'cy' })).toEqual([]);
  });

  it('a place lists the people met there, latest first, and the Talks exchanged there', () => {
    expect(placeSummary('nearby-v3')).toEqual({ peerIds: ['ben', 'ann'], talkIds: ['tag-pizza', 'tag-jazz'] });
    expect(placeLinksHtml('nowhere', '', deps)).toBe('');
  });

  it('a place’s 👥 opens Contacts with exactly its people; its 💬 the Talks there', () => {
    document.body.insertAdjacentHTML('beforeend', `<div id="place">${placeLinksHtml('nearby-v3', 'Nearby', deps)}</div>`);
    bindGraphLinks();
    document.querySelector<HTMLElement>('#place [data-testid="place-people"]')!.click();
    expect(getContactsFocus()).toEqual({ label: '📍 Nearby', peerIds: ['ben', 'ann'] });
    document.querySelector<HTMLElement>('#place [data-testid="place-talks"]')!.click();
    expect(getTalksFocus()).toEqual({ label: '💬 📍 Nearby', talkIds: ['tag-pizza', 'tag-jazz'] });
  });

  it('an answer’s 📍 opens the place: Chatrooms, and a Place’s own room', () => {
    const entered = jest.fn();
    document.querySelector('[data-chatroom-id="place_coffee"]')!.addEventListener('click', entered);
    let chatrooms = 0;
    document.querySelector('.nav-btn[data-view="chatrooms"]')!.addEventListener('click', () => { chatrooms += 1; });
    document.body.insertAdjacentHTML('beforeend', `<div id="answer">${placeLinkHtml(placesOf({ talkIds: ['tag-pizza'] }), deps)}</div>`);
    bindGraphLinks();
    const link = document.querySelector<HTMLElement>('#answer [data-testid="answer-place"]')!;
    expect(link.textContent).toContain('📍 Coffee Room +1');
    link.click();
    expect(chatrooms).toBe(1);
    expect(entered).toHaveBeenCalledTimes(1);
  });
});

describe('back along the graph', () => {
  it('each followed link can step back to where it was followed from; a tab tapped by hand starts afresh', () => {
    document.body.insertAdjacentHTML('beforeend', '<button id="graph-back-btn" hidden></button><button class="nav-btn" data-view="me"></button>');
    const tabs = document.querySelectorAll<HTMLElement>('.nav-btn');
    const activate = (view: string) => tabs.forEach((tab) => tab.classList.toggle('active', tab.dataset.view === view));
    tabs.forEach((tab) => tab.addEventListener('click', () => activate(tab.dataset.view || '')));
    bindGraphLinks();
    // Start on Me, tapped by hand: that forgets any way back from earlier tests.
    document.querySelector<HTMLElement>('.nav-btn[data-view="me"]')!.click();
    const back = document.getElementById('graph-back-btn')!;
    const topic = document.getElementById('contacts-filter-topic') as HTMLInputElement;
    bindGraphLinks();

    // Me → a place's 👥 (Contacts, narrowed) → its 💬 (Talks): two steps to go back.
    document.body.insertAdjacentHTML('beforeend', `<div id="place">${placeLinksHtml('nearby-v3', 'Nearby', deps)}</div>`);
    document.querySelector<HTMLElement>('#place [data-testid="place-people"]')!.click();
    expect(back.hidden).toBe(false);
    document.querySelector<HTMLElement>('#place [data-testid="place-talks"]')!.click();
    expect(document.querySelector('.nav-btn.active')?.getAttribute('data-view')).toBe('talks');

    back.click();
    expect(document.querySelector('.nav-btn.active')?.getAttribute('data-view')).toBe('contacts');
    expect(topic.value).toBe('📍 Nearby');
    back.click();
    expect(document.querySelector('.nav-btn.active')?.getAttribute('data-view')).toBe('me');
    expect(back.hidden).toBe(true);

    // A tab tapped by hand forgets the way back.
    document.querySelector<HTMLElement>('#place [data-testid="place-people"]')!.click();
    expect(back.hidden).toBe(false);
    document.querySelector<HTMLElement>('.nav-btn[data-view="talks"]')!.click();
    expect(back.hidden).toBe(true);
  });
});
