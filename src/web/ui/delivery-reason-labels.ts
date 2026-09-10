import type { UiTranslationKey } from './ui-translations';

const REASON_TRANSLATION_KEYS: Record<string, UiTranslationKey> = {
  intake_language: 'reasonIntakeLanguage',
  intake_talk_type: 'reasonIntakeTalkType',
  intake_min_distance: 'reasonIntakeMinDistance',
  intake_max_distance: 'reasonIntakeMaxDistance',
  intake_sent_after: 'reasonIntakeSentAfter',
  intake_grammar: 'reasonIntakeGrammar',
  intake_dirty_words: 'reasonIntakeDirtyWords',
  intake_custom_blocked_terms: 'reasonIntakeCustomTerms',
  talk_expired: 'reasonTalkExpired',
  broadcast_disabled: 'reasonBroadcastDisabled',
  peer_already_sent: 'peerOmitAlreadySent',
  age_gate: 'reasonAgeGate',
  blocked_user: 'reasonBlockedUser',
  broadcast_max_distance: 'reasonBroadcastMaxDistance',
  tag_targeting: 'reasonTagTargeting',
  sender_capacity: 'reasonCapacity',
  symmetric_rate_limit: 'reasonRateLimit',
  daily_talk_send_rate_limit: 'reasonRateLimit',
  daily_talk_receive_rate_limit: 'reasonRateLimit',
  weekly_talk_send_rate_limit: 'reasonRateLimit',
  weekly_talk_receive_rate_limit: 'reasonRateLimit',
};

/** Translated label for a delivery/filter-rejection reason code; falls back to a spaced-out raw code for an unrecognized one. */
export function deliveryReasonLabel(reason: string, t: (key: UiTranslationKey) => string): string {
  const translationKey = REASON_TRANSLATION_KEYS[reason];
  return translationKey ? t(translationKey) : reason.replace(/_/g, ' ');
}

/** Renders a `{reason: count}` map as a sorted, positive-count-only, "Label: N · Label: N" summary. */
export function formatReasonCounts(counts: Record<string, number>, t: (key: UiTranslationKey) => string): string {
  return Object.entries(counts)
    .filter(([, count]) => count > 0)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([reason, count]) => `${deliveryReasonLabel(reason, t)}: ${count}`)
    .join(' · ');
}
