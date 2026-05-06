import {
  filterProfileAttributesForViewer,
  normalizeProfileAttributeVisibility,
} from '../../shared/profile-privacy';
import type { QuestionAnswer } from '../../shared/types';

const baseQa = (over: Partial<QuestionAnswer>): QuestionAnswer => ({
  id: '1',
  question: 'Q',
  answer: 'A',
  isAuto: false,
  answeredAt: new Date(),
  ...over,
});

describe('profile privacy', () => {
  it('normalizeProfileAttributeVisibility defaults invalid to public', () => {
    expect(normalizeProfileAttributeVisibility(undefined)).toBe('public');
    expect(normalizeProfileAttributeVisibility('')).toBe('public');
    expect(normalizeProfileAttributeVisibility('public')).toBe('public');
    expect(normalizeProfileAttributeVisibility('contacts_only')).toBe('contacts_only');
    expect(normalizeProfileAttributeVisibility('private')).toBe('private');
  });

  it('drops private rows for non-owner projection', () => {
    const out = filterProfileAttributesForViewer(
      [baseQa({ id: 'a', visibility: 'public' }), baseQa({ id: 'b', visibility: 'private' })],
      { viewerIsContact: false },
    );
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe('a');
  });

  it('keeps contacts_only only when viewer is a contact', () => {
    const rows = [baseQa({ id: 'c', visibility: 'contacts_only' })];
    expect(filterProfileAttributesForViewer(rows, { viewerIsContact: false })).toHaveLength(0);
    expect(filterProfileAttributesForViewer(rows, { viewerIsContact: true })).toHaveLength(1);
  });
});
