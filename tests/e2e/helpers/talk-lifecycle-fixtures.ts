/**
 * Deterministic talk creation for lifecycle / branch matrix E2E specs — built through the real
 * Talk Editor UI (`createFlowOrSurveyTalkViaEditor`/`createTagTalkViaEditor`, talk-demo-ui.ts),
 * not a script-supplied payload.
 */
import type { Page } from '@playwright/test';
import { createFlowOrSurveyTalkViaEditor, createTagTalkViaEditor } from './talk-demo-ui';

export async function createFlowTalkForLifecycle(
  page: Page,
  title: string,
  opts?: { matchText?: string; ignoreText?: string },
): Promise<{ title: string; talkId: string; talkData: any }> {
  const matchText = opts?.matchText ?? 'Yes';
  const ignoreText = opts?.ignoreText ?? 'No';
  return createFlowOrSurveyTalkViaEditor(page, {
    title,
    type: 'flow',
    questions: [
      {
        text: `Would you like to discuss ${title}?`,
        answers: [
          { text: matchText, outcome: 'match' },
          { text: ignoreText, outcome: 'ignore' },
        ],
      },
    ],
  });
}

export async function createTagTalkForLifecycle(
  page: Page,
  title: string,
): Promise<{ title: string; talkId: string; talkData: any }> {
  return createTagTalkViaEditor(page, { title });
}

/** `processTalkForm`'s flow branch (ui-manager.ts) ids answers `a_${qIndex}_${aIndex}` —
 *  deterministic from array position, matching `createFlowTalkForLifecycle`'s single question
 *  with match listed first (index 0), ignore second (index 1). */
export function flowMatchAnswerIds(): string[] {
  return ['a_0_0'];
}

export function flowIgnoreAnswerIds(): string[] {
  return ['a_0_1'];
}

/** `processTalkForm`'s tag branch hardcodes both ids regardless of author input. */
export function tagMatchAnswerIds(): string[] {
  return ['a_0_match'];
}

export function tagIgnoreAnswerIds(): string[] {
  return ['a_0_ignore'];
}

export const LIFECYCLE_FLOW_MATCH_TEXT = 'Yes, lets meet.';
export const LIFECYCLE_FLOW_IGNORE_TEXT = 'No thanks.';
