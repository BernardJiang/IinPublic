/**
 * Pure formatting helpers shared across UI modules.
 * No DOM or state dependencies — safe to unit-test in Node.
 */

import { singleNonIgnoreAnswer } from '../../shared/talk-engine';

export function formatTimeAgo(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString();
}

export function formatExpiration(expiresAt: number | null | undefined): string {
  if (expiresAt == null) return 'Forever';
  const now = Date.now();
  if (now > expiresAt) return 'Expired';
  const oneDay = 24 * 60 * 60 * 1000;
  const left = expiresAt - now;
  if (left <= oneDay) return 'Expires in &lt;1d';
  if (left <= 7 * oneDay) return `Expires in ${Math.floor(left / oneDay)}d`;
  if (left <= 30 * oneDay) return `Expires in ${Math.floor(left / (7 * oneDay))}w`;
  if (left <= 365 * oneDay) return `Expires in ${Math.floor(left / (30 * oneDay))}mo`;
  return `Expires in ${Math.floor(left / (365 * oneDay))}y`;
}

export function formatLocalizedRelativeTime(
  date: Date,
  language: string,
  text: (key: 'talksJustNow') => string,
  format: (key: 'talksMinutesAgo' | 'talksHoursAgo' | 'talksDaysAgo', values: { count: number }) => string,
): string {
  if (language !== 'zh') return formatTimeAgo(date);
  const diffMs = Date.now() - date.getTime();
  const diffMins = Math.floor(diffMs / 60_000);
  const diffHours = Math.floor(diffMs / 3_600_000);
  const diffDays = Math.floor(diffMs / 86_400_000);
  if (diffMins < 1) return text('talksJustNow');
  if (diffMins < 60) return format('talksMinutesAgo', { count: diffMins });
  if (diffHours < 24) return format('talksHoursAgo', { count: diffHours });
  if (diffDays < 7) return format('talksDaysAgo', { count: diffDays });
  return date.toLocaleDateString('zh-CN');
}

export function formatLocalizedExpiration(
  expiresAt: number | null | undefined,
  language: string,
  text: (key: 'talksForever' | 'talksExpired') => string,
  format: (key: 'talksExpiresIn', values: { value: string }) => string,
): string {
  if (language !== 'zh') return formatExpiration(expiresAt);
  if (expiresAt == null) return text('talksForever');
  if (Date.now() > expiresAt) return text('talksExpired');
  const oneDay = 86_400_000;
  const left = expiresAt - Date.now();
  if (left <= oneDay) return format('talksExpiresIn', { value: '&lt;1 天' });
  if (left <= 7 * oneDay) return format('talksExpiresIn', { value: `${Math.floor(left / oneDay)} 天` });
  if (left <= 30 * oneDay) return format('talksExpiresIn', { value: `${Math.floor(left / (7 * oneDay))} 周` });
  if (left <= 365 * oneDay) return format('talksExpiresIn', { value: `${Math.floor(left / (30 * oneDay))} 个月` });
  return format('talksExpiresIn', { value: `${Math.floor(left / (365 * oneDay))} 年` });
}

export function formatLocationRadius(radiusMiles: number | null | undefined): string {
  if (radiusMiles == null) return 'Anywhere';
  return `${radiusMiles} mi`;
}

/**
 * Escape a string for safe insertion into HTML.
 * Covers the five characters that must be escaped in HTML text and quoted attributes.
 */
export function escapeHtml(text: string): string {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderTagAnswerSuffixHtml(answer: string): string {
  return `<span class="talk-tag-answer-suffix" style="color:var(--text-tertiary);font-weight:400;margin-left:2px;">?${escapeHtml(answer)}</span>`;
}

/**
 * A tag/Pair-tag row's title shows a "?answer" suffix when the declared/matched answer text
 * differs from the row's own title/keyword — e.g. a Pair-tag root declaring "sell" renders
 * "Buy a bike?sell" so the counterpart is visible without opening the row. Empty when the
 * answer IS the keyword (nothing extra to show).
 */
export function tagAnswerSuffix(talk: {
  title?: string;
  questions?: Array<{ text?: string; reciprocalTagContext?: boolean; answers?: Array<{ text?: string; isMatch?: boolean; isIgnore?: boolean }> }>;
  fullTalk?: {
    title?: string;
    questions?: Array<{ text?: string; reciprocalTagContext?: boolean; answers?: Array<{ text?: string; isMatch?: boolean; isIgnore?: boolean }> }>;
  };
}): string {
  const questions = talk?.questions ?? talk?.fullTalk?.questions;
  const rootQuestion = Array.isArray(questions) ? questions[0] : undefined;
  if (rootQuestion?.reciprocalTagContext) {
    const only = singleNonIgnoreAnswer(rootQuestion);
    const declaredAnswer = only?.text;
    const keyword = rootQuestion.text;
    if (keyword && declaredAnswer) {
      return declaredAnswer === keyword ? '' : renderTagAnswerSuffixHtml(declaredAnswer);
    }
  }
  // The tag's own keyword is its question text; the title may add an emoji ("☕ Coffee").
  const keyword = rootQuestion?.text || (talk?.title ?? talk?.fullTalk?.title);
  const matchAnswerText = rootQuestion?.answers?.find((a) => a?.isMatch)?.text;
  if (!keyword || !matchAnswerText || matchAnswerText === keyword) return '';
  return renderTagAnswerSuffixHtml(matchAnswerText);
}
