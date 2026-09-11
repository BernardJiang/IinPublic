/** @jest-environment jsdom */

import { navigateToMyAnswerForTalk } from '../../web/ui/navigate-to-answer';

function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

beforeEach(() => {
  document.body.innerHTML = '';
  jest.useRealTimers();
});

describe('navigateToMyAnswerForTalk', () => {
  it('removes the talk-response modal if present', () => {
    document.body.innerHTML = '<div id="talk-response-modal"></div>';
    navigateToMyAnswerForTalk('t1');
    expect(document.getElementById('talk-response-modal')).toBeNull();
  });

  it('clicks the Me nav button to switch tabs', () => {
    document.body.innerHTML = '<button class="nav-btn" data-view="me"></button>';
    const btn = document.querySelector('.nav-btn[data-view="me"]') as HTMLElement;
    const clickSpy = jest.spyOn(btn, 'click');
    navigateToMyAnswerForTalk('t1');
    expect(clickSpy).toHaveBeenCalledTimes(1);
  });

  it('scrolls to and highlights matching rows after the tab renders, then removes the highlight', async () => {
    document.body.innerHTML = `
      <div class="answer-talk-item" data-talk-ids="t1"></div>
      <div class="answer-talk-item" data-talk-ids="t2 t1"></div>
      <div class="answer-talk-item" data-talk-ids="t3"></div>`;
    const rows = Array.from(document.querySelectorAll('.answer-talk-item')) as HTMLElement[];
    rows.forEach((row) => { row.scrollIntoView = jest.fn(); });

    navigateToMyAnswerForTalk('t1');
    await flush();

    expect(rows[0].scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'center' });
    expect(rows[0].classList.contains('answer-item-highlighted')).toBe(true);
    expect(rows[1].classList.contains('answer-item-highlighted')).toBe(true);
    expect(rows[2].classList.contains('answer-item-highlighted')).toBe(false);

    await new Promise((resolve) => setTimeout(resolve, 2100));
    expect(rows[0].classList.contains('answer-item-highlighted')).toBe(false);
    expect(rows[1].classList.contains('answer-item-highlighted')).toBe(false);
  }, 3000);

  it('does nothing when no row matches the talkId', async () => {
    document.body.innerHTML = '<div class="answer-talk-item" data-talk-ids="other"></div>';
    expect(() => navigateToMyAnswerForTalk('t1')).not.toThrow();
    await flush();
  });
});
