import { canonicalSerialize } from './cid';
import SEA from 'gun/sea';
import { isTrustedTechSupportDmPub } from './techsupport';

/**
 * Signed, offline-renderable welcome greeting (docs/TODO.md K2, decisions K2-1..K2-3).
 *
 * The template is signed ONCE per locale with the TechSupport DM key (not the announcement
 * key — K3-1's key split) and shipped as a compiled artifact
 * (`techsupport-greeting.signed.json`). The client verifies the signature against the
 * compiled `TECHSUPPORT_GREETING_TEMPLATES` text and the DM trust anchors, and only AFTER
 * verification substitutes the `{name}` placeholder with the receiver's own stage name.
 * Nothing per-user is ever signed, stored on the relay, or transmitted — personalization
 * happens entirely client-side, after the authenticity check.
 */
export const TECHSUPPORT_GREETING_TEMPLATES = {
  en: 'Welcome to IinPublic, {name}. TechSupport is here if you need help.',
  zh: '欢迎来到 IinPublic，{name}。如需帮助，TechSupport 随时为你服务。',
} as const;

export type GreetingLocale = keyof typeof TECHSUPPORT_GREETING_TEMPLATES;

export function isGreetingLocale(value: unknown): value is GreetingLocale {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(TECHSUPPORT_GREETING_TEMPLATES, value);
}

export interface SignedGreeting {
  locale: GreetingLocale;
  template: string;
  authorPub: string;
  signature: string;
}

export type UnsignedGreeting = Omit<SignedGreeting, 'signature'>;

export function greetingSigningPayload(greeting: UnsignedGreeting): string {
  return canonicalSerialize({
    kind: 'techsupport-greeting',
    locale: greeting.locale,
    template: greeting.template,
    authorPub: greeting.authorPub,
  });
}

/** Build-time only (the signing script) — never called client-side. */
export async function signGreeting(
  locale: GreetingLocale,
  pair: { pub: string; priv: string; epub?: string; epriv?: string },
): Promise<SignedGreeting> {
  const unsigned: UnsignedGreeting = {
    locale,
    template: TECHSUPPORT_GREETING_TEMPLATES[locale],
    authorPub: pair.pub,
  };
  const signature = await SEA.sign(greetingSigningPayload(unsigned), pair);
  if (!signature) throw new Error('Could not sign TechSupport greeting');
  return { ...unsigned, signature };
}

/**
 * Verify a (possibly untrusted) greeting record. Returns the verified greeting or null —
 * never throws, so callers can suppress silently (K2-3) rather than surfacing an error.
 *
 * Checks, in order: shape, locale is one of the compiled locales, `authorPub` is a trusted
 * DM anchor, the `template` text matches the client's OWN compiled copy (a swapped template
 * is rejected even if otherwise validly signed by a trusted key), and the signature recovers
 * the exact canonical payload.
 */
export async function verifyTechSupportGreeting(value: unknown): Promise<SignedGreeting | null> {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Partial<SignedGreeting>;
  if (!candidate.locale || !candidate.template || !candidate.authorPub || !candidate.signature) return null;
  if (!isGreetingLocale(candidate.locale)) return null;
  if (!isTrustedTechSupportDmPub(candidate.authorPub)) return null;
  if (candidate.template !== TECHSUPPORT_GREETING_TEMPLATES[candidate.locale]) return null;

  const unsigned: UnsignedGreeting = {
    locale: candidate.locale,
    template: candidate.template,
    authorPub: candidate.authorPub,
  };
  try {
    const verified = await SEA.verify(candidate.signature, candidate.authorPub);
    const recovered = typeof verified === 'string' ? verified : canonicalSerialize(verified);
    if (recovered !== greetingSigningPayload(unsigned)) return null;
  } catch {
    return null;
  }
  return { ...unsigned, signature: candidate.signature };
}

/** Substitute the receiver's own stage name — only ever called AFTER verification succeeds. */
export function renderGreeting(template: string, name: string): string {
  return template.replace('{name}', name);
}

