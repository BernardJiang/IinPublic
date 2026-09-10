/** @jest-environment jsdom */

import { refreshFlowAnswerConstraints } from '../../web/ui/flow-answer-constraints';

function questionRow(answerCount: number): void {
  const answers = Array.from({ length: answerCount }, () => `
    <div class="answer-item">
      <select class="answer-next">
        <option value="ignore">Ignore</option>
      </select>
    </div>`).join('');
  document.body.innerHTML += `
    <div class="question-item">
      <div class="answers-container">${answers}</div>
    </div>`;
}

const deps = { t: (key: string) => key };

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('refreshFlowAnswerConstraints', () => {
  it('leaves every select enabled, even for flow talks', () => {
    questionRow(2);
    refreshFlowAnswerConstraints('flow', deps);
    document.querySelectorAll('.answer-next').forEach((select) => {
      expect((select as HTMLSelectElement).disabled).toBe(false);
    });
  });

  it('adds the flow-constraint tooltip to every answer row after the first, only for flow talks', () => {
    questionRow(3);
    refreshFlowAnswerConstraints('flow', deps);
    const selects = Array.from(document.querySelectorAll('.answer-next')) as HTMLSelectElement[];
    expect(selects[0].title).toBe('');
    expect(selects[1].title).toBe('editorFlowConstraint');
    expect(selects[2].title).toBe('editorFlowConstraint');
  });

  it('does not add the tooltip for non-flow talk types', () => {
    questionRow(2);
    refreshFlowAnswerConstraints('tag', deps);
    document.querySelectorAll('.answer-next').forEach((select) => {
      expect((select as HTMLSelectElement).title).toBe('');
    });
  });

  it('resets a stale title from a previous render when switching away from flow', () => {
    questionRow(2);
    refreshFlowAnswerConstraints('flow', deps);
    refreshFlowAnswerConstraints('tag', deps);
    document.querySelectorAll('.answer-next').forEach((select) => {
      expect((select as HTMLSelectElement).title).toBe('');
    });
  });

  it('enables the ignore option even if previously disabled', () => {
    questionRow(1);
    const ignoreOpt = document.querySelector('option[value="ignore"]') as HTMLOptionElement;
    ignoreOpt.disabled = true;
    refreshFlowAnswerConstraints('flow', deps);
    expect(ignoreOpt.disabled).toBe(false);
  });

  it('does nothing when a question item has no answers-container', () => {
    document.body.innerHTML = '<div class="question-item"></div>';
    expect(() => refreshFlowAnswerConstraints('flow', deps)).not.toThrow();
  });

  it('handles multiple question items independently', () => {
    questionRow(2);
    questionRow(2);
    refreshFlowAnswerConstraints('flow', deps);
    const selects = Array.from(document.querySelectorAll('.answer-next')) as HTMLSelectElement[];
    expect(selects).toHaveLength(4);
    expect(selects[1].title).toBe('editorFlowConstraint');
    expect(selects[3].title).toBe('editorFlowConstraint');
  });
});
