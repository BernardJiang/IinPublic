import { TECHSUPPORT_ROOT_USER_ID } from '../../shared/techsupport';
import {
  verifyTechSupportGreeting,
  TECHSUPPORT_GREETING_TEMPLATES,
  verifySupportAck,
  TECHSUPPORT_SUPPORT_ACK_TEMPLATES,
  verifyOnboardingTips,
  TECHSUPPORT_ONBOARDING_TIPS_TEMPLATES,
  type GreetingLocale,
  type SupportAckLocale,
  type OnboardingTipsLocale,
} from '../../shared/techsupport-greeting';
import { verifyFaqBundle } from '../../shared/techsupport-faq-bundle';
import { readCachedFaqBundle } from '../services/techsupport-faq-cache';
import { fetchGrantFromCache } from '../services/techsupport-delegate-cache';

/**
 * K2 (docs/TODO.md): authenticity check for a *stored* TechSupport greeting record —
 * defends against tampering after the write-time verification in
 * `ensureSupportBootstrapForCurrentUser` (a corrupted downstream write, e.g. from a
 * compromised peer or a bug, must never render as if it were genuine). Re-derives the
 * template from the client's own compiled copy (never trusts a stored template string),
 * and additionally confirms the stored `text` is exactly what that verified template
 * renders to for the *current* user — closing the gap where `greetingSignature`/
 * `greetingLocale` are left untouched but `text` itself was altered after signing.
 *
 * K5 (docs/TODO.md): same discipline extended to two more TechSupport-authored,
 * locally-rendered message types — a FAQ auto-answer (`faqSignature`) and the new-question
 * ack (`ackSignature`) — plus the K2-extended "getting started" tips sequence
 * (`tipSignature`, one signed bundle per locale covering the whole ordered list). All fail
 * closed (K2-3): a verify failure drops the message silently, no error toast, no
 * impersonated message rendered. Everything else passes through unchanged.
 */
export async function filterVerifiedSupportMessages(messages: any[], stageName: string): Promise<any[]> {
  const kept: any[] = [];
  for (const msg of messages) {
    const isGreeting =
      typeof msg?.id === 'string' &&
      msg.id.startsWith('support_welcome_') &&
      msg.senderId === TECHSUPPORT_ROOT_USER_ID &&
      !!msg.greetingSignature;
    const isFaqAnswer = msg.senderId === TECHSUPPORT_ROOT_USER_ID && !!msg.faqSignature;
    const isAck = msg.senderId === TECHSUPPORT_ROOT_USER_ID && !!msg.ackSignature;
    const isTip = msg.senderId === TECHSUPPORT_ROOT_USER_ID && !!msg.tipSignature;

    if (isFaqAnswer) {
      const cached = readCachedFaqBundle();
      // docs/TODO.md K7: fetchGrant lets a delegate-signed bundle verify here too — the local
      // grant cache, not a live Gun read, since this render path has no Gun handle of its own.
      const verifiedBundle = cached ? await verifyFaqBundle(cached, { fetchGrant: fetchGrantFromCache }) : null;
      if (!verifiedBundle) continue;
      // The message must be attributed to the exact cached bundle version, not merely
      // any validly-signed bundle — otherwise a stale message could survive a bundle
      // rotation with a mismatched answer for the same questionKey.
      if (verifiedBundle.authorPub !== msg.faqAuthorPub || verifiedBundle.signature !== msg.faqSignature) continue;
      const entry = verifiedBundle.entries.find((e) => e.questionKey === msg.faqQuestionKey);
      if (!entry || entry.answer !== String(msg.text || '')) continue;
      kept.push(msg);
      continue;
    }

    if (isAck) {
      const locale = msg.ackLocale as SupportAckLocale;
      const verified = await verifySupportAck({
        locale,
        template: TECHSUPPORT_SUPPORT_ACK_TEMPLATES[locale],
        authorPub: msg.ackAuthorPub,
        signature: msg.ackSignature,
      });
      if (!verified) continue;
      const expectedText = verified.template.replace('{name}', stageName);
      if (String(msg.text || '') !== expectedText) continue;
      kept.push(msg);
      continue;
    }

    if (isTip) {
      const locale = msg.tipLocale as OnboardingTipsLocale;
      const verified = await verifyOnboardingTips({
        locale,
        tips: TECHSUPPORT_ONBOARDING_TIPS_TEMPLATES[locale],
        authorPub: msg.tipAuthorPub,
        signature: msg.tipSignature,
      });
      if (!verified) continue;
      const expectedText = verified.tips[msg.tipIndex as number];
      if (expectedText === undefined || String(msg.text || '') !== expectedText) continue;
      kept.push(msg);
      continue;
    }

    if (!isGreeting) {
      kept.push(msg);
      continue;
    }
    const locale = msg.greetingLocale as GreetingLocale;
    const verified = await verifyTechSupportGreeting({
      locale,
      template: TECHSUPPORT_GREETING_TEMPLATES[locale],
      authorPub: msg.greetingAuthorPub,
      signature: msg.greetingSignature,
    });
    if (!verified) continue;
    const expectedText = verified.template.replace('{name}', stageName);
    if (String(msg.text || '') !== expectedText) continue;
    kept.push(msg);
  }
  return kept;
}
