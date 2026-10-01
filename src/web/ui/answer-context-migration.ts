/**
 * Answer-context version migration (docs/design/contextual-chatbot-memory.md's "Privacy and
 * migration" section, extended 2026-09-30 per Bernard's request).
 *
 * The v1→v2 rewrite (contextual-chatbot-memory) intentionally does NOT try to convert an old
 * content-hash-keyed record into a new one — a SHA-256 can't be reversed or reinterpreted under
 * a different algorithm, so there is no such thing as "upgrading" a `flat_<hash>` key into a
 * `flat_v2_<hash>` key. What this module does instead is regenerate the CURRENT version's memory
 * from the durable, version-independent source of truth every talk's own record already carries:
 * `myTalks[id].fullTalk` (the real question DAG) plus every recorded (talkId, questionId) →
 * answer in the legacy `answerPreferences` map (written for every self-answer AND every answered
 * response, regardless of algorithm version — see `saveAnswerPreference`'s `legacyKey`).
 *
 * Replaying that history through the CURRENT `saveAnswerPreference`/
 * `resolveAnswerPreferenceForTalkQuestion` is exactly what a live session would have produced —
 * so after this runs once, the chatbot behaves as if it had learned everything live under the
 * new algorithm, instead of forgetting every prior answer and re-asking. This is a one-time,
 * no-user-interaction pass gated by `ANSWER_CONTEXT_VERSION`, safe to leave wired in permanently:
 * the next time that constant changes (v2→v3, …), this same file re-runs the same replay against
 * the same source data with zero new code needed, as long as `saveAnswerPreference`/
 * `resolveAnswerPreferenceForTalkQuestion` keep accepting the shapes used below.
 */

import { ANSWER_CONTEXT_VERSION, immediateParentQAPairs } from '../../shared/flattened-answer-keys';
import { getRouteRootChildQuestionIds } from '../../shared/talk-engine';
import {
  getAnswerPreferences,
  setFlattenedAnswerPreferences,
  type AnswerPreferenceEntry,
} from './answer-preferences-storage';
import { getMyTalks } from './my-talks-storage';
import { resolveAnswerPreferenceForTalkQuestion, saveAnswerPreference } from './answer-preference-resolution';

const ANSWER_CONTEXT_MIGRATED_VERSION_KEY = 'answerContextMigratedVersion';

/** Exposed for tests and for callers that want to log/skip without touching storage. */
export function needsAnswerContextMigration(): boolean {
  try {
    const raw = localStorage.getItem(ANSWER_CONTEXT_MIGRATED_VERSION_KEY);
    const migratedVersion = raw ? Number(raw) : 0;
    return !Number.isFinite(migratedVersion) || migratedVersion < ANSWER_CONTEXT_VERSION;
  } catch {
    // No localStorage (e.g. some test/SSR context) — nothing to migrate, and nothing to mark.
    return false;
  }
}

type SessionAnswer = { questionId: string; answerId?: string; answerText?: string; contextHash?: string };

function findRootQuestion(talk: any): any | undefined {
  const questions: any[] = Array.isArray(talk?.questions) ? talk.questions : [];
  if (questions.length === 0) return undefined;
  if (talk?.type === 'route') {
    return questions.find((q: any) => Array.isArray(q.contextPath) && q.contextPath.length === 0) || questions[0];
  }
  return questions[0];
}

/**
 * Replays one saved talk's recorded question→answer history through the current resolver,
 * regenerating fresh current-version `flattenedAnswerPreferences`/`answerPreferences` entries.
 *
 * The DAG walk mirrors `tryBuildChatbotAnswersFromFlattened`'s own `visit()` (root →
 * `nextQuestionId`/`nextQuestionIds` fan-out, Pair-tag exclusion from the rolling chain) so the
 * regenerated contexts match what a live session would have produced. Two things it does that a
 * live self-answer session does NOT:
 *
 * - A `builtIn` question (ageRange/typed comparison) is resolved live via
 *   `resolveAnswerPreferenceForTalkQuestion` instead of requiring a recorded self-answer —
 *   `route-editor-model.ts`'s `buildRouteSelfAnswers` never records one for a builtIn node ("a
 *   built-in node has no authored self-answer"), so without this a Pair-tag branch sitting past
 *   a builtIn root could never recover that root as its rolling-context ancestor.
 * - A `matchThreshold` route's direct spec children (`getRouteRootChildQuestionIds`) are visited
 *   directly, bypassing the root — they're root-independent by construction (same design already
 *   used by the live resolver), and the structural root itself is never self-answered either.
 */
