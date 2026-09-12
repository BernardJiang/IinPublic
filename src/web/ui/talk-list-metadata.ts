import { resolveExpiresAtMs } from './broadcast-audience-preview';

export type TalkExpiryTone = 'neutral' | 'green' | 'amber' | 'red';

export function formatTalkExpiryTone(
  expiresAt: unknown,
  now: number = Date.now(),
): TalkExpiryTone {
  const expiresAtMs = resolveExpiresAtMs(expiresAt);
  if (!Number.isFinite(expiresAtMs)) return 'neutral';
  const left = expiresAtMs - now;
  if (left <= 0 || left <= 2 * 60 * 60 * 1000) return 'red';
  if (left <= 24 * 60 * 60 * 1000) return 'amber';
  return 'green';
}

export function getIncomingQuestionCount(cluster: any): number {
  const explicit = Number(cluster?.questionCount);
  if (Number.isFinite(explicit) && explicit > 0) return Math.floor(explicit);
  const questions = cluster?.latestTalk?.questions;
  if (Array.isArray(questions)) return questions.length;
  try {
    const parsed = JSON.parse(String(cluster?.questionsJson || '[]'));
    return Array.isArray(parsed) ? parsed.length : 0;
  } catch {
    return 0;
  }
}
