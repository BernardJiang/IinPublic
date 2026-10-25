/**
 * Talks rows without per-row buttons (owner design 2026-10-24):
 * - a tap on a tag acts at once: an incoming tag is liked (it moves to Outgoing), a liked tag in
 *   Outgoing is passed (the way back from a regretted Like), a passed tag is liked again;
 * - a long-press selects a row, and the AppBar's ✕ Pass · ♡ Like · 📌 Pin act on the selection,
 *   like the Chatrooms and Contacts actions. With nothing selected they are grayed out.
 * Consecutive tag chips are laid out side by side (`flowTagChips`).
 */

export type TalkToolbarAction = 'pass' | 'like' | 'pin';
const ACTIONS: readonly TalkToolbarAction[] = ['pass', 'like', 'pin'];

/** The selected row's key: its pin id, or its talk id for rows that cannot be pinned. */
let selectedKey = '';

const rowKey = (row: HTMLElement): string => row.dataset.pinId || row.dataset.talkId || '';

export function getSelectedTalkRow(): HTMLElement | null {
  if (!selectedKey) return null;
  const rows = document.querySelectorAll<HTMLElement>('#talks-list .talk-list-item');
  return Array.from(rows).find((row) => rowKey(row) === selectedKey) ?? null;
}

export function selectTalkRow(row: HTMLElement): void {
  selectedKey = rowKey(row);
  reapplyTalkRowSelection();
}

export function clearTalkRowSelection(): void {
  if (!selectedKey) return;
  selectedKey = '';
  reapplyTalkRowSelection();
}

/** Marks the selected row (rows are re-rendered often) and enables the toolbar for it. */
export function reapplyTalkRowSelection(): void {
  document.querySelectorAll<HTMLElement>('#talks-list .talk-list-item.is-selected').forEach((row) => {
    row.classList.remove('is-selected');
    row.removeAttribute('aria-selected');
  });
  const row = getSelectedTalkRow();
  if (!row && selectedKey) selectedKey = '';
  if (row) {
    row.classList.add('is-selected');
    row.setAttribute('aria-selected', 'true');
  }
  syncTalkToolbar(row);
}

/** What each toolbar action can do to a row: Pin needs a pinnable row; Like/Pass need a tag (or Pass an incoming Talk). */
export function toolbarActionApplies(action: TalkToolbarAction, row: HTMLElement | null): boolean {
  if (!row) return false;
  const isTag = row.classList.contains('talk-tag-chip');
  const role = row.dataset.role || '';
  if (action === 'pin') return !!row.dataset.pinId;
  if (action === 'like') return isTag && (role === 'incoming' || role === 'ignored');
  return (isTag && role !== 'ignored') || role === 'incoming';
}

export function syncTalkToolbar(row: HTMLElement | null = getSelectedTalkRow()): void {
  for (const action of ACTIONS) {
    const button = document.getElementById(`talks-tap-${action}-btn`) as HTMLButtonElement | null;
    if (button) button.disabled = !toolbarActionApplies(action, row);
  }
}

/**
 * Lays consecutive tag chips out side by side: each run of `.talk-tag-chip` rows moves into one
 * wrapping row, indented when it follows a group heading. Idempotent, and a run continued by a
 * later render chunk joins the wrapper before it. Taps stay delegated, so moving nodes is safe.
 */
export function flowTagChips(container: HTMLElement): void {
  let wrapper: HTMLElement | null = null;
  for (const node of Array.from(container.children) as HTMLElement[]) {
    if (node.classList.contains('talk-tag-chip-flow')) {
      wrapper = node;
      continue;
    }
    if (node.classList.contains('talk-tag-chip')) {
      if (!wrapper) {
        wrapper = document.createElement('div');
        wrapper.className = 'talk-tag-chip-flow';
        if (node.previousElementSibling?.classList.contains('starter-tag-group-heading')) {
          wrapper.classList.add('is-grouped');
        }
        node.before(wrapper);
      }
      wrapper.appendChild(node);
      continue;
    }
    wrapper = null;
  }
}
