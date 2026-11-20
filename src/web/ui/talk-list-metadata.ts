import { talkPathLength } from '../../shared/talk-path-length';
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

/** Questions a person answers: a flow or route counts its longest branch, not every question. */
export function getIncomingQuestionCount(cluster: any): number {
  const type = String(cluster?.type || cluster?.latestTalk?.type || '');
  let questions: unknown = cluster?.latestTalk?.questions;
  if (!Array.isArray(questions)) {
    try {
      questions = JSON.parse(String(cluster?.questionsJson || 'null'));
    } catch {
      questions = null;
    }
  }
  if (Array.isArray(questions) && questions.length > 0) {
    return type === 'flow' || type === 'route' ? talkPathLength({ type, questions }) : questions.length;
  }
  const explicit = Number(cluster?.questionCount);
  return Number.isFinite(explicit) && explicit > 0 ? Math.floor(explicit) : 0;
}
