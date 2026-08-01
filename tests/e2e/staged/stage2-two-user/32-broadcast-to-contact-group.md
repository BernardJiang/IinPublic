# Test: Broadcast to a Contact Group

covers: docs/TODO.md §U — group-picker dialog on the Contacts tab, group resolution, and
delivery via the existing mesh-plus-mailbox broadcast path.

**File:** 32-broadcast-to-contact-group.spec.ts

## What this test does (in plain English):

1. **Setup:** Tom and Jerry match on a talk (`establishContactsTomJerry`, the same helper the
   reputation specs already use), giving Tom a real known contact.
2. **Tom labels Jerry with a custom group:** calls `UIManager.saveKnownPerson` directly (same
   trick `saveKnownPersonForE2e` already uses elsewhere) to set Jerry's relationship to
   `custom` / `"Tennis Buddy"` — the exact "no schema change needed" scenario docs/TODO.md §U
   describes.
3. **Tom creates a second talk** (separate from the match talk) to actually broadcast to the
   group.
4. **Tom opens the Contacts tab and the "Broadcast to group…" picker:** the dialog must list
   "Tennis Buddy (1)" as a selectable group — proving `listContactGroups` correctly picked up
   the custom label with the right member count. Selecting it updates the live preview text.
5. **Tom picks the talk and confirms:** the dialog closes and the talk is delivered.
6. **Jerry receives it** via the completely ordinary incoming-talk path (`GET
   /api/incoming-talks` under the hood, via the existing `getIncomingClusterTitlesForUser`
   helper) — proving the group-broadcast handler correctly reused the same delivery mechanism
   every other broadcast path already uses, not a parallel one.

## What this deliberately does NOT test (out of scope for this spec):

- The offline/mailbox-deferred delivery path (recipient not currently online) — the underlying
  mechanism (`onMailboxFallback` inside `deliverTalkToReceiversOverMesh`) is exactly the same
  code path every other broadcast already exercises and already has its own coverage
  (`05-mailbox-offline-response.spec.ts`); not repeated here.
- Built-in `RelationshipLabel` groups (Friend, Coworker, etc.) — same `listContactGroups`
  function, same resolution logic, covered by unit tests
  (`contact-groups.test.ts`) rather than a second full browser run.
- Blocked-user exclusion from a group — pure logic, covered by unit tests.

**Helpers used:** `establishContactsTomJerry`, `getCurrentUserId`, `getIncomingClusterTitlesForUser`,
`selectTalkEditorType`, `submitTalkEditorAndWaitForOut`, `afterLoad`/`afterSync`/`afterNav`/`afterAction`.
