# 00h — GPS grid room navigation & room-scoped broadcast

covers: SPEC-3.3, SPEC-3.6, SPEC-3.4, FR-CR-1, FR-CR-2, FR-CR-10

The room list is flat (the user's automatic Nearby room plus rooms near them); the Global → region
tile tree is retired, and there are no country/state/city rooms in routing or in the UI (no
national borders). Coarse grid rooms can still be opened directly by coordinates. A remote grid room is opened the way a map tap opens
it (`openAreaRoomAt` in `tests/e2e/helpers/chatroom-nav.ts`). The file name is kept for history.

## Coverage

1. **Same grid room broadcast** — Tom and Jerry both open the London grid room (title "📍 Near
   London"). Tom broadcasts a flow Talk; Jerry's **Talks → IN** shows it.
2. **Different grid rooms are isolated** — Tom in the London grid room, Jerry in the Tokyo grid
   room. Tom's broadcast registers no receivers and Jerry never gets the Talk.
3. **No tiles or country rooms in the list** — the flat list shows the current Nearby row and no
   `tile_…` rows; `north-america` / `usa` / `california` / `germany` / `japan` rooms never appear;
   a grid room opened by coordinates is titled by its nearest city ("📍 Around Tokyo").
