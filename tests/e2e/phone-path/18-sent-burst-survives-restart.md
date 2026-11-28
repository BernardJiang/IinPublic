# Phone path 18 — a burst of sent messages survives a restart (OPEN-122)
covers: SPEC-19.4

Alice (on a phone node this spec starts and stops) and Bob match and chat; the shared
`journeys/talk-match-chat-journey.ts` ends with Alice sending two messages back to back. One
second later Alice's app closes and her node stops, then both start again on the same data. Every
message she had on screen must still be in her conversation.

Found 2026-11-27: each sent message's save waited for storage to confirm (~1.5 s, the phone node's
Radisk gathers writes for 1 s) before the next save began, so six messages took ~9 s to store and a
restart in that window lost the last ones. Saves queued behind a running one now go together
(`writeConversationMessagesToGraph`, app.ts).
