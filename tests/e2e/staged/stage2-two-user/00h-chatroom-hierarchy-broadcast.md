# 00h — GPS grid room navigation & room-scoped broadcast

covers: SPEC-3.3, SPEC-3.6, SPEC-3.4, FR-CR-1, FR-CR-2, FR-CR-10

Rooms are **Global → L1 region tiles (labeled by continent) → coarse GPS grid cells** — no country/state/city rooms in
routing or in the UI (no national borders). A remote grid room is opened the way a map tap opens
it (`openAreaRoomAt` in `tests/e2e/helpers/chatroom-nav.ts`). The file name is kept for history.

## Coverage

1. **Same grid room broadcast** — Tom and Jerry both open the London grid room (title "📍 Near
   London"). Tom broadcasts a flow Talk; Jerry's **Talks → IN** shows it.
2. **Different grid rooms are isolated** — Tom in the London grid room, Jerry in the Tokyo grid
   room. Tom's broadcast registers no receivers and Jerry never gets the Talk.
3. **No country rooms** — continent-labeled tiles (`tile_1_2_1` North America, `tile_1_3_3` Europe,
   `tile_1_2_6` Asia) are listed at level 1; `north-america` / `usa` / `california` / `germany` /
   `japan` rooms never are; a grid room with no nearby city is titled by its coarse
   coordinates ("📍 35.7°N 139.7°E").
