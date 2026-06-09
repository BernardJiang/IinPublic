# Talk Loop Authority Audit

Last updated: 2026-04-22 (all three items from Next Refactor Order completed)

This note maps the current source-of-truth decisions in the web/server talk loop and highlights
where the app still compensates for Gun timing or replication behavior.

It is the working companion for the unchecked Phase 2 backlog item in [docs/TODO.md](../TODO.md):
"Audit where the server is still compensating for Gun timing/replication issues and decide which
paths are authoritative long-term."

## Current Authority Map

### 1. Full talk loading

- Primary codepath:
  [src/web/services/web-talk-service.ts](/Users/hongyujiang/IinPublic/src/web/services/web-talk-service.ts)
- Current behavior:
  `getTalkWithRetry()` checks Gun once (cache), then immediately tries the server (authoritative),
  then enters a retry loop alternating Gun and server until one returns a complete payload.
- Practical authority today:
  Server.
  Gun is used as a low-latency cache on the first check only.
- Why this was changed:
  The old implementation retried Gun up to 20× before ever calling the server, causing up to
  5 seconds of unnecessary delay whenever Gun had a partial or missing payload that the server
  could have served immediately.

### 2. Incoming talk registration / delivery

- Primary codepath:
  [src/server/routes/talk-delivery-routes.ts](/Users/hongyujiang/IinPublic/src/server/routes/talk-delivery-routes.ts)
  plus helpers in [src/server/index.ts](/Users/hongyujiang/IinPublic/src/server/index.ts)
- Current behavior:
  Broadcast first registers intended receivers server-side, then announces the talk into chatroom Gun paths.
  The web app also refreshes incoming clusters from `/api/users/:id/incoming-talks`.
- Practical authority today:
  Server API for receiver registration and merged incoming-cluster reconstruction.
  Gun remains the live announcement transport.
- Why this exists:
  Gun chatroom announcements are good for realtime visibility, but not reliable enough alone to reconstruct
  who should still see which incoming talk after races or refreshes.

### 3. Talk answer submission

- Primary codepath:
  [src/web/app/app.ts](/Users/hongyujiang/IinPublic/src/web/app/app.ts)
  event `talkCompleted`
- Current behavior:
  The client prefers `submitTalkResponse()` to the server.
  If that fails, it falls back to direct Gun writes under `talks/:id/responses`.
- Practical authority today:
  Server.
  Gun direct-write is an emergency fallback.
- Why this exists:
  The server is now the only place that can atomically fan out response effects to senders,
  create conversations, and record stats in one path.

### 4. Match and conversation creation

- Primary codepaths:
  [src/server/index.ts](/Users/hongyujiang/IinPublic/src/server/index.ts)
  helper `createOrGetConversation()`
  and [src/web/services/web-conversation-service.ts](/Users/hongyujiang/IinPublic/src/web/services/web-conversation-service.ts)
- Current behavior:
  Server-backed response submission creates or reuses conversations authoritatively.
  The direct Gun client-side conversation-creation fallback has been removed from the
  `talkCompleted` handler. When the server submit path is unavailable the raw response
  is still written to Gun, but no conversation is created until the server is reachable.
- Practical authority today:
  Server only.
- Why the fallback was removed:
  Client-created conversations bypassed server match logic, produced data inconsistencies,
  and conflicted with server-side stats. The Gun response write is kept as a last-resort
  data preservation measure; conversations require the server path.

### 5. Talk stats in the Talks tab

- Primary codepath:
  [src/web/app/app.ts](/Users/hongyujiang/IinPublic/src/web/app/app.ts)
  event `needTalkStats`
- Current behavior:
  `summary.total`, `summary.matches`, and `summary.ignores` all come from
  `/api/stats/talks/:id/summary`. Gun response scanning has been removed.
- Practical authority today:
  Server.
- Why Gun scanning was removed:
  The stats API already tracks `outcome` per response. Aggregating from Gun added a
  duplicate, drift-prone path with no extra reliability benefit.

### 6. Status bar match count

- Primary codepath:
  [src/web/ui/ui-manager.ts](/Users/hongyujiang/IinPublic/src/web/ui/ui-manager.ts)
- Current behavior:
  The status bar now prefers actual conversation-backed match count when conversations exist,
  falling back to talk stats only before that local conversation state is available.
- Practical authority today:
  Conversations.
- Why this exists:
  Stats counts can double-count replicated response effects; real conversations are the user-facing match artifact.

## Active Compensation Paths

- `talkCompleted` still has a direct Gun write fallback if server submit fails (response record only; conversation creation requires the server path).
- Incoming talk UX still depends on both Gun announcements and server `/incoming-talks` refresh.

## Recommended Long-Term Authorities

- Full talk payload:
  server API for completeness, Gun for low-latency cache only.
- Receiver registration and incoming talk clusters:
  server API.
- Answer submission and match/conversation side effects:
  server API only.
- Conversation list and match count:
  conversation records, not derived talk stats.
- Talk stats:
  server API for all aggregate values, including match/ignore counts.

## Next Refactor Order

1. ✅ Remove Gun-derived `matches` / `ignores` aggregation from the Talks tab and expose those counts from the stats API.
2. ✅ Collapse the direct client-side conversation-creation fallback: removed the Gun `createConversation()` call from the `talkCompleted` fallback path. Conversations now require a successful server submit.
3. ✅ Revised `getTalkWithRetry()` to match the intended policy: Gun cache check first (no wait), server second (authoritative), then a retry loop alternating both if neither has a complete payload yet.

## Guardrails

- Keep Gun for realtime fan-out and subscription UX where it is actually useful.
- Stop using Gun-derived aggregates when a stable server aggregate already exists.
- Prefer user-visible artifacts as truth:
  incoming clusters for "what can I answer now", conversations for "who did I match with", stats API for totals.
