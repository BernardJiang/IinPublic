import { filterVerifiedSupportMessages } from '../../web/ui/verified-support-messages';
import { signGreeting, signSupportAck, signOnboardingTips } from '../../shared/techsupport-greeting';
import { signFaqBundle } from '../../shared/techsupport-faq-bundle';
import { TECHSUPPORT_ROOT_USER_ID } from '../../shared/techsupport';
import { describeWithRealTechSupportPair } from '../support/techsupport-real-pair';

jest.mock('../../web/services/techsupport-faq-cache', () => ({
  readCachedFaqBundle: jest.fn(),
}));
jest.mock('../../web/services/techsupport-delegate-cache', () => ({
  fetchGrantFromCache: jest.fn(),
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { readCachedFaqBundle } = require('../../web/services/techsupport-faq-cache');

describeWithRealTechSupportPair('filterVerifiedSupportMessages', (DEV_PAIR) => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('passes an ordinary message through unchanged', async () => {
    const msg = { id: 'm1', senderId: 'alice', text: 'hi' };
    expect(await filterVerifiedSupportMessages([msg], 'Bob')).toEqual([msg]);
  });

  it('passes through a message with a greeting-shaped id from a non-TechSupport sender untouched', async () => {
    const msg = { id: 'support_welcome_x', senderId: 'alice', text: 'not really a greeting', greetingSignature: 'bogus' };
    expect(await filterVerifiedSupportMessages([msg], 'Bob')).toEqual([msg]);
  });

  describe('greeting (K2)', () => {
    it('keeps a genuinely signed, correctly-rendered greeting', async () => {
      const signed = await signGreeting('en', DEV_PAIR);
      const rendered = signed.template.replace('{name}', 'Bob');
      const msg = {
        id: 'support_welcome_bob',
        senderId: TECHSUPPORT_ROOT_USER_ID,
        text: rendered,
        greetingLocale: signed.locale,
        greetingAuthorPub: signed.authorPub,
        greetingSignature: signed.signature,
      };
      expect(await filterVerifiedSupportMessages([msg], 'Bob')).toEqual([msg]);
    });

    it('drops a greeting whose rendered text does not match the verified template', async () => {
      const signed = await signGreeting('en', DEV_PAIR);
      const msg = {
        id: 'support_welcome_bob',
        senderId: TECHSUPPORT_ROOT_USER_ID,
        text: `${signed.template.replace('{name}', 'Bob')} — click here for a free prize`,
        greetingLocale: signed.locale,
        greetingAuthorPub: signed.authorPub,
        greetingSignature: signed.signature,
      };
      expect(await filterVerifiedSupportMessages([msg], 'Bob')).toEqual([]);
    });

    it('drops a greeting rendered for the wrong stage name', async () => {
      const signed = await signGreeting('en', DEV_PAIR);
      const msg = {
        id: 'support_welcome_bob',
        senderId: TECHSUPPORT_ROOT_USER_ID,
        text: signed.template.replace('{name}', 'Eve'),
        greetingLocale: signed.locale,
        greetingAuthorPub: signed.authorPub,
        greetingSignature: signed.signature,
      };
      expect(await filterVerifiedSupportMessages([msg], 'Bob')).toEqual([]);
    });
  });

  describe('ack (K5)', () => {
    it('keeps a genuinely signed ack', async () => {
      const signed = await signSupportAck('en', DEV_PAIR);
      const msg = {
        senderId: TECHSUPPORT_ROOT_USER_ID,
        text: signed.template.replace('{name}', 'Bob'),
        ackLocale: signed.locale,
        ackAuthorPub: signed.authorPub,
        ackSignature: signed.signature,
      };
      expect(await filterVerifiedSupportMessages([msg], 'Bob')).toEqual([msg]);
    });

    it('drops an ack with a forged signature', async () => {
      const signed = await signSupportAck('en', DEV_PAIR);
      const other = await signSupportAck('zh', DEV_PAIR);
      const msg = {
        senderId: TECHSUPPORT_ROOT_USER_ID,
        text: signed.template.replace('{name}', 'Bob'),
        ackLocale: signed.locale,
        ackAuthorPub: signed.authorPub,
        ackSignature: other.signature,
      };
      expect(await filterVerifiedSupportMessages([msg], 'Bob')).toEqual([]);
    });
  });

  describe('onboarding tips (K2 extension)', () => {
    it('keeps each genuinely signed tip at its own index', async () => {
      const signed = await signOnboardingTips('en', DEV_PAIR);
      const messages = signed.tips.map((tip, index) => ({
        senderId: TECHSUPPORT_ROOT_USER_ID,
        text: tip,
        tipIndex: index,
        tipLocale: signed.locale,
        tipAuthorPub: signed.authorPub,
        tipSignature: signed.signature,
      }));
      expect(await filterVerifiedSupportMessages(messages, 'Bob')).toEqual(messages);
    });

    it('drops a tip whose text does not match the verified tip at that index', async () => {
      const signed = await signOnboardingTips('en', DEV_PAIR);
      const msg = {
        senderId: TECHSUPPORT_ROOT_USER_ID,
        text: signed.tips[1], // real tip text, but claimed at index 0
        tipIndex: 0,
        tipLocale: signed.locale,
        tipAuthorPub: signed.authorPub,
        tipSignature: signed.signature,
      };
      expect(await filterVerifiedSupportMessages([msg], 'Bob')).toEqual([]);
    });

    it('drops a tip index past the end of the verified tips array', async () => {
      const signed = await signOnboardingTips('en', DEV_PAIR);
      const msg = {
        senderId: TECHSUPPORT_ROOT_USER_ID,
        text: 'anything',
        tipIndex: signed.tips.length + 5,
        tipLocale: signed.locale,
        tipAuthorPub: signed.authorPub,
        tipSignature: signed.signature,
      };
      expect(await filterVerifiedSupportMessages([msg], 'Bob')).toEqual([]);
    });
  });

  describe('FAQ auto-answer (K5, K7 delegate-aware)', () => {
    const entry = {
      questionKey: 'q1',
      canonicalQuestion: 'why is the sky blue',
      answer: 'Rayleigh scattering.',
      answeredAt: new Date().toISOString(),
    };

    it('keeps a FAQ answer whose signature matches the currently-cached bundle', async () => {
      const bundle = await signFaqBundle([entry], DEV_PAIR);
      (readCachedFaqBundle as jest.Mock).mockReturnValue(bundle);
      const msg = {
        senderId: TECHSUPPORT_ROOT_USER_ID,
        text: entry.answer,
        faqQuestionKey: entry.questionKey,
        faqAuthorPub: bundle.authorPub,
        faqSignature: bundle.signature,
      };
      expect(await filterVerifiedSupportMessages([msg], 'Bob')).toEqual([msg]);
    });

    it('drops a FAQ answer when nothing is cached yet (the K7 race this extraction preserves)', async () => {
      (readCachedFaqBundle as jest.Mock).mockReturnValue(null);
      const bundle = await signFaqBundle([entry], DEV_PAIR);
      const msg = {
        senderId: TECHSUPPORT_ROOT_USER_ID,
        text: entry.answer,
        faqQuestionKey: entry.questionKey,
        faqAuthorPub: bundle.authorPub,
        faqSignature: bundle.signature,
      };
      expect(await filterVerifiedSupportMessages([msg], 'Bob')).toEqual([]);
    });

    it('drops a FAQ answer whose signature does not match the cached bundle (stale cache)', async () => {
      const staleBundle = await signFaqBundle([], DEV_PAIR);
      (readCachedFaqBundle as jest.Mock).mockReturnValue(staleBundle);
      const freshBundle = await signFaqBundle([entry], DEV_PAIR);
      const msg = {
        senderId: TECHSUPPORT_ROOT_USER_ID,
        text: entry.answer,
        faqQuestionKey: entry.questionKey,
        faqAuthorPub: freshBundle.authorPub,
        faqSignature: freshBundle.signature,
      };
      expect(await filterVerifiedSupportMessages([msg], 'Bob')).toEqual([]);
    });

    it('drops a FAQ answer whose text does not match the entry recorded under its questionKey', async () => {
      const bundle = await signFaqBundle([entry], DEV_PAIR);
      (readCachedFaqBundle as jest.Mock).mockReturnValue(bundle);
      const msg = {
        senderId: TECHSUPPORT_ROOT_USER_ID,
        text: 'a completely different answer',
        faqQuestionKey: entry.questionKey,
        faqAuthorPub: bundle.authorPub,
        faqSignature: bundle.signature,
      };
      expect(await filterVerifiedSupportMessages([msg], 'Bob')).toEqual([]);
    });
  });

  it('preserves relative order across a mix of kept and dropped messages', async () => {
    const greeting = await signGreeting('en', DEV_PAIR);
    const ordinary = { id: 'm1', senderId: 'alice', text: 'hi' };
    const keptGreeting = {
      id: 'support_welcome_bob',
      senderId: TECHSUPPORT_ROOT_USER_ID,
      text: greeting.template.replace('{name}', 'Bob'),
      greetingLocale: greeting.locale,
      greetingAuthorPub: greeting.authorPub,
      greetingSignature: greeting.signature,
    };
    const droppedGreeting = { ...keptGreeting, id: 'support_welcome_eve', text: 'tampered' };
    expect(
      await filterVerifiedSupportMessages([ordinary, droppedGreeting, keptGreeting], 'Bob'),
    ).toEqual([ordinary, keptGreeting]);
  });
});
