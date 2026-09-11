/** Closes the talk-response modal, switches to the Me tab, then scrolls to and
 *  briefly highlights the answered-talk row(s) for `talkId` once the tab has rendered. */
export function navigateToMyAnswerForTalk(talkId: string): void {
  document.getElementById('talk-response-modal')?.remove();
  (document.querySelector('.nav-btn[data-view="me"]') as HTMLElement | null)?.click();
  window.setTimeout(() => {
    // Merged rows can represent more than one contributing talk (data-talk-ids is a
    // space-separated set), so this matches any row that lists talkId among its variants,
    // not just a row whose sole identity equals talkId.
    const rows = document.querySelectorAll<HTMLElement>(`.answer-talk-item[data-talk-ids~="${talkId}"]`);
    const first = rows[0];
    if (!first) return;
    first.scrollIntoView({ behavior: 'smooth', block: 'center' });
    rows.forEach((row) => {
      row.classList.add('answer-item-highlighted');
      window.setTimeout(() => row.classList.remove('answer-item-highlighted'), 2000);
    });
  }, 0);
}
