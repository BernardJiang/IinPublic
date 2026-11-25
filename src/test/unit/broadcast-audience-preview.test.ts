/** @jest-environment jsdom */

import {
  getBroadcastableTalkIds,
  getBroadcastTalkPayload,
  resolveExpiresAtMs,
} from '../../web/ui/broadcast-audience-preview';
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

describe('getBroadcastableTalkIds', () => {
  it('returns created and copied talks in storage order', () => {
    setMyTalks({
      created: talk({ talkId: 'created', role: 'created' }),
      copied: talk({ talkId: 'copied', role: 'copied' }),
      answered: talk({ talkId: 'answered', role: 'answered' }),
    });

    expect(getBroadcastableTalkIds()).toEqual(['created', 'copied']);
  });

  it('excludes disabled and expired talks using row or full-payload expiry', () => {
    const now = Date.now();
    setMyTalks({
      disabled: talk({ talkId: 'disabled', disabled: true }),
      rowExpired: talk({ talkId: 'rowExpired', expiresAt: now - 1 }),
      fullExpired: talk({ talkId: 'fullExpired', fullTalk: { expiresAt: now - 1 } }),
      future: talk({ talkId: 'future', expiresAt: now + 60_000 }),
    });

    expect(getBroadcastableTalkIds()).toEqual(['future']);
  });

  it('keeps talks whose expiry is absent or invalid', () => {
    setMyTalks({
      absent: talk({ talkId: 'absent' }),
      invalid: talk({ talkId: 'invalid', fullTalk: { expiresAt: 'not-a-date' } }),
    });

    expect(getBroadcastableTalkIds()).toEqual(['absent', 'invalid']);
  });
});

describe('getBroadcastTalkPayload', () => {
  it('returns null when the row or its full payload is missing', () => {
    setMyTalks({ rowOnly: talk({ talkId: 'rowOnly' }) });

    expect(getBroadcastTalkPayload('missing')).toBeNull();
    expect(getBroadcastTalkPayload('rowOnly')).toBeNull();
  });

  it('allows a tag payload without questions', () => {
    const fullTalk = { id: 'tag-1', type: 'tag', authorId: 'original-author' };
    setMyTalks({ tag: talk({ talkId: 'tag', role: 'copied', fullTalk }) });

    expect(getBroadcastTalkPayload('tag')).toEqual(fullTalk);
  });

  it('requires a non-tag payload to contain at least one question', () => {
    const valid = { id: 'flow-ok', type: 'flow', questions: [{ id: 'q1' }] };
    setMyTalks({
      absent: talk({ talkId: 'absent', fullTalk: { type: 'flow' } }),
      empty: talk({ talkId: 'empty', fullTalk: { type: 'survey', questions: [] } }),
      valid: talk({ talkId: 'valid', fullTalk: valid }),
    });

    expect(getBroadcastTalkPayload('absent')).toBeNull();
    expect(getBroadcastTalkPayload('empty')).toBeNull();
    expect(getBroadcastTalkPayload('valid')).toEqual(valid);
  });
});
