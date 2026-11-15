import { openMeFocus } from './graph-focus';

export const ANSWER_HIGHLIGHT_MS = 2000;

/** Closes the talk-response modal, switches to the Me tab, then scrolls to and
 *  briefly highlights the answered-talk row(s) for `talkId` once the tab has rendered.
 *  The Me tab can draw late or redraw (live tag statistics, OPEN-113), which replaces the rows,
 *  so the highlight is reapplied to every matching row drawn during the highlight time. */
export function navigateToMyAnswerForTalk(talkId: string, label = talkId): void {
  document.getElementById('talk-response-modal')?.remove();
  openMeFocus({ label, talkIds: [talkId] });
  // Merged rows can represent more than one contributing talk (data-talk-ids is a
  // space-separated set), so this matches any row that lists talkId among its variants,
  // not just a row whose sole identity equals talkId.
  const selector = `.answer-talk-item[data-talk-ids~="${talkId}"]`;
  let scrolled = false;
  const mark = (): void => {
    const rows = document.querySelectorAll<HTMLElement>(selector);
    if (!rows[0]) return;
    if (!scrolled) {
      scrolled = true;
      rows[0].scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
    rows.forEach((row) => { if (!row.classList.contains('answer-item-highlighted')) row.classList.add('answer-item-highlighted'); });
  };
  const observer = typeof MutationObserver === 'function' ? new MutationObserver(mark) : null;
  observer?.observe(document.body, { childList: true, subtree: true });
  window.setTimeout(mark, 0);
  window.setTimeout(() => {
    observer?.disconnect();
    document.querySelectorAll<HTMLElement>(selector).forEach((row) => row.classList.remove('answer-item-highlighted'));
  }, ANSWER_HIGHLIGHT_MS);
}
