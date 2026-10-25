/**
 * One-tap tag answering motion (OPEN-87, docs/design/actionable-first-run-starter-talks.md): a
 * liked tag moves right, then down; a passed tag flies left, then up off the screen. Liking a
 * starter tag also passes every still-unanswered starter tag above it — the ones scrolled past
 * without a tap — so a long list takes one tap per liked tag.
 */

/** How long the two-step motion runs before the answer re-renders the list (CSS keeps in step). */
export const TAG_CHIP_FLY_MS = 520;

const UNANSWERED_STARTER_CHIP = '.talk-tag-chip.talk-incoming-new[data-starter-tag="true"]';

/** Unanswered starter tag chips above `row` in the list, top first. */
export function starterChipsScrolledPast(row: HTMLElement): HTMLElement[] {
  if (row.dataset.starterTag !== 'true') return [];
  const list = row.closest('#talks-list') ?? row.parentElement;
  if (!list) return [];
  return Array.from(list.querySelectorAll<HTMLElement>(UNANSWERED_STARTER_CHIP)).filter((chip) =>
    chip !== row && (chip.compareDocumentPosition(row) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0);
}

/**
 * Plays the motion on each chip, then runs `done` once. The Talks list re-renders often (sync,
 * toasts), which would replace a chip mid-flight, so a fixed-position copy flies while the chip
 * itself is hidden and stops taking taps.
 */
export function flyTagChips(
  moves: Array<{ chip: HTMLElement; direction: 'like' | 'pass' }>,
  done: () => void,
  schedule: (callback: () => void, ms: number) => unknown = (callback, ms) => window.setTimeout(callback, ms),
): void {
  if (moves.length === 0) {
    done();
    return;
  }
  const ghosts = moves.map(({ chip, direction }) => {
    const rect = chip.getBoundingClientRect();
    const ghost = chip.cloneNode(true) as HTMLElement;
    ghost.removeAttribute('data-talk-id');
    ghost.classList.add('talk-tag-fly-ghost', direction === 'like' ? 'talk-tag-fly-like' : 'talk-tag-fly-pass');
    Object.assign(ghost.style, {
      position: 'fixed', left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`,
      margin: '0', zIndex: '1000', pointerEvents: 'none', transition: 'none',
    });
    ghost.setAttribute('aria-hidden', 'true');
    document.body.appendChild(ghost);
    // `.talk-list-item` transitions `all`, which would keep the chip visible for its duration.
    chip.style.transition = 'none';
    chip.style.visibility = 'hidden';
    chip.setAttribute('aria-busy', 'true');
    return ghost;
  });
  schedule(() => {
    for (const ghost of ghosts) ghost.remove();
    done();
  }, TAG_CHIP_FLY_MS);
}
