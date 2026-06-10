# P0 Step 5 — Local-only contacts and history

## What this spec tests

Three browsers (Tom, Jerry, Bob) join the same chatroom overlay.

Tom broadcasts a tag talk. Jerry answers MATCH; Bob answers IGNORE.
Local exchange records are injected on Tom's side (responses arrive via mesh).

The test then:
1. Opens Tom's Contacts tab.
2. Asserts **Jerry appears** with `data-match-percent > 0` — derived from `localTalkExchanges` only.
3. Asserts **Bob also appears** — ignored exchanges still produce a contact entry.
4. Opens Jerry's peer detail from Tom's contacts view.
5. Asserts the exchanged talk appears in the history list.
6. Asserts **zero calls** to the four removed server endpoints across all pages:
   - `GET /api/users/:id/peers`
   - `GET /api/users/:id/peers/:peerId/relationship`
   - `GET /api/users/:id/peers/:peerId/talk-history`
   - `GET /api/users/:id/replies`

## Why this works after P0 step 5

`contacts-view.ts#displayContactsList` no longer calls `/api/users/:id/peers`.
Instead it calls `deriveLocalPeers()` which merges three local sources:
- `localTalkExchanges` (localStorage)
- `myConversations` (localStorage)
- `knownPeople` (SEA-encrypted private Gun data)

`showContactDetail` no longer calls `/talk-history` or `/relationship`.
History is rendered via `localTalkHistoryForPeer()` from the same stores.

`user-detail-view.ts#fetchAndRenderStats` computes stats locally via
`computeLocalStats()`, mirroring `peer-routes.ts#computeRelationshipStats`.

`ui-manager.ts#refreshCreatorReplies` derives rows from `localTalkExchanges`
via `deriveLocalCreatorReplies()` — no call to `/api/users/:id/replies`.

`chatrooms-view.ts#loadMemberStats` computes member stats from `localTalkExchanges`
via `localMemberStats()` — no call to `/relationship`.

## Match % formula

```
matchRate    = (sent.matches + received.matches) / max(totalTalks, 1)
matchPercent = round(matchRate * 100)
```

This is identical to the formula in `peer-routes.ts#computeRelationshipStats` so
the value shown is consistent with what the server would have computed.

## Bob's contacts behavior

Bob (ignore outcome) appears in Tom's contacts list because the local exchange record
is written regardless of outcome. The contact card shows 0 matches and 0% match rate,
but the peer is listed so Tom can still open their detail and see the exchange history.
This mirrors the prior behavior where the server's `/peers` endpoint included all peers
with any interaction.
