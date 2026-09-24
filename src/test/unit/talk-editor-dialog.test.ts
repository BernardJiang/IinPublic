/** @jest-environment jsdom */

import { showTalkEditorDialog } from '../../web/ui/talk-editor-dialog';

function openEditor(existingTalk?: any): void {
  showTalkEditorDialog({
    existingTalk,
    currentUserId: 'self',
    escapeHtml: (value) => value,
    getAnswerPreferences: () => ({}),
    addQuestionToForm: (_index, container) => {
      const row = document.createElement('div');
      row.className = 'question-item';
      container.appendChild(row);
    },
    addAnswerToQuestion: jest.fn(),
    appendIgnoreRow: jest.fn(),
    applyBuiltInKindToQuestion: jest.fn(),
    applyTagKindVisibilityToQuestion: jest.fn(),
    updateAllAnswerDropdowns: jest.fn(),
    refreshFlowAnswerConstraints: jest.fn(),
    ensureRouteEditorRendered: jest.fn(),
    setupTalkFormHandlers: jest.fn(),
    syncAdultLockFromBuiltInKinds: jest.fn(),
    previewCollectors: {
      collectFlowSurveyEditorQuestions: () => [],
      collectRouteEditorQuestions: () => [],
    },
  });
}

describe('talk editor compact layout', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('keeps Create outside the scrolling form and collapses optional controls for a simple tag', () => {
    openEditor();

    const modal = document.getElementById('talk-editor-modal')!;
    const form = document.getElementById('talk-editor-form')!;
    const actions = modal.querySelector('.talk-editor-actions')!;
    const submit = document.getElementById('talk-submit-btn') as HTMLButtonElement;
    const more = document.getElementById('talk-editor-more') as HTMLDetailsElement;

    expect(modal.querySelector('.talk-editor-shell')).not.toBeNull();
    expect(modal.querySelectorAll('.talk-type-grid .talk-type-option')).toHaveLength(4);
    expect(form.contains(actions)).toBe(false);
    expect(submit.getAttribute('form')).toBe('talk-editor-form');
    expect(more.open).toBe(false);
    expect(document.getElementById('talk-is-adult')).not.toBeNull();
    expect(document.getElementById('talk-attachment-input')).not.toBeNull();

    (modal.querySelector('input[value="flow"]') as HTMLInputElement).click();
    expect(more.open).toBe(true);
    expect((document.getElementById('talk-type') as HTMLSelectElement).value).toBe('flow');

    (modal.querySelector('input[value="tag"]') as HTMLInputElement).click();
    expect(more.open).toBe(false);
  });

  it('provides a top close control and keeps advanced values exposed while editing', () => {
    openEditor({
      id: 'talk-1',
      authorId: 'self',
      title: 'Coffee',
      type: 'tag',
      isAdult: true,
      questions: [],
    });

    expect((document.getElementById('talk-editor-more') as HTMLDetailsElement).open).toBe(true);
    expect(document.getElementById('talk-submit-btn')?.textContent).toBe('Save changes');

    document.getElementById('close-talk-editor-btn')?.click();
    expect(document.getElementById('talk-editor-modal')).toBeNull();
  });
});
