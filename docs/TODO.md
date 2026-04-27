# IinPublic TODO

Last updated: 2026-04-26

This file is the prioritized backlog for the current repository. It is intentionally short.
It should describe what is still worth doing, not restate features that already exist or
expand into implementation-level specs for every subsystem.

## Current Snapshot

- TypeScript server, shared, and web layers are stable under `src/`
- P0/P1/P2 cleanup and refactor phases are complete
- Server-side talk loop is tested end-to-end; Gun authority audit is complete
- Remaining work: contact/user-surface UX, talks navigation, answer visibility, docs alignment

## Phase 2 Backlog

### Foundation

- [x] Finish the remaining repo-noise decision and enforce it consistently:
  generated outputs, local state, logs, and test artifacts should stay out of version control
- [x] Keep current docs aligned with the working codepaths as the product surface narrows
  (Updated PROJECT_STATUS.md, README, contributing.md; archived repo-cleanup-plan; added talk-loop-authority to current docs map)
- [x] Tighten the client-side data write boundary so public vs private SEA-backed data paths are explicit instead of ad hoc

### Core Message / Talk Loop

- [x] Stabilize the end-to-end user path:
  chatroom presence → talk broadcast → incoming talk registration → answer submission → match/conversation creation
  (Fixed: `getClusterSenders` now reads from `incomingTalksMap` first; 14 HTTP-level integration tests added in `src/test/integration/talk-loop.test.ts`)
- [x] Audit where the server is still compensating for Gun timing/replication issues and decide which paths are authoritative long-term
  Source of truth: `docs/roadmap/talk-loop-authority.md`
- [x] Make the answer/template/chatbot flow easier to reason about:
  one clear path for saved answers, auto-reply templates, and talk completion side effects
  (Refactored: `talkCompleted` handler extracted to `handleTalkCompleted()` with a 4-step
  narrative; two-template design (localStorage UI cache vs Gun server auto-reply) documented)

### UX Polish

- [x] Reduce UI friction in the core web flow before adding new feature surface:
  talk creation, answering, match visibility, and conversation entry should feel consistent
  (Fixed: showConversationDetail no longer shows overlay before confirming conversation exists;
  formatting utilities extracted to ui-formatters.ts with unit tests)
- [x] Continue splitting remaining UI feature islands out of `src/web/ui/ui-manager.ts` only when the extracted boundary is user-visible or testable
  (Extracted: formatTimeAgo, formatExpiration, formatLocationRadius, escapeHtml → ui-formatters.ts)
- [x] Add narrow tests when a UX-critical seam changes instead of growing a broad speculative backlog
  (Added: src/test/unit/ui-formatters.test.ts, 20 unit tests)
- [ ] Fix the chatroom member list so it can scroll vertically when a room contains more users than fit onscreen
- [ ] Replace the duplicate chatroom broadcast buttons (`Broadcast talks to everyone here` / `Broadcast to everyone in this room`)
  with one top-level navigation/status bar action so the room-level broadcast entry point is unified
- [ ] Add a contacts list that shows every user the current user has exchanged talks with:
  include both inbound and outbound talk relationships, and show per-contact stats for exchanged talks,
  common tags, user-defined relationship, and private nickname display rules
- [ ] Unify the user profile/detail surface across chatroom member lists and contacts:
  clicking a stage name in a chatroom should open the same detail view as the contacts list, with a sparse
  fallback state when the two users have no prior contact history
- [ ] Add top-level navigation on the Talks tab for `IN`, `OUT`, and back so users can switch lists without
  scrolling to the bottom of the current section
- [ ] Expand the Answer tab so each entry shows the question, the current user's answer, and relevant answer stats together
- [ ] Add end-to-end coverage for each of the UX items above so they can be verified independently:
  chatroom member-list scrolling, unified broadcast bar, contacts list/stat display, shared user detail view,
  Talks tab `IN`/`OUT` navigation, and Answer tab combined question/answer/stat rendering
- [ ] Add reusable manual test stages with simple dev commands such as `npm run dev:stage-empty`,
  `dev:stage-user1`, `dev:stage-user2-match`, and `dev:stage-user3-network` so feature work can start from
  seeded states:
  empty app, one user with drafted talks, two users with exchanged matched/mismatched talks, and three users
  with cross-user talk history

### Platforms

- [ ] Keep Android as maintenance-only for now:
  do not expand Android or start iOS work until the web/server talk loop is stable and easier to maintain
- [ ] Revisit platform priorities only after the foundation and core-loop items above are in a better state

## Already Present

These items were previously tracked as missing or incomplete, but code or infrastructure for
them already exists in the repo and they should not stay in the active TODO as greenfield work:

- CI workflow
- Deploy scripts
- `Dockerfile`
- Structured logger
- Request logging middleware
- Rate limiting/content moderation foundations
- Talk stats/shared supporting utilities
- Android project skeleton

## Working Rule

When updating this file:

- Prefer status and priority over implementation detail
- Link to the file or doc that is the source of truth
- Remove completed items instead of letting the backlog grow forever
- If a task needs a full execution plan, put that plan in `docs/roadmap/`
