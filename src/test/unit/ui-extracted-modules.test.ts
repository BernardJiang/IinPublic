/**
 * @jest-environment jsdom
 */

import { showMyTalksDialog } from '../../web/ui/my-talks-dialog';
import { showPreferencesDialog } from '../../web/ui/preferences-dialog';
import {
  addQuestionToForm,
  setupTalkFormHandlers,
  updateAllAnswerDropdowns,
} from '../../web/ui/talk-editor-form-helpers';

describe('extracted UI helpers', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    jest.restoreAllMocks();
  });

  it('my talks dialog calls toggle and open callbacks', () => {
    const talks = {
      talk1: {
        title: 'Coffee',
        role: 'created' as const,
        type: 'tag',
        disabled: false,
        lastInteraction: '2026-04-21T10:00:00.000Z',
      },
    };
    const onToggleBroadcast = jest.fn();
    const onOpenTalk = jest.fn();

    showMyTalksDialog({
      getMyTalks: () => talks,
      escapeHtml: (text) => text,
      onDeleteTalk: jest.fn(),
      onToggleBroadcast,
      onOpenTalk,
      onClearAll: jest.fn(),
    });

    const toggleBtn = document.querySelector('.toggle-broadcast-my-talks-btn') as HTMLButtonElement;
    toggleBtn.click();
    expect(onToggleBroadcast).toHaveBeenCalledWith('talk1', true);

    const item = document.querySelector('.talk-history-item') as HTMLDivElement;
    item.click();
    expect(onOpenTalk).toHaveBeenCalledWith('talk1');
    expect(document.getElementById('my-talks-modal')).toBeNull();
  });

  it('preferences dialog updates answer and mode through callbacks', () => {
    const updateAnswer = jest.fn();
    const updateMode = jest.fn();

    showPreferencesDialog({
      getPreferences: () => ({
        pref1: {
          answerId: 'a1',
          answerText: 'Yes',
          mode: 'manual',
          questionText: 'Do you like coffee?',
          allAnswers: [
            { id: 'a1', text: 'Yes' },
            { id: 'a2', text: 'No' },
          ],
          timestamp: '2026-04-21T10:00:00.000Z',
        },
      }),
      escapeHtml: (text) => text,
      updateAnswer,
      updateMode,
      deletePreference: jest.fn(),
      clearAll: jest.fn(),
      notify: jest.fn(),
    });

    const select = document.querySelector('.answer-select') as HTMLSelectElement;
    select.value = 'a2';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    expect(updateAnswer).toHaveBeenCalledWith('pref1', 'a2', 'No');

    const toggle = document.querySelector('.mode-toggle') as HTMLInputElement;
    toggle.checked = true;
    toggle.dispatchEvent(new Event('change', { bubbles: true }));
    expect(updateMode).toHaveBeenCalledWith('pref1', true);

    const badge = document.querySelector('.mode-badge-pref1') as HTMLElement;
    expect(badge.textContent).toContain('AUTO');
  });

  function makeEditorDOM() {
    document.body.innerHTML = `
      <form id="talk-editor-form"></form>
      <button id="cancel-talk-btn" type="button">Cancel</button>
      <button id="add-question-btn" type="button">Add Question</button>
      <select id="talk-type"><option value="flow" selected>flow</option></select>
      <div id="questions-container"></div>
    `;
    return {
      container: document.getElementById('questions-container') as HTMLElement,
      options: {
        refreshFlowAnswerConstraints: jest.fn(),
        processTalkForm: jest.fn(() => true),
      },
    };
  }

  it('talk editor form helpers add questions and populate next-question dropdowns', () => {
    const { container, options } = makeEditorDOM();

    addQuestionToForm(0, container, options);
    addQuestionToForm(1, container, options);
    updateAllAnswerDropdowns(options);

    const firstQuestion = container.querySelector('[data-question-index="0"]') as HTMLElement;
    expect(firstQuestion).not.toBeNull();
    expect(container.querySelectorAll('.answer-item')).toHaveLength(4);
    expect(container.querySelectorAll('.self-answer-ignore-row')).toHaveLength(2);

    const firstSelect = firstQuestion.querySelector('.answer-next') as HTMLSelectElement;
    const optionValues = Array.from(firstSelect.options).map((opt) => opt.value);
    expect(optionValues).toContain('q_1');

    setupTalkFormHandlers(document.body, options);
    const addQuestionBtn = document.getElementById('add-question-btn') as HTMLButtonElement;
    addQuestionBtn.click();
    expect(container.querySelectorAll('.question-item')).toHaveLength(3);
  });

  it('non-last questions have no Noticed option; last question has Noticed but no Go-to', () => {
    const { container, options } = makeEditorDOM();

    addQuestionToForm(0, container, options);
    addQuestionToForm(1, container, options);
    updateAllAnswerDropdowns(options);

    const q0 = container.querySelector('[data-question-index="0"]') as HTMLElement;
    const q1 = container.querySelector('[data-question-index="1"]') as HTMLElement;

    // Q1 (non-last): all answer-next selects must NOT have "noticed"
    q0.querySelectorAll('.answer-next').forEach((sel) => {
      const vals = Array.from((sel as HTMLSelectElement).options).map((o) => o.value);
      expect(vals).not.toContain('noticed');
      expect(vals).toContain('q_1');
    });

    // Q2 (last): all answer-next selects must have "noticed" and NOT have go-to links
    q1.querySelectorAll('.answer-next').forEach((sel) => {
      const vals = Array.from((sel as HTMLSelectElement).options).map((o) => o.value);
      expect(vals).toContain('noticed');
      expect(vals).not.toContain('q_1');
    });
  });

  it('adding a question auto-converts noticed on the now-non-last question to go-to-next', () => {
    const { container, options } = makeEditorDOM();

    // Single question — first answer defaults to "noticed" (last question, valid)
    addQuestionToForm(0, container, options);
    updateAllAnswerDropdowns(options);

    const q0 = container.querySelector('[data-question-index="0"]') as HTMLElement;
    const firstSel = q0.querySelector('.answer-next') as HTMLSelectElement;

    // Manually set to "noticed" while Q0 is still the last question
    firstSel.value = 'noticed';
    expect(firstSel.value).toBe('noticed');

    // Now add Q1 — Q0 becomes non-last; updateAllAnswerDropdowns fires
    setupTalkFormHandlers(document.body, options);
    (document.getElementById('add-question-btn') as HTMLButtonElement).click();

    // Q0's "noticed" must have been auto-converted to "q_1"
    expect(firstSel.value).toBe('q_1');

    // Q0 dropdown must no longer contain "noticed"
    const vals = Array.from(firstSel.options).map((o) => o.value);
    expect(vals).not.toContain('noticed');
  });
});
