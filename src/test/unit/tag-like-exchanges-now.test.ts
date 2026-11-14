/** @jest-environment jsdom */
/**
 * OPEN-112/113 phone check (1.0.248): liking a tag exchanged it only at the next periodic catch-up,
 * about three minutes later, so Contacts showed half the tags in common. A like now asks the app
 * to exchange with the current list at once ('publishTalk'); a pass does not.
 */
import { UIManager } from '../../web/ui/ui-manager';

type Private = {
  quickCompleteTagTalk(talk: unknown, checked: boolean): void;
  completeTalk: jest.Mock;
  saveAnswerPreference: jest.Mock;
};

const tacos = {
  id: 'tag-tacos',
  type: 'tag',
  title: '🌮 Tacos',
  questions: [{ id: 'q_0', text: 'Tacos', answers: [
    { id: 'q_0_match', text: 'Tacos', isMatch: true, isTerminal: true },
    { id: 'q_0_ignore', text: 'Ignore', isIgnore: true, isTerminal: true },
  ] }],
};

function setup() {
  document.body.innerHTML = '<div id="app"></div>';
  const ui = new UIManager();
  const internals = ui as unknown as Private;
  internals.completeTalk = jest.fn();
  internals.saveAnswerPreference = jest.fn();
  const published: unknown[] = [];
  ui.on('publishTalk', (payload) => published.push(payload));
  return { internals, published };
}

describe('liking a tag exchanges it now', () => {
  it('a like asks for an exchange with the current list', () => {
    const { internals, published } = setup();
    internals.quickCompleteTagTalk(tacos, true);
    expect(internals.completeTalk).toHaveBeenCalledWith(tacos, expect.any(Array), 'match', { forceCopyToMyTalks: true });
    expect(published).toEqual([{ talkId: 'tag-tacos' }]);
  });

  it('a pass does not', () => {
    const { internals, published } = setup();
    internals.quickCompleteTagTalk(tacos, false);
    expect(published).toEqual([]);
  });
});
