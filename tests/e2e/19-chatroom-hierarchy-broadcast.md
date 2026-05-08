# 19 — Chatroom hierarchy navigation & regional broadcast

Covers **`docs/TODO.md` P1** item: multi-chatroom / hierarchy behaviours beyond Global-only flows.

## Coverage

1. **Leaf room navigation — North America → United States**  
   Expands `north-america` in the hierarchy list (`▶`), opens `usa`, verifies `#current-chatroom-title` contains **United States**.

2. **Regional broadcast (same leaf room)**  
   Tom and Jerry both in **United States**. Tom OUT-broadcasts one flow talk; preamble confirmed; Jerry’s **Talks → IN** shows the talk title.

3. **Continent room + subtree audience**  
   Tom opens **North America** (internal node). Jerry stays in **United States**. Tom broadcasts with preamble **“This room + descendant rooms”** so receiver resolution includes child rooms; Jerry still receives server/Gun delivery.

4. **Second region smoke — Europe → Germany**  
   Confirms another branch of `CHATROOM_HIERARCHY` opens without depending on member sync.

## Helper change

- `tests/e2e/helpers/broadcast-preamble.ts` accepts optional `{ audienceScope: 'subtree' }` to drive the bulk-send preamble radios in subtree tests.
