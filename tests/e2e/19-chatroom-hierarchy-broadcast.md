# 19 — Chatroom hierarchy navigation & regional broadcast

Covers **`docs/TODO.md` P1** item: multi-chatroom / hierarchy behaviours beyond Global-only flows.

## Coverage

1. **Leaf room navigation — North America → United States**  
   Expands `north-america` in the hierarchy list (`▶`), opens `usa`, verifies `#current-chatroom-title` contains **United States**.

2. **Regional broadcast (same leaf room)**  
   Tom and Jerry both in **United States**. Tom OUT-broadcasts one flow talk; preamble confirmed; Jerry’s **Talks → IN** shows the talk title.

3. **Parent room must not fan out to child rooms**  
   Tom joins **North America** (internal node). Jerry joins **United States** only. Tom broadcasts; Jerry MUST NOT appear in bulk receiver registration (asserted via `GET /api/users/:id/incoming-talks` staying absent for the broadcast title).

4. **Second region smoke — Europe → Germany**  
   Confirms another branch of `CHATROOM_HIERARCHY` opens without depending on member sync.

## Helpers

- `tests/e2e/helpers/broadcast-preamble.ts` — confirms tag preamble (chip + Send) when the bulk-send modal is shown.
- `tests/e2e/helpers/broadcast-ack.ts` — waits for `#broadcast-bulk-ack` data attributes (bulk send can outlast the 3s success toast).
