/** @jest-environment jsdom */

import { getSenderOmittedBroadcastPreviews, resolveExpiresAtMs } from '../../web/ui/broadcast-audience-preview';
import { setMyTalks, type MyTalkEntry } from '../../web/ui/my-talks-storage';

function talk(overrides: Partial<MyTalkEntry> = {}): MyTalkEntry {
  return {
    talkId: 't1',
    title: 'My Talk',
    type: 'tag',
    timestamp: new Date().toISOString(),
    role: 'created',
    ...overrides,
  };
}

beforeEach(() => {
  localStorage.clear();
});

describe('resolveExpiresAtMs', () => {
  it('passes a numeric timestamp through unchanged', () => {
    expect(resolveExpiresAtMs(12345)).toBe(12345);
  });

  it('parses an ISO date string', () => {
    expect(resolveExpiresAtMs('2026-01-01T00:00:00.000Z')).toBe(Date.parse('2026-01-01T00:00:00.000Z'));
  });

  it('returns NaN for a blank string', () => {
    expect(Number.isNaN(resolveExpiresAtMs('   '))).toBe(true);
  });

  it('returns NaN for null/undefined/other types', () => {
    expect(Number.isNaN(resolveExpiresAtMs(null))).toBe(true);
    expect(Number.isNaN(resolveExpiresAtMs(undefined))).toBe(true);
    expect(Number.isNaN(resolveExpiresAtMs({}))).toBe(true);
  });
});

describe('getSenderOmittedBroadcastPreviews', () => {
  it('returns nothing when there are no talks', () => {
    setMyTalks({});
    expect(getSenderOmittedBroadcastPreviews()).toEqual([]);
  });

  it('ignores talks with role "answered" (not created/copied)', () => {
    setMyTalks({ t1: talk({ role: 'answered', disabled: true }) });
    expect(getSenderOmittedBroadcastPreviews()).toEqual([]);
  });

  it('ignores created/copied talks that are neither disabled nor expired', () => {
    setMyTalks({ t1: talk({ role: 'created' }) });
    expect(getSenderOmittedBroadcastPreviews()).toEqual([]);
  });

  it('flags a disabled talk with broadcast_disabled', () => {
    setMyTalks({ t1: talk({ role: 'created', disabled: true }) });
    const previews = getSenderOmittedBroadcastPreviews();
    expect(previews).toHaveLength(1);
    expect(previews[0].senderOmittedBy).toEqual(['broadcast_disabled']);
    expect(previews[0].rejectedByCounts).toEqual({ broadcast_disabled: 1 });
  });

  it('flags an expired talk with talk_expired, reading expiresAt from fullTalk as a fallback', () => {
    setMyTalks({
      t1: talk({ role: 'copied', fullTalk: { expiresAt: Date.now() - 1000 } }),
    });
    const previews = getSenderOmittedBroadcastPreviews();
    expect(previews[0].senderOmittedBy).toEqual(['talk_expired']);
  });

  it('flags both reasons when a talk is disabled and expired', () => {
    setMyTalks({
      t1: talk({ role: 'created', disabled: true, expiresAt: Date.now() - 1000 }),
    });
    const previews = getSenderOmittedBroadcastPreviews();
    expect(previews[0].senderOmittedBy).toEqual(['broadcast_disabled', 'talk_expired']);
  });

  it('does not flag a talk expiring in the future', () => {
    setMyTalks({ t1: talk({ role: 'created', expiresAt: Date.now() + 100000 }) });
    expect(getSenderOmittedBroadcastPreviews()).toEqual([]);
  });

  it('falls back to fullTalk.title, then talkId, when title is missing', () => {
    setMyTalks({
      t1: talk({ role: 'created', disabled: true, title: '', fullTalk: { title: 'Full Title' } }),
    });
    expect(getSenderOmittedBroadcastPreviews()[0].title).toBe('Full Title');

    setMyTalks({
      t2: talk({ talkId: 't2', role: 'created', disabled: true, title: '' }),
    });
    expect(getSenderOmittedBroadcastPreviews()[0].title).toBe('t2');
  });

  it('sorts results by title', () => {
    setMyTalks({
      b: talk({ talkId: 'b', title: 'Bravo', role: 'created', disabled: true }),
      a: talk({ talkId: 'a', title: 'Alpha', role: 'created', disabled: true }),
    });
    const previews = getSenderOmittedBroadcastPreviews();
    expect(previews.map((p) => p.title)).toEqual(['Alpha', 'Bravo']);
  });
});
