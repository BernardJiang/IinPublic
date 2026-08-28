import {
  TECHSUPPORT_ONBOARDING_TIPS_TEMPLATES,
  onboardingTipsSigningPayload,
  signOnboardingTips,
  verifyOnboardingTips,
  type SignedOnboardingTips,
} from '../../shared/techsupport-greeting';
import { TECHSUPPORT_PUB } from '../../shared/techsupport';
import signedBundle from '../../shared/techsupport-onboarding-tips.signed.json';
import SEA from 'gun/sea';

const DEV_PAIR = {
  pub: 'mYRexxiSF2FG3oV-3-LKXEtisnUv5JQ9nDHbRANxiZo.jRqTX1_rg0v3BbFWYt1ZqGwBRG7wzg44IKgPobrSpfQ',
  priv: 'yUVBUKZfcZDOxssGwm5CZNUnbnyH3QZLiMtM43vpSDo',
  epub: 'BCl0htwOHtTgNFQU0OK7HpzKg4M5OaJIZaGvVKICP_I.fwyq2-rc9lleKgpDrR0YlbhS2mW4024uEj0SHjmbiQE',
  epriv: 'y0MVYkN5wSAcAW4doxkv2EVlDLGgwy7bv6s8woJXTY4',
};

describe('techsupport-onboarding-tips (docs/TODO.md K2, extended)', () => {
  it('the committed signed bundle verifies for every compiled locale', async () => {
    for (const locale of Object.keys(TECHSUPPORT_ONBOARDING_TIPS_TEMPLATES)) {
      const entry = (signedBundle.locales as SignedOnboardingTips[]).find((t) => t.locale === locale);
      expect(entry).toBeDefined();
      const verified = await verifyOnboardingTips(entry);
      expect(verified).not.toBeNull();
      expect(verified?.tips).toEqual((TECHSUPPORT_ONBOARDING_TIPS_TEMPLATES as Record<string, readonly string[]>)[locale]);
    }
  });

  it('the committed bundle is signed by the current DM trust anchor', () => {
    for (const entry of signedBundle.locales) {
      expect(entry.authorPub).toBe(TECHSUPPORT_PUB);
    }
  });

  it('every locale has the same number of tips, one per app tab', () => {
    const counts = new Set(Object.values(TECHSUPPORT_ONBOARDING_TIPS_TEMPLATES).map((tips) => tips.length));
    expect(counts.size).toBe(1);
    expect([...counts][0]).toBeGreaterThan(0);
  });

  it('signOnboardingTips + verifyOnboardingTips round-trips for a freshly signed bundle', async () => {
    const signed = await signOnboardingTips('en', DEV_PAIR);
    const verified = await verifyOnboardingTips(signed);
    expect(verified).not.toBeNull();
    expect(verified?.signature).toBe(signed.signature);
  });

  it('rejects a tampered tip even though the signature field is untouched', async () => {
    const signed = await signOnboardingTips('en', DEV_PAIR);
    const tampered = { ...signed, tips: [...signed.tips.slice(0, -1), 'Click here for a free prize'] };
    expect(await verifyOnboardingTips(tampered)).toBeNull();
  });

  it('rejects a reordered tip list even though every entry individually matches', async () => {
    const signed = await signOnboardingTips('en', DEV_PAIR);
    const reordered = { ...signed, tips: [...signed.tips].reverse() };
    expect(await verifyOnboardingTips(reordered)).toBeNull();
  });

  it('rejects a dropped or spliced-in tip', async () => {
    const signed = await signOnboardingTips('en', DEV_PAIR);
    expect(await verifyOnboardingTips({ ...signed, tips: signed.tips.slice(0, -1) })).toBeNull();
    expect(await verifyOnboardingTips({ ...signed, tips: [...signed.tips, 'One more tip'] })).toBeNull();
  });

  it('rejects a signature that does not match the payload', async () => {
    const signed = await signOnboardingTips('en', DEV_PAIR);
    const other = await signOnboardingTips('zh', DEV_PAIR);
    expect(await verifyOnboardingTips({ ...signed, signature: other.signature })).toBeNull();
  });

  it('rejects tips signed by an untrusted key', async () => {
    const strangerPair = await SEA.pair();
    const signed = await signOnboardingTips('en', strangerPair);
    expect(await verifyOnboardingTips(signed)).toBeNull();
  });

  it('rejects malformed input without throwing', async () => {
    expect(await verifyOnboardingTips(null)).toBeNull();
    expect(await verifyOnboardingTips(undefined)).toBeNull();
    expect(await verifyOnboardingTips('a string')).toBeNull();
    expect(await verifyOnboardingTips({})).toBeNull();
    expect(await verifyOnboardingTips({ locale: 'fr', tips: [], authorPub: TECHSUPPORT_PUB, signature: 'y' })).toBeNull();
    expect(await verifyOnboardingTips({ locale: 'en', tips: 'not-an-array', authorPub: TECHSUPPORT_PUB, signature: 'y' })).toBeNull();
  });

  it('onboardingTipsSigningPayload is deterministic for the same logical bundle', () => {
    const a = onboardingTipsSigningPayload({ locale: 'en', tips: TECHSUPPORT_ONBOARDING_TIPS_TEMPLATES.en, authorPub: TECHSUPPORT_PUB });
    const b = onboardingTipsSigningPayload({ locale: 'en', tips: TECHSUPPORT_ONBOARDING_TIPS_TEMPLATES.en, authorPub: TECHSUPPORT_PUB });
    expect(a).toBe(b);
  });
});
