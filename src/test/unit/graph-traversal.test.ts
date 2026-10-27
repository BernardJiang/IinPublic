/** @jest-environment jsdom */
import {
  bindGraphLinks, getContactsFocus, getMeFocus, getTalksFocus, goBackAlongGraph,
  openContactsTopic, openMapPerson, openMeFocus, openPeerTalks, openPlace, openTalksFocus,
  placeLinkHtml, placeLinksHtml, talksLinkHtml,
} from '../../web/ui/graph-focus';
import { configureTagGraphView, renderPeerTagsInto } from '../../web/ui/tag-graph-view';
import { navigateToMyAnswerForTalk } from '../../web/ui/navigate-to-answer';
import { upsertExchange, removeExchangePeers } from '../../web/services/exchange-view';
import { setFlatAnswerHistory } from '../../web/ui/answer-history-storage';
import { uiText } from '../../web/ui/ui-translations';

const text = (key: Parameters<typeof uiText>[1]) => uiText('en', key);
const deps = { escapeHtml: (value: string) => value, text };
const active = () => document.querySelector<HTMLElement>('.nav-btn.active')?.dataset.view;
const tab = (view: string) => document.querySelector<HTMLButtonElement>(`[data-view="${view}"]`)!.click();
const click = (testId: string) => document.querySelector<HTMLElement>(`[data-testid="${testId}"]`)!.click();

beforeEach(() => {
  localStorage.clear();
  document.body.innerHTML = ['chatrooms', 'contacts', 'talks', 'me'].map((view) => `<button class="nav-btn" data-view="${view}">${view}</button>`).join('')
    + '<button id="graph-back-btn" hidden></button><input id="contacts-filter-topic"><div id="chatrooms-view"><div id="chatroom-list-container"></div><div id="chatroom-detail-container" style="display:none"></div></div><section id="peer"></section>';
  const tabs = document.querySelectorAll<HTMLButtonElement>('.nav-btn');
  tabs.forEach((button) => button.addEventListener('click', () => tabs.forEach((other) => other.classList.toggle('active', button === other))));
  bindGraphLinks();
  tab('chatrooms');
  configureTagGraphView({ graphInput: () => ({ currentUserId: 'me', incoming: [], myTalks: {}, exchanges: [] }), t: text });
  upsertExchange({ peerId: 'eve', peerName: 'Eve', talkId: 'flow', type: 'flow', title: 'Coffee?', direction: 'received', outcome: 'match', date: '2026-10-27T00:00:00Z', roomId: 'place_old', roomName: 'Old Place' });
  setFlatAnswerHistory({ flow: { id: 'flow', talkId: 'flow', title: 'Coffee?', type: 'flow', outcome: 'match', answeredAt: '2026-10-27T00:00:00Z', senderIds: ['eve'], items: [{ questionId: 'q', answerId: 'a', prompt: 'Coffee?', choice: 'Yes', kind: 'question', contextPath: [] }] } });
});

it('offers Talks and My answers for a peer with no tags, and follows live peer removal', () => {
  renderPeerTagsInto(document.getElementById('peer')!, 'eve', 'Eve');
  click('peer-talks-link');
  expect(active()).toBe('talks');
  expect(getTalksFocus()?.talkIds).toEqual(['flow']);
  click('graph-my-answers');
  expect(active()).toBe('me');
  expect(getMeFocus()?.talkIds).toEqual(['flow']);
  removeExchangePeers(['eve']);
  expect(getTalksFocus()?.talkIds).toEqual([]);
});

it('captures source filters before changing them, including repeated labels', () => {
  tab('contacts');
  const input = document.getElementById('contacts-filter-topic') as HTMLInputElement;
  input.value = 'Coffee';
  openContactsTopic('Pizza', { label: 'Pizza', talkIds: [], isTag: false, peerIds: ['eve'] });
  openContactsTopic('Pizza', { label: 'Pizza', talkIds: [], isTag: false, peerIds: ['bob'] });
  goBackAlongGraph();
  expect(getContactsFocus()?.peerIds).toEqual(['eve']);
  goBackAlongGraph();
  expect(input.value).toBe('Coffee');
  openTalksFocus({ label: 'First', talkIds: ['flow'] });
  openTalksFocus({ label: 'Second', talkIds: ['second'] });
  goBackAlongGraph();
  expect(getTalksFocus()?.label).toBe('First');
  openMeFocus({ label: 'First answer', talkIds: ['flow'] });
  openMeFocus({ label: 'Second answer', talkIds: ['second'] });
  goBackAlongGraph();
  expect(getMeFocus()?.label).toBe('First answer');
});

