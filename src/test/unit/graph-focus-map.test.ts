/** @jest-environment jsdom */
import { bindGraphLinks, getMeFocus, getTalksFocus, openMapMe, openMapPerson, openMeFocus, openPeerTalks } from '../../web/ui/graph-focus';
import { removeExchangePeers, upsertExchange } from '../../web/services/exchange-view';

describe('map graph navigation', () => {
  beforeEach(() => {
    localStorage.clear();
    document.body.innerHTML = '<button id="graph-back-btn" hidden></button>' + ['chatrooms', 'me', 'contacts', 'talks']
      .map((view) => `<button class="nav-btn" data-view="${view}"></button>`).join('');
    const tabs = document.querySelectorAll<HTMLButtonElement>('.nav-btn');
    tabs.forEach((tab) => tab.addEventListener('click', () => tabs.forEach((candidate) => candidate.classList.toggle('active', candidate === tab))));
    bindGraphLinks();
    document.querySelector<HTMLButtonElement>('[data-view="chatrooms"]')!.click();
  });
  const active = () => document.querySelector<HTMLElement>('.nav-btn.active')?.dataset.view;

  it('opens a stranger under Contacts without saving a Contact and returns to the map', () => {
    const open = jest.fn(() => {
      document.body.insertAdjacentHTML('beforeend', '<button id="back-from-peer-detail"></button>');
    });
    openMapPerson('eve', 'Eve', open);
    expect(active()).toBe('contacts');
    expect(open).toHaveBeenCalledWith('eve', 'Eve');
    document.getElementById('back-from-peer-detail')!.click();
    expect(active()).toBe('chatrooms');
  });

  it('opens all of Me instead of retaining a previous question filter', () => {
    openMeFocus({ label: 'Old filter', talkIds: ['old'] });
    document.querySelector<HTMLButtonElement>('[data-view="chatrooms"]')!.click();
    openMapMe();
    expect(active()).toBe('me');
    expect(getMeFocus()).toBeNull();
    document.getElementById('graph-back-btn')!.click();
    expect(active()).toBe('chatrooms');
  });

  it('focuses both directions/all outcomes for one peer, follows removal, and preserves Back', () => {
    const record = { peerId: 'eve', peerName: 'Eve', title: 'Test', date: '2026-10-26T00:00:00Z' };
    upsertExchange({ ...record, talkId: 'one', direction: 'sent', outcome: 'match' });
    upsertExchange({ ...record, talkId: 'one', direction: 'received', outcome: 'mismatch' });
    upsertExchange({ ...record, talkId: 'two', direction: 'received', outcome: 'ignore' });
    upsertExchange({ ...record, peerId: 'bob', talkId: 'other', direction: 'sent', outcome: 'match' });
    openPeerTalks('eve', 'With Eve');
    expect(active()).toBe('talks');
    expect(getTalksFocus()).toEqual({ peerId: 'eve', label: 'With Eve', talkIds: ['one', 'two'] });
    removeExchangePeers(['eve']);
    expect(getTalksFocus()?.talkIds).toEqual([]);
    document.getElementById('graph-back-btn')!.click();
    expect(active()).toBe('chatrooms');
    expect(getTalksFocus()).toBeNull();
  });
});
