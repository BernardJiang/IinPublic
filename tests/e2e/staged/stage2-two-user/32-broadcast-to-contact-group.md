# Test: Broadcast to a Contact Group

covers: docs/TODO.md §U — group-picker dialog on the Contacts tab, group resolution, and
delivery via the existing mesh-plus-mailbox broadcast path.

**File:** 32-broadcast-to-contact-group.spec.ts

## Test 1 — "group-picker resolves a custom group and delivers via the normal broadcast path"

1. **Setup:** Tom and Jerry match on a talk (`establishContactsTomJerry`, the same helper the
   reputation specs already use), giving Tom a real known contact.
2. **Tom labels Jerry with a custom group:** calls `UIManager.saveKnownPerson` directly (same
   trick `saveKnownPersonForE2e` already uses elsewhere) to set Jerry's relationship labels to
   `['custom']` / `"Tennis Buddy"` — the exact "no schema change needed" scenario docs/TODO.md
   §U describes.
3. **Tom creates a second talk** (separate from the match talk) to actually broadcast to the
   group.
4. **Tom opens the Contacts tab and the "Broadcast to group…" picker:** the dialog must list
   "Tennis Buddy (1)" as a selectable group — proving `listContactGroups` correctly picked up
   the custom label with the right member count. Selecting it updates the live preview text.
5. **Tom picks the talk and confirms:** the dialog closes and the talk is delivered.
6. **Jerry receives it** via the completely ordinary incoming-talk path, via the existing
   `getIncomingClusterTitlesForUser` helper — proving the group-broadcast handler correctly
   reused the same delivery mechanism every other broadcast path already uses, not a parallel
   one.

## Test 2 — "a contact with overlapping labels is reachable via either group broadcast"

Regression test for the `KnownPerson.label` → `labels[]` data-model change: a contact can now
belong to more than one relationship group at once (e.g. both "Friends" and "Coworkers"), and
must be reachable through *either* group's broadcast, not just whichever label happened to be
saved most recently.

1. **Setup:** same match-based contact establishment as Test 1.
2. **Tom labels Jerry with two overlapping built-in groups:** `saveKnownPerson(jerryId, {
   labels: ['friend', 'coworker'] })`.
3. **Tom creates a talk and broadcasts it to the "Friends (1)" group** — confirms the preview
   count includes Jerry and the talk is delivered; Jerry's incoming clusters get the title.
4. **Tom creates a second, distinct talk and broadcasts it to the "Coworkers (1)" group** —
   same contact, different group selection. Confirms Jerry receives this one too, proving the
   overlap: one `KnownPerson` entry, reachable via both of its groups independently.

## What this deliberately does NOT test (out of scope for this spec):

- The offline/mailbox-deferred delivery path (recipient not currently online) — the underlying
  mechanism (`onMailboxFallback` inside `deliverTalkToReceiversOverMesh`) is exactly the same
  code path every other broadcast already exercises and already has its own coverage
  (`05-mailbox-offline-response.spec.ts`); not repeated here.
- Blocked-user exclusion from a group — pure logic, covered by unit tests.
- Non-overlapping built-in group resolution and member counting — covered by unit tests
  (`contact-groups.test.ts`) rather than a second full browser run.

**Helpers used:** `establishContactsTomJerry`, `getCurrentUserId`, `getIncomingClusterTitlesForUser`,
`selectTalkEditorType`, `submitTalkEditorAndWaitForOut`, `afterLoad`/`afterSync`/`afterNav`/`afterAction`.
