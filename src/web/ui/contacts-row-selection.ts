/**
 * Contacts rows carry no buttons: a long-press selects a row, and the AppBar's 📌 Pin and
 * ✕ Remove (demo bots only) act on it (`list-row-selection.ts`). Created once; actions use the
 * latest render's callbacks.
 */
import { toggleListItemPin } from './list-pins';
import { createRowSelection, type RowSelection } from './list-row-selection';
import type { StarterPracticeContactId } from './starter-talk-seeds';

export type ContactsRowSelectionDeps = {
  rerender: () => void;
  removeStarterPracticeContact: (id: StarterPracticeContactId) => void;
};

let selection: RowSelection | null = null;
let latest: ContactsRowSelectionDeps | null = null;

export function contactsRowSelection(deps: ContactsRowSelectionDeps): RowSelection {
  latest = deps;
  selection ??= createRowSelection({
    list: '#contacts-list',
    row: '.contact-item[data-contact-user-id], .starter-practice-contact',
    key: (row) => row.dataset.contactUserId || `starter:${row.dataset.starterContactId || ''}`,
    actions: [
      {
        buttonId: 'contacts-pin-btn',
        applies: (row) => !!row.dataset.contactUserId && row.dataset.supportContact !== 'true',
        run: (row) => {
          toggleListItemPin('contacts', row.dataset.contactUserId!);
          latest?.rerender();
        },
      },
      {
        buttonId: 'contacts-remove-btn',
        applies: (row) => row.classList.contains('starter-practice-contact'),
        run: (row) => latest?.removeStarterPracticeContact(row.dataset.starterContactId as StarterPracticeContactId),
      },
    ],
  });
  return selection;
}
