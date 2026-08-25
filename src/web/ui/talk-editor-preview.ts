import { escapeHtml } from './ui-formatters';
import { TalkAutofix, checkIfMatch } from '../../shared/talk-engine';
import type { UiTranslationKey } from './ui-translations';

/**
 * Live "what the responder sees" preview — talk editor usability follow-up. Reads the CURRENT
 * in-progress form state (not the saved talk), runs it through the same `TalkAutofix.fix` the
 * real save path uses (so builtIn questions get their synthetic Compatible/Not-compatible
 * answers), and lets the author click through their own structure exactly like a real responder
 * would — using the real `checkIfMatch`/`checkIfIgnore` (talk-engine.ts) to decide the outcome,
 * not a reimplementation of the match logic. Entirely local: no drafts, no chatbot lookups, no
 * network — discarded the moment the panel is closed or the underlying form changes.
 *
 * Deliberately does NOT reuse `talk-response-dialog.ts`'s renderer — that one is a stateful
 * closure wired to localStorage drafts, chatbot auto-answer lookups, and real submission calls,
 * none of which belong in a scratch preview.
 */

export type TalkPreviewCollectors = {
  /** Reads the CURRENT flow/survey question list from the live DOM — pure, no validation/save. */
  collectFlowSurveyEditorQuestions: (type: 'flow' | 'survey') => any[];
  /** Reads the CURRENT route/DAG question list from the live DOM — pure, no validation/save. */
  collectRouteEditorQuestions: () => any[];
};

type PreviewOutcome = 'walking' | 'match' | 'ignore' | 'survey-complete' | 'empty';

type PreviewState = {
  talk: any;
  currentId: string | null;
  answers: { questionId: string; answerId: string; answerIds?: string[] }[];
  pendingQueue: string[];
  surveyIndex: number;
  outcome: PreviewOutcome;
};

function collectCurrentTalk(collectors: TalkPreviewCollectors): any {
  const type = (document.getElementById('talk-type') as HTMLSelectElement | null)?.value || 'flow';
  if (type === 'tag') {
    const keyword = (document.getElementById('talk-title') as HTMLInputElement | null)?.value.trim() || '';
    const isPairTag = (document.getElementById('tag-pair-checkbox') as HTMLInputElement | null)?.checked === true;
    const answerWord = isPairTag
      ? (document.getElementById('talk-answer') as HTMLInputElement | null)?.value.trim() || keyword
      : keyword;
    return {
      type,
      questions: keyword
        ? [{
            id: 'q_0',
            text: keyword,
            answers: [
              { id: 'a_0_match', text: answerWord, isMatch: true, isTerminal: true },
              { id: 'a_0_ignore', text: 'Ignore.', isIgnore: true, isTerminal: true },
            ],
          }]
        : [],
    };
  }
  if (type === 'route') {
    return { type, questions: collectors.collectRouteEditorQuestions() };
  }
  return { type, questions: collectors.collectFlowSurveyEditorQuestions(type as 'flow' | 'survey') };
}

function findRoot(talk: any): any | null {
  if (!Array.isArray(talk.questions) || talk.questions.length === 0) return null;
  if (talk.type === 'route') {
    return talk.questions.find((q: any) => Array.isArray(q.contextPath) && q.contextPath.length === 0) || talk.questions[0];
  }
  return talk.questions[0];
}

function freshState(collectors: TalkPreviewCollectors): PreviewState {
  const raw = collectCurrentTalk(collectors);
  if (!Array.isArray(raw.questions) || raw.questions.length === 0 || !raw.questions[0]?.text?.trim()) {
    return { talk: raw, currentId: null, answers: [], pendingQueue: [], surveyIndex: 0, outcome: 'empty' };
  }
  // Same fixup the real save path runs — generates builtIn questions' synthetic
  // Compatible/Not-compatible answers so the preview walk sees exactly what gets saved.
  const fixed = TalkAutofix.fix({ id: 'preview', title: '', type: raw.type, isAdult: false, questions: raw.questions } as any).talk;
  const root = findRoot(fixed);
  return {
    talk: fixed,
    currentId: root?.id ?? null,
    answers: [],
    pendingQueue: [],
    surveyIndex: 0,
    outcome: root ? 'walking' : 'empty',
  };
}

/** Advances the walk after `answerId` (or, for a multi-select question, `answerIds`) is chosen
 *  on the current question — mutates `state` in place, mirroring the small amount of branching
 *  state `talk-response-dialog.ts`'s own `pendingSpecQueue` pattern keeps for route fan-out. */
function advance(state: PreviewState, answerId: string, answerIds?: string[]): void {
  const questions: any[] = state.talk.questions;
  const byId = new Map(questions.map((q) => [q.id, q]));
  const current = state.currentId ? byId.get(state.currentId) : null;
  if (!current) return;
  state.answers.push({ questionId: current.id, answerId, ...(answerIds ? { answerIds } : {}) });

  const isMultiSelect = current.answerSelectionMode === 'multiple';
  const chosen = (current.answers || []).find((a: any) => a.id === answerId);

  if (state.talk.type === 'survey') {
    state.surveyIndex += 1;
    const next = questions[state.surveyIndex];
    state.currentId = next ? next.id : null;
    state.outcome = next ? 'walking' : 'survey-complete';
    return;
  }

  if (!isMultiSelect && chosen && Array.isArray(chosen.nextQuestionIds) && chosen.nextQuestionIds.length > 0) {
    for (const id of chosen.nextQuestionIds) {
      if (!state.pendingQueue.includes(id)) state.pendingQueue.push(id);
    }
  }
  if (state.pendingQueue.length > 0) {
    const answeredIds = new Set(state.answers.map((a) => a.questionId));
    const nextId = state.pendingQueue.find((id) => !answeredIds.has(id));
    if (nextId) {
      state.currentId = nextId;
      state.outcome = 'walking';
      return;
    }
  }
  if (!isMultiSelect && chosen?.nextQuestionId) {
    state.currentId = chosen.nextQuestionId;
    state.outcome = 'walking';
    return;
  }
  // Terminal — real engine decides, not a reimplementation. Anything that isn't a confirmed
  // match (including an explicit isIgnore answer) renders as filtered-out, same fallback
  // `checkIfMatch` itself applies.
  state.currentId = null;
  state.outcome = checkIfMatch(state.talk, state.answers as any) ? 'match' : 'ignore';
}

