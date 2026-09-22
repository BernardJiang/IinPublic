import {
  TECHSUPPORT_FAQ_SEED_TEMPLATES,
  buildSeedFaqEntries,
  isFaqSeedLocale,
} from '../../shared/techsupport-faq-seed';
import { normalizeSupportQuestion, supportQuestionKey, lookupSupportAnswer } from '../../shared/techsupport-faq';
import { signFaqBundle, verifyFaqBundle } from '../../shared/techsupport-faq-bundle';
import { TECHSUPPORT_PUB } from '../../shared/techsupport';
import signedSeedBundle from '../../shared/techsupport-faq-seed.signed.json';
import { describeWithRealTechSupportPair } from '../support/techsupport-real-pair';

describe('techsupport-faq-seed (docs/TODO.md K5, starter FAQ content)', () => {
  it('isFaqSeedLocale recognizes exactly the compiled locales', () => {
    expect(isFaqSeedLocale('en')).toBe(true);
    expect(isFaqSeedLocale('zh')).toBe(true);
    expect(isFaqSeedLocale('fr')).toBe(false);
    expect(isFaqSeedLocale(undefined)).toBe(false);
  });

  it('every locale has the same number of Q&A items', () => {
    const counts = new Set(Object.values(TECHSUPPORT_FAQ_SEED_TEMPLATES).map((items) => items.length));
    expect(counts.size).toBe(1);
    expect([...counts][0]).toBeGreaterThan(0);
  });

  it('buildSeedFaqEntries produces one distinct, normalized-nonempty entry per item, across all locales', () => {
    const entries = buildSeedFaqEntries('2026-09-21T00:00:00.000Z');
    const totalItems = Object.values(TECHSUPPORT_FAQ_SEED_TEMPLATES).reduce((sum, items) => sum + items.length, 0);
    expect(entries).toHaveLength(totalItems);
    const keys = new Set(entries.map((e) => e.questionKey));
    expect(keys.size).toBe(entries.length); // no two seed questions collide after normalization
    for (const entry of entries) {
      expect(normalizeSupportQuestion(entry.canonicalQuestion)).toBe(entry.canonicalQuestion);
      expect(entry.answer.length).toBeGreaterThan(0);
    }
  });

  it('lookupSupportAnswer resolves every seed question against its own built entries', () => {
    const entries = buildSeedFaqEntries('2026-09-21T00:00:00.000Z');
    for (const items of Object.values(TECHSUPPORT_FAQ_SEED_TEMPLATES)) {
      for (const item of items) {
        const result = lookupSupportAnswer(item.question, entries);
        expect(result.status).toBe('known');
        if (result.status === 'known') expect(result.entry.answer).toBe(item.answer);
      }
    }
  });

  it('the committed signed seed bundle verifies and is signed by the current DM trust anchor', async () => {
    const verified = await verifyFaqBundle(signedSeedBundle);
    expect(verified).not.toBeNull();
    expect(verified?.authorPub).toBe(TECHSUPPORT_PUB);
    const expectedKeys = new Set(buildSeedFaqEntries('irrelevant-for-key').map((e) => e.questionKey));
    const actualKeys = new Set((verified?.entries ?? []).map((e) => e.questionKey));
    expect(actualKeys).toEqual(expectedKeys);
  });

  it('supportQuestionKey for a committed seed question matches the committed entry key', () => {
    const firstEn = TECHSUPPORT_FAQ_SEED_TEMPLATES.en[0]!;
    const key = supportQuestionKey(firstEn.question);
    const match = signedSeedBundle.entries.find((e) => e.questionKey === key);
    expect(match).toBeDefined();
    expect(match?.answer).toBe(firstEn.answer);
  });
});

describeWithRealTechSupportPair('techsupport-faq-seed: freshly signed round-trip', (DEV_PAIR) => {
  it('signFaqBundle over buildSeedFaqEntries round-trips through verifyFaqBundle', async () => {
    const entries = buildSeedFaqEntries('2026-09-21T00:00:00.000Z');
    const signed = await signFaqBundle(entries, DEV_PAIR);
    const verified = await verifyFaqBundle(signed);
    expect(verified).not.toBeNull();
    expect(verified?.entries).toEqual(entries);
  });
});