it('opens all recorded Places independently without requiring or clicking room rows', () => {
  const entered = jest.fn();
  document.getElementById('chatroom-list-container')!.innerHTML = '<div data-room-id="place_old"></div><button data-chatroom-id="place_old"></button>';
  document.querySelector('[data-chatroom-id]')!.addEventListener('click', entered);
  document.body.insertAdjacentHTML('beforeend', placeLinkHtml([{ roomId: 'place_old', roomName: 'Old Place', at: 2 }, { roomId: 'place_unlisted', roomName: 'Unlisted', at: 1 }], deps));
  const links = document.querySelectorAll<HTMLElement>('[data-testid="answer-place"]');
  links[0]!.click();
  expect(document.getElementById('graph-place-panel')?.dataset.roomId).toBe('place_old');
  expect(entered).not.toHaveBeenCalled();
  links[1]!.click();
  expect(document.getElementById('graph-place-panel')?.textContent).toContain('No recorded exchanges');
  goBackAlongGraph();
  expect(document.getElementById('graph-place-panel')?.dataset.roomId).toBe('place_old');
  goBackAlongGraph();
  expect(document.getElementById('graph-place-panel')).toBeNull();
});

it('Place history leads to its people, Talks, and answers and restores the Place on Back', () => {
  openPlace('place_old');
  for (const [id, view] of [['place-people', 'contacts'], ['place-talks', 'talks'], ['graph-my-answers', 'me']]) {
    click(id!);
    expect(active()).toBe(view);
    if (view === 'contacts') expect(getContactsFocus()?.peerIds).toEqual(['eve']);
    if (view === 'talks') expect(getTalksFocus()?.talkIds).toEqual(['flow']);
    if (view === 'me') expect(getMeFocus()?.talkIds).toEqual(['flow']);
    goBackAlongGraph();
    expect(active()).toBe('chatrooms');
    expect(document.getElementById('graph-place-panel')?.dataset.roomId).toBe('place_old');
  }
  tab('chatrooms');
  expect(document.getElementById('graph-place-panel')).toBeNull();
});

it('keyboard activation follows the child link without acting on its parent', () => {
  tab('me');
  const parent = document.createElement('div');
  parent.innerHTML = talksLinkHtml('Coffee?', ['flow'], deps);
  document.body.appendChild(parent);
  const parentAction = jest.fn();
  parent.addEventListener('keydown', parentAction);
  parent.querySelector('span')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  expect(active()).toBe('talks');
  expect(parentAction).not.toHaveBeenCalled();
  expect(getTalksFocus()?.talkIds).toEqual(['flow']);
});

it('answer review preserves the graph trail and source peer filter', () => {
  openPeerTalks('eve', 'With Eve');
  navigateToMyAnswerForTalk('flow', 'Coffee?');
  expect(active()).toBe('me');
  expect(getMeFocus()?.label).toBe('Coffee?');
  goBackAlongGraph();
  expect(active()).toBe('talks');
  expect(getTalksFocus()?.peerId).toBe('eve');
  goBackAlongGraph();
  expect(active()).toBe('chatrooms');
});

it('programmatic overlay closure cannot consume another Back step', () => {
  const open = () => {
    document.body.insertAdjacentHTML('beforeend', '<div id="peer-detail-overlay"><div data-peer-id="eve" data-peer-name="Eve"></div><button id="back-from-peer-detail"></button></div>');
    document.getElementById('back-from-peer-detail')!.onclick = () => document.getElementById('peer-detail-overlay')!.remove();
  };
  openMapPerson('eve', 'Eve', open);
  openMeFocus({ label: 'Coffee?', talkIds: ['flow'] });
  goBackAlongGraph();
  expect(active()).toBe('contacts');
  goBackAlongGraph();
  expect(active()).toBe('chatrooms');
  expect(document.getElementById('graph-back-btn')!.hidden).toBe(true);
});

it('Place summaries do not invent an answer when there is no answer history', () => {
  setFlatAnswerHistory({});
  expect(placeLinksHtml('place_old', 'Old Place', deps)).not.toContain('graph-my-answers');
});