/**
 * Signed, offline-renderable "new question" acknowledgement (docs/TODO.md K5, design note
 * §Item 1b). Same problem as the welcome greeting — static text attributed to TechSupport that
 * must render while the TechSupport device is away — so it reuses the exact same
 * compile-once/sign-once/verify-before-substitute machinery rather than inventing a second
 * scheme. Kept in this file (not a parallel module) because it IS the greeting mechanism, just a
 * second template.
 */
export const TECHSUPPORT_SUPPORT_ACK_TEMPLATES = {
  en: "Thanks, {name}. This is a new question — a human will get back to you here.",
  zh: '谢谢你，{name}。这是一个新问题，我们的人工客服会在这里回复你。',
} as const;

export type SupportAckLocale = keyof typeof TECHSUPPORT_SUPPORT_ACK_TEMPLATES;

export function isSupportAckLocale(value: unknown): value is SupportAckLocale {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(TECHSUPPORT_SUPPORT_ACK_TEMPLATES, value);
}

export interface SignedSupportAck {
  locale: SupportAckLocale;
  template: string;
  authorPub: string;
  signature: string;
}

export type UnsignedSupportAck = Omit<SignedSupportAck, 'signature'>;

export function supportAckSigningPayload(ack: UnsignedSupportAck): string {
  return canonicalSerialize({
    kind: 'techsupport-support-ack',
    locale: ack.locale,
    template: ack.template,
    authorPub: ack.authorPub,
  });
}

/** Build-time only (the signing script) — never called client-side. */
export async function signSupportAck(
  locale: SupportAckLocale,
  pair: { pub: string; priv: string; epub?: string; epriv?: string },
): Promise<SignedSupportAck> {
  const unsigned: UnsignedSupportAck = {
    locale,
    template: TECHSUPPORT_SUPPORT_ACK_TEMPLATES[locale],
    authorPub: pair.pub,
  };
  const signature = await SEA.sign(supportAckSigningPayload(unsigned), pair);
  if (!signature) throw new Error('Could not sign TechSupport support ack');
  return { ...unsigned, signature };
}

/** Same verify discipline as `verifyTechSupportGreeting`: never throws, fail-closed on any mismatch. */
export async function verifySupportAck(value: unknown): Promise<SignedSupportAck | null> {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Partial<SignedSupportAck>;
  if (!candidate.locale || !candidate.template || !candidate.authorPub || !candidate.signature) return null;
  if (!isSupportAckLocale(candidate.locale)) return null;
  if (!isTrustedTechSupportDmPub(candidate.authorPub)) return null;
  if (candidate.template !== TECHSUPPORT_SUPPORT_ACK_TEMPLATES[candidate.locale]) return null;

  const unsigned: UnsignedSupportAck = {
    locale: candidate.locale,
    template: candidate.template,
    authorPub: candidate.authorPub,
  };
  try {
    const verified = await SEA.verify(candidate.signature, candidate.authorPub);
    const recovered = typeof verified === 'string' ? verified : canonicalSerialize(verified);
    if (recovered !== supportAckSigningPayload(unsigned)) return null;
  } catch {
    return null;
  }
  return { ...unsigned, signature: candidate.signature };
}

/**
 * Signed, offline-renderable "getting started" tips — a short ordered sequence of follow-up
 * messages TechSupport sends right after the K2 welcome greeting, one per app tab
 * (Chatrooms/Talks/Contacts/Me/Settings), mirroring the content of the in-app first-run
 * walkthrough (`onboarding-walkthrough.ts`) in TechSupport's own voice for a first-time user.
 * Same compile-once/sign-once/verify-before-substitute discipline as the K2 greeting, extended
 * to a list: the WHOLE ordered array is signed as one unit per locale, so a client can't
 * reorder, drop, or splice in an extra tip without invalidating the signature.
 */