function replayTalkForMigration(
  currentUserId: string | undefined,
  talk: any,
  talkInstanceId: string,
  recordedByQuestionId: Map<string, AnswerPreferenceEntry>,
): void {
  const questions: any[] = Array.isArray(talk?.questions) ? talk.questions : [];
  if (questions.length === 0) return;
  const byId = new Map<string, { q: any; i: number }>(questions.map((q: any, i: number) => [q.id, { q, i }]));
  const acc: SessionAnswer[] = [];
  const visited = new Set<string>();

  const visit = (question: any | undefined): void => {
    if (!question || visited.has(question.id)) return;
    visited.add(question.id);
    const entry = byId.get(question.id);
    if (!entry) return;

    let answerId: string;
    let answerText: string;
    let mode: 'auto' | 'manual' | 'whenever' = 'auto';

    if (question.builtIn) {
      const previousQAPairs = immediateParentQAPairs(talk, question, acc);
      const pref = resolveAnswerPreferenceForTalkQuestion(currentUserId, talk, entry.i, previousQAPairs, question, talkInstanceId);
      if (!pref) return; // not deterministically resolvable (e.g. missing consent) — stop here
      answerId = pref.answerId;
      answerText = pref.answerText;
    } else if (question.answerSelectionMode === 'multiple') {
      // Multi-select has no v2 rolling-context concept (see
      // answer-preference-resolution-characterization.test.ts's "does not infer a multi-select
      // choice..."); it keeps its own separate exact-chatbot-memory mechanism, untouched by this
      // migration. Always chain-terminal (§30.8), so nothing to continue past anyway.
      return;
    } else {
      const recorded = recordedByQuestionId.get(question.id);
      if (!recorded) return; // never actually answered — nothing to replay past here
      answerId = recorded.answerId;
      answerText = recorded.answerText || '';
      mode = recorded.mode === 'manual'
        ? 'manual'
        : recorded.mode === 'whenever'
          ? 'whenever'
          : 'auto';
    }

    const sessionAnswer: SessionAnswer = { questionId: question.id, answerId, answerText };
    acc.push(sessionAnswer);
    sessionAnswer.contextHash = saveAnswerPreference(
      currentUserId,
      talk,
      talkInstanceId,
      question,
      answerId,
      answerText,
      acc,
      mode,
    );

    if (answerId === 'ignore') return;
    const chosenAnswer = (question.answers || []).find((a: any) => a.id === answerId);
    if (Array.isArray(chosenAnswer?.nextQuestionIds) && chosenAnswer.nextQuestionIds.length > 0) {
      for (const childId of chosenAnswer.nextQuestionIds) visit(byId.get(childId)?.q);
    } else if (chosenAnswer?.nextQuestionId) {
      visit(byId.get(chosenAnswer.nextQuestionId)?.q);
    }
  };

  if (talk.type === 'survey' || talk.type === 'tag') {
    for (const q of questions) visit(q);
    return;
  }

  const routeChildIds = talk.type === 'route' ? getRouteRootChildQuestionIds(talk) : null;
  if (routeChildIds) {
    for (const childId of routeChildIds) visit(byId.get(childId)?.q);
    return;
  }

  visit(findRootQuestion(talk));
}

/**
 * Runs once per `ANSWER_CONTEXT_VERSION` bump, synchronously, with no user interaction: rebuilds
 * `flattenedAnswerPreferences` from scratch (old-version entries are unrecoverable dead keys, not
 * data worth preserving — see this file's own header) by replaying every saved talk's recorded
 * answers through the current algorithm. Safe to call on every boot; it no-ops immediately once
 * the version marker is current.
 */
export function runAnswerContextMigration(currentUserId: string | undefined): { migratedTalks: number } {
  if (!needsAnswerContextMigration()) return { migratedTalks: 0 };

  let migratedTalks = 0;
  try {
    // The content-hash-keyed store's old entries are dead weight under a retired algorithm —
    // there's no reversible transform from an old hash to a new one, so start clean and let the
    // replay below repopulate it from the real (talk, answer) history instead.
    setFlattenedAnswerPreferences({});

    const legacyMap = getAnswerPreferences();
    const recordedByTalk = new Map<string, Map<string, AnswerPreferenceEntry>>();
    for (const [key, entry] of Object.entries(legacyMap)) {
      const talkId = entry.talkId;
      if (!talkId || !key.startsWith(`${talkId}_`)) continue;
      const questionId = key.slice(talkId.length + 1);
      if (!questionId) continue;
      let byQuestion = recordedByTalk.get(talkId);
      if (!byQuestion) {
        byQuestion = new Map();
        recordedByTalk.set(talkId, byQuestion);
      }
      byQuestion.set(questionId, entry);
    }

    const myTalks = getMyTalks();
    for (const [talkId, myTalk] of Object.entries(myTalks)) {
      const fullTalk = myTalk?.fullTalk;
      if (!fullTalk || !Array.isArray(fullTalk.questions) || fullTalk.questions.length === 0) continue;
      const recordedByQuestionId = recordedByTalk.get(talkId) ?? recordedByTalk.get(fullTalk.id);
      if (!recordedByQuestionId || recordedByQuestionId.size === 0) continue;
      replayTalkForMigration(currentUserId, fullTalk, talkId, recordedByQuestionId);
      migratedTalks += 1;
    }
  } finally {
    // Marked even on a partial/failed pass: a retry would replay from the same source data and
    // reach the same result, so there's nothing to gain from re-running every boot, and holding
    // the marker back would mean a crash loop keeps re-attempting instead of degrading safely to
    // "ask the user once more."
    try {
      localStorage.setItem(ANSWER_CONTEXT_MIGRATED_VERSION_KEY, String(ANSWER_CONTEXT_VERSION));
    } catch {
      // Best-effort — storage may be full or unavailable; migration still ran for this session.
    }
  }
  return { migratedTalks };
}