function renderStep(state: PreviewState, text: (key: UiTranslationKey, fallback: string) => string): string {
  if (state.outcome === 'empty') {
    return `<p style="color:var(--text-secondary); font-size:0.9em; margin:0;">${text('editorPreviewEmpty', 'Fill in a question to see the preview.')}</p>`;
  }
  if (state.outcome !== 'walking') {
    const resultText =
      state.outcome === 'match'
        ? text('editorPreviewMatchResult', '✅ This would be a match.')
        : state.outcome === 'survey-complete'
          ? text('editorPreviewSurveyComplete', 'Survey complete — thanks!')
          : text('editorPreviewIgnoreResult', '❌ This would be filtered out (ignored).');
    return `
      <p style="font-weight:600; margin:0 0 10px;">${escapeHtml(resultText)}</p>
      <button type="button" class="btn btn-secondary talk-preview-restart-btn">${text('editorPreviewRestart', '↺ Restart preview')}</button>
    `;
  }
  const questions: any[] = state.talk.questions;
  const current = questions.find((q) => q.id === state.currentId);
  if (!current) return '';
  const isMultiSelect = current.answerSelectionMode === 'multiple';
  const answers: any[] = (current.answers || []).filter((a: any) => !!a.text);
  const rows = isMultiSelect
    ? `
      <div style="display:flex; flex-direction:column; gap:6px; margin-bottom:10px;">
        ${answers
          .map(
            (a) => `
          <label style="display:flex; align-items:center; gap:8px; font-size:0.9em;">
            <input type="checkbox" class="talk-preview-multi-choice" value="${escapeHtml(a.id)}">
            ${escapeHtml(a.text)}
          </label>`,
          )
          .join('')}
      </div>
      <button type="button" class="btn btn-secondary talk-preview-multi-continue-btn">${text('responseRouteContinue', 'Continue')}</button>
    `
    : `
      <div style="display:flex; flex-direction:column; gap:6px;">
        ${answers
          .map(
            (a) => `<button type="button" class="btn btn-secondary talk-preview-answer-btn" data-answer-id="${escapeHtml(a.id)}" style="text-align:left;">${escapeHtml(a.text)}</button>`,
          )
          .join('')}
      </div>
    `;
  return `
    <p style="font-weight:600; margin:0 0 10px;">${escapeHtml(current.text || '')}</p>
    ${rows}
  `;
}

/**
 * Mounts + wires the collapsible preview panel. Call once per editor render (`talk-editor-dialog.ts`,
 * end of `renderForm()`) — `modal` is the `.modal-content`'s ancestor overlay, must already
 * contain a `<div id="talk-preview-panel">` placeholder and the rest of `#talk-editor-form`.
 */
export function mountTalkPreviewPanel(
  modal: HTMLElement,
  collectors: TalkPreviewCollectors,
  text: (key: UiTranslationKey, fallback: string) => string,
): void {
  const container = modal.querySelector('#talk-preview-panel');
  if (!container) return;
  container.innerHTML = `
    <details id="talk-preview-details">
      <summary style="cursor:pointer; font-weight:600; color:var(--text-secondary); user-select:none;">${text('editorPreviewToggle', '👁 Preview: what the responder sees')}</summary>
      <div id="talk-preview-body" style="margin-top:10px; padding:12px; border:1px solid var(--border); border-radius:8px; background:var(--bg-subtle);"></div>
    </details>
  `;
  const details = container.querySelector('#talk-preview-details') as HTMLDetailsElement;
  const body = container.querySelector('#talk-preview-body') as HTMLElement;

  let state: PreviewState = freshState(collectors);

  const render = (): void => {
    body.innerHTML = renderStep(state, text);
    body.querySelectorAll<HTMLButtonElement>('.talk-preview-answer-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        advance(state, btn.dataset.answerId || '');
        render();
      });
    });
    body.querySelector('.talk-preview-multi-continue-btn')?.addEventListener('click', () => {
      const checked = Array.from(body.querySelectorAll<HTMLInputElement>('.talk-preview-multi-choice:checked')).map((el) => el.value);
      if (checked.length === 0) return;
      advance(state, checked[0]!, checked);
      render();
    });
    body.querySelector('.talk-preview-restart-btn')?.addEventListener('click', () => {
      state = freshState(collectors);
      render();
    });
  };

  const refresh = (): void => {
    state = freshState(collectors);
    render();
  };

  details.addEventListener('toggle', () => {
    if (details.open) refresh();
  });

  let debounceTimer: number | undefined;
  modal.addEventListener('input', (event) => {
    if (!details.open) return;
    if ((event.target as HTMLElement | null)?.closest('#talk-preview-panel')) return;
    window.clearTimeout(debounceTimer);
    debounceTimer = window.setTimeout(refresh, 200);
  });
  modal.addEventListener('change', (event) => {
    if (!details.open) return;
    if ((event.target as HTMLElement | null)?.closest('#talk-preview-panel')) return;
    window.clearTimeout(debounceTimer);
    debounceTimer = window.setTimeout(refresh, 200);
  });
}
