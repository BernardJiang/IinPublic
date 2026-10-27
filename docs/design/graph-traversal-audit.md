# Four-tab graph traversal audit

Date: 2026-10-26. Scope: current working tree, including OPEN-92 map navigation and
OPEN-93 list effects. The findings below describe the original audit.

**Implemented 2026-10-27 (OPEN-94):** all listed gaps were addressed in the GUI. Historical Place
links now inspect exchange history without changing the active audience; explicit room rows retain
enter/travel behavior. All 12 directed tab pairs are covered by stage1/95. Validation: 186 unit tests,
8 browser tests (including the three-user exchange tour), TypeScript and ESLint; see `../completed.md` for the outcome.

At the time of the audit, the four tabs already had routes to the other three at a tab level. They did not yet provide
consistent traversal for every relevant person, Talk, answer, and Place. A bottom-tab click does
not count as following a graph edge: the destination must preserve the selected relationship.

## Directed links at the time of the audit

| From | Chatrooms | Contacts | Talks | Me |
| --- | --- | --- | --- | --- |
| Chatrooms | — | Map person/relationship; list person goes through conversation first; people met here | Map connection/person card; Talks here in browser list | Self star/row opens Me |
| Contacts | Met in Place, latest only | — | Our Talks, incorrectly gated by having tags | Shared liked tags only |
| Talks | Place link on non-tag cards; missing on tag chips | Tag's people; non-tag people generally use conversation-first navigation | — | Tag answer mark; non-tag answer-review link uses a separate navigation path |
| Me | Where exchanged, latest only | People associated with the question/tag | Talks that asked the question | — |

Missing data is not itself a broken link: an unanswered Talk has no answer edge, and an exchange
without a recorded Place has no Place edge. The gaps below occur despite relevant data existing,
or because equivalent surfaces use different navigation behavior.

## Confirmed gaps and recommended fixes

1. **Contacts → Talks disappears for people with no tags.**
   `tag-graph-view.ts:renderPeerTagsInto` returns when `tags.length === 0`, before creating the
   all-exchanged-Talks link. A person with Flow/Survey/Route exchanges can therefore have history
   but no link to the focused Talks tab. Move Our Talks outside the tag section and use the same
   live peer focus as map connections (`openPeerTalks`). History rows currently open a conversation
   or creator responses; they do not replace this edge.

2. **Talks → Chatrooms is missing from tag chips.**
   Both outgoing and incoming tag renderers return early; their shared `tagFace` supplies answer
   and people links but no Place link. Non-tag cards have `placeLinkHtml`. Add the equivalent
   known-Places link for exchanged tags.

3. **Place edges cannot reach all known Places reliably.**
   `placeLinkHtml` shows only the first Place plus a non-selectable `+N`. `openPlace` relies on
   clicking a currently rendered room row; an older/unlisted Place silently opens only the tab.
   Its broad `[data-room-id]` selector can also choose the current Place's summary div instead of
   the actual room row. Resolve the destination by room ID, make every known Place selectable,
   and show an explicit unavailable state when necessary. Historical Place inspection should
   be distinct from the existing enter/travel action; ordinary graph browsing should not silently
   change the active audience.

4. **People navigation differs across map, lists, and Talks.**
   Map person navigation opens the relationship page under Contacts and records Back. Nearby
   and Place roster rows and non-tag Talk person links use `openUserConversationFirst` through
   the older dispatcher; they may open a conversation while the original tab stays selected.
   Provide a consistent relationship destination and a separately named Message action.

5. **The graph trail loses context on some paths.**
   `openContactsTopic` overwrites the filter before recording the source step: Coffee → Pizza →
   Back retains Pizza. `openMeFocus` and `openTalksFocus` likewise set destination focus before
   capturing the source. `navigateToMyAnswerForTalk` clicks the Me tab directly, clearing the
   graph trail and bypassing the focused-answer behavior. The trail also has no Place ID or
   list/detail state, so its tab-only record cannot restore different visited Places. Capture
   source state before changing destination state and use one context-aware navigation layer.

6. **Graph links rendered as spans lack keyboard activation.**
   The shared links and person summary links have `role="link" tabindex="0"`, but only click
   handlers. Enter on a Me → Talks span does nothing. Inside Talks tag chips, the parent key
   handler can act on the tag instead of following the focused child link. Use native controls
   or a shared keyboard handler that prevents parent actions.

## Context links to complete the product model

- **Contacts → Me:** retain Shared tags, and add My answers to Talks exchanged with this person
  for non-tag content. The existing edge covers only shared liked tags.
- **Chatrooms → Me:** keep the self shortcut; additionally offer My answers here when answers
  exist for Talks exchanged in that Place. This follows a Place relationship rather than opening
  all of Me.
- **Place detail → Contacts/Talks:** expose People met here and Talks here within the detail view.
  The existing summary is rendered only in the browser list, which is hidden while detail is open.
- Prefer small, named contextual links: People, Talks, My answers, and Places. Show a clear empty
  state for a requested relationship with no available content; do not fabricate an association.

## Verification and implementation boundary

- Reviewed callers in graph-focus, tag-graph-view, chatrooms-view, talks-list-view, answers-view,
  peer-controller, user-detail-view, ui-manager, and navigate-to-answer.
- Ran seven existing unit suites: **105 tests passed**. These cover the established paths, but
  passing them does not establish complete traversal coverage.
- A temporary jsdom probe reproduced five gaps: no Talks link for a non-tag-only peer; Coffee →
  Pizza → Back kept Pizza; Enter on a Me → Talks span stayed on Me; answer-review navigation
  removed an existing Back trail; and a Place summary preceding its room row prevented entry.
- No application code, database code, or phone state changed for this audit. Fixes should use
  existing core-backed GUI views and UI navigation state, with no new persistence schema.
- Future validation should cover all 12 directed tab pairs with tags and non-tag Talks,
  multiple/unlisted Places, list and map entry points, nested Back, keyboard, and touch.
