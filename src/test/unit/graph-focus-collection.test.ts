/** @jest-environment jsdom */
/** The Nearby status line opens the current match collection as Contacts narrowed to its people (2026-11-09). */
import { clearContactsFocus, getContactsFocus, openMatchCollectionContacts } from '../../web/ui/graph-focus';
import {
  endMatchCollectionSession,
  recordMatchCollectionDelivery,
  startMatchCollectionSession,
} from '../../web/services/match-collection-session';

let opened: string[] = [];

beforeEach(() => {
  document.body.innerHTML = `
    <button class="nav-btn" data-view="contacts"></button><button class="nav-btn active" data-view="chatrooms"></button>
    <input id="contacts-filter-topic">`;
  opened = [];
  document.querySelectorAll<HTMLElement>('.nav-btn').forEach((nav) => nav.addEventListener('click', () => opened.push(nav.dataset.view || '')));
  localStorage.clear();
});

afterEach(() => {
  clearContactsFocus();
  localStorage.clear();
});

describe('openMatchCollectionContacts', () => {
  it('opens Contacts narrowed to the people the active collection reached', () => {
    startMatchCollectionSession({ label: 'Mall walk', scopeId: 'nearby-v3' });
    recordMatchCollectionDelivery({ talkIds: ['talk-1'], peerIds: ['ann', 'ben'] });
    openMatchCollectionContacts();
    expect(opened).toEqual(['contacts']);
    expect(getContactsFocus()).toEqual({ label: '📣 Mall walk', peerIds: ['ann', 'ben'] });
  });

  it('after the collection ended, still opens the latest one', () => {
    startMatchCollectionSession({ label: 'Park', scopeId: 'nearby-v3' });
    endMatchCollectionSession();
    openMatchCollectionContacts();
    expect(getContactsFocus()).toEqual({ label: '📣 Park', peerIds: [] });
  });

  it('with no collection yet, just opens Contacts', () => {
    openMatchCollectionContacts();
    expect(opened).toEqual(['contacts']);
    expect(getContactsFocus()).toBeNull();
  });
});