export const TECHSUPPORT_ONBOARDING_TIPS_TEMPLATES = {
  en: [
    'Tip: Join a chatroom by location or topic in Chatrooms to meet people nearby, then broadcast your talks to everyone there.',
    "Tip: Create a Talk in the Talks tab — it's a question you send out. Answer the ones you receive to see if you're a match.",
    "Tip: When you and someone else answer a talk compatibly, that's a match — find them in Contacts and start chatting.",
    "Tip: Every question you've answered lives in the Me tab, so you can review or change past answers any time.",
    'Tip: Adjust filters, appearance, and privacy in Settings — you can replay the app tour any time from Settings → Help & Tour.',
  ],
  zh: [
    '小提示：在"聊天室"里按地点或话题加入房间，认识附近的人，然后向房间里的所有人广播你的话题。',
    '小提示：在"话题"标签页创建一个话题——那是你发送出去的问题。回答你收到的话题，看看你们是否匹配。',
    '小提示：当你和另一个人对同一个话题的回答相合时，就形成了匹配——在"联系人"里找到他们并开始聊天。',
    '小提示：你回答过的每一个问题都保存在"我"标签页，随时可以查看或修改。',
    '小提示：在"设置"里调整过滤器、外观和隐私——你也可以随时从"设置 → 帮助与导览"重新播放导览。',
  ],
} as const;

export type OnboardingTipsLocale = keyof typeof TECHSUPPORT_ONBOARDING_TIPS_TEMPLATES;

export function isOnboardingTipsLocale(value: unknown): value is OnboardingTipsLocale {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(TECHSUPPORT_ONBOARDING_TIPS_TEMPLATES, value);
}

export interface SignedOnboardingTips {
  locale: OnboardingTipsLocale;
  tips: readonly string[];
  authorPub: string;
  signature: string;
}

export type UnsignedOnboardingTips = Omit<SignedOnboardingTips, 'signature'>;

export function onboardingTipsSigningPayload(bundle: UnsignedOnboardingTips): string {
  return canonicalSerialize({
    kind: 'techsupport-onboarding-tips',
    locale: bundle.locale,
    tips: bundle.tips,
    authorPub: bundle.authorPub,
  });
}

/** Build-time only (the signing script) — never called client-side. */
export async function signOnboardingTips(
  locale: OnboardingTipsLocale,
  pair: { pub: string; priv: string; epub?: string; epriv?: string },
): Promise<SignedOnboardingTips> {
  const unsigned: UnsignedOnboardingTips = {
    locale,
    tips: TECHSUPPORT_ONBOARDING_TIPS_TEMPLATES[locale],
    authorPub: pair.pub,
  };
  const signature = await SEA.sign(onboardingTipsSigningPayload(unsigned), pair);
  if (!signature) throw new Error('Could not sign TechSupport onboarding tips');
  return { ...unsigned, signature };
}

/** Same verify discipline as `verifyTechSupportGreeting`: never throws, fail-closed on any mismatch. */
export async function verifyOnboardingTips(value: unknown): Promise<SignedOnboardingTips | null> {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Partial<SignedOnboardingTips>;
  if (!candidate.locale || !Array.isArray(candidate.tips) || !candidate.authorPub || !candidate.signature) return null;
  if (!isOnboardingTipsLocale(candidate.locale)) return null;
  if (!isTrustedTechSupportDmPub(candidate.authorPub)) return null;
  const expected = TECHSUPPORT_ONBOARDING_TIPS_TEMPLATES[candidate.locale];
  if (candidate.tips.length !== expected.length || candidate.tips.some((tip, i) => tip !== expected[i])) return null;

  const unsigned: UnsignedOnboardingTips = {
    locale: candidate.locale,
    tips: candidate.tips,
    authorPub: candidate.authorPub,
  };
  try {
    const verified = await SEA.verify(candidate.signature, candidate.authorPub);
    const recovered = typeof verified === 'string' ? verified : canonicalSerialize(verified);
    if (recovered !== onboardingTipsSigningPayload(unsigned)) return null;
  } catch {
    return null;
  }
  return { ...unsigned, signature: candidate.signature };
}
