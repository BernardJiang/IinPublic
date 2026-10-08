# Room tree and routing — design proposal (draft, 2026-10-07)

Status: **implemented 2026-10-07** (two-way routing, desktop home tile, tile tree UI); custom-room
rules in `local-business-rooms.md` are still a proposal. Supersedes the "Global → coarse 1 km cell" jump in
FR-CR-3 (evictions currently go straight from Global to a ~1 km cell, and nothing ever moves a
user back up). Companion: `local-business-rooms.md`. Open points are marked **[decide]**.

## 1. What the layers are for

1. **Overflow:** when a room reaches capacity `C`, its oldest member moves *down* one layer.
2. **Finding people:** new users start in Global, the most crowded room. When rooms thin out, people
   move back *up* so a small population gathers again.

Both only work if movement goes both ways, and if the layer below a full room is big enough to
still have people in it.

## 2. The tree: geometric tiles, Global plus 4 layers, ending at ~78 km

Tiles are pure latitude/longitude squares, so they never follow a national border. Each tile has
16 children (4 × 4), so the tree stays shallow:

| Layer | Tile size | Approx. size (equator / 45° lat) | Count |
|---|---|---|---|
| L0 | Global | the world | 1 |
| L1 | 45° × 45° | ~5,000 km / ~3,500 km wide | 32 |
| L2 | 11.25° | ~1,250 km / ~890 km | 512 |
| L3 | 2.8125° | ~310 km / ~220 km | 8,192 |
| L4 | 0.703125° | **~78 km / ~55 km** (the bottom layer) | 131,072 |

- Tile id: `tile_<layer>_<row>_<col>` from `floor((lat + 90) / size)` and `floor((lng + 180) / size)`.
  This is deterministic, so every device computes the same tile for the same point.
- **The tree stops at L4 (~78 km).** A full L4 tile does not split by geography any further. It
  overflows into numbered rooms of the same family (`tile_4_…_part_2`, `_part_3`…), the
  existing flat split rule (`chatroom-split.ts`).
- The 1 km privacy cell stays as it is (`region_<lat>_<lng>`), but only as the **anchor** of
  business rooms and for privacy-blurred presence. It is no longer a room layer.
- **Continents (decided 2026-10-07): label L1 tiles by continent.** Each L1 tile is labeled
  by the continent covering most of its land, plus a compass or region suffix where several tiles
  share a continent ("🌎 North America · West & Central", "🇪🇺 Europe · North Atlantic"). The labels
  live in a hand-checked table (`L1_TILE_LABELS`, `src/shared/room-tiles.ts`) and never name a
  country. Each tile has a map pin on its own land. Ocean and Antarctica tiles ("🌊 North Pacific",
  "🧊 Antarctica") are listed only while someone is in them. Labels are display only; routing uses
  tile ids. **Implemented** for the room tree and map (L1 only; routing still to come).
- Display names: a tile is labeled by its largest city ("📍 Around San Diego"), with the same
  city-only rule as FR-CR-4a; otherwise by coordinates.

## 3. Moving down (overflow)

When a room at layer k has more than `C` members, its **oldest ordinary member** moves to the
child tile at layer k+1 that contains their location. That is one layer only; if the child also
overflows, the move repeats one layer further down. At L4, overflow goes to `_part_N` instead.

Same coordinator rule as today: the room's newest member writes the eviction notice, and the
evicted user moves themselves.

## 4. Moving up (underflow), with an eviction cooldown

A member of a room at layer k > 0 moves automatically to the parent room when **all** of these
hold:

1. **Too few people:** their room has fewer than `F` other members (default `F = 2`) for a dwell
   time `T` (default 3 min, plus random jitter of up to 60 s).
2. **Parent has room:** the parent's count is at most `C − H` (default `H = 10%` of `C`, i.e. 49
   at C = 498). The gap between "full at C" and "move up only below C − H" stops bouncing.
3. **Not in an eviction cooldown** (below). This is the infinite-loop guard.

**Eviction cooldown (loop guard).** A user who was evicted from room P may not be promoted back
into P, or any ancestor of P, until their cooldown ends, even if they are alone. Cooldown is
`E · 2^(n−1)`, where `n` is how many times they were evicted from P in the last 24 h:
15 min, then 30 min, then 60 min, capped at 4 h (default `E = 15 min`). It resets after 24 h
without an eviction.

Why this ends the loop: eviction happens only when P is above `C`; promotion needs P at or below
`C − H` **and** an expired cooldown. Without the cooldown, a lone evictee could re-enter as soon
as one person left P, push P back over `C`, and evict someone else, over and over. With an
exponential cooldown, each user can contribute at most a few re-entries a day.

**What the lone evictee sees.** A status line, for example "Global is full. You'll move back up
when there's room (in ~15 min)." The manual "⬆ Bigger room" button is shown but disabled during
cooldown or while the parent is above `C − H`.

**Never promoted automatically out of:** a custom room's base room, or a travel destination,
because the user chose those on purpose. Inside a custom room's family, `_part_N` members are
promoted back toward the base room (`local-business-rooms.md` §4a).

**On restart:** the user rejoins their last room (startup never blocks on a count read); the
same promotion check then runs after the dwell, so a thin room is left within a few minutes. The
"manual vs automatic" arrival is remembered across restarts (`iinpublic_room_arrival`), as is the
eviction history for the cooldown (`iinpublic_room_eviction_history`).

## 5. Users without GPS

A user has no confirmed location when they are on a desktop, have denied permission, or have no
fix yet. They can't descend by geography, so they get a **parallel non-geographic branch**:

```
🌍 Global
├─ tile_1_… (geographic tree, users with a confirmed fix)
└─ 🌐 Global · Group 2, 3, …   (global-unknown family, users without a fix)
```

- **Down:** when Global overflows and the oldest member has no fix, they move to the
  `global-unknown` family (`global-unknown`, `_part_2`…). This exists today.
- **Up:** the same underflow rule and cooldown apply. A thin `global-unknown` room promotes its
  members back to Global when Global has room.
- **Getting a fix later:** a user does not leave their current room because a fix arrives
  (FR-CR-2). Their next eviction or promotion uses the geographic tree.
- **Home tile for desktops (decided 2026-10-07):** a GPS-less user may pick **any tile of any
  layer** (L1–L4) on the map as home. They enter and return to it like any member, and the
  **eviction rule applies to them too**. With no position inside the tile, they can't descend to a
  child tile, so their overflow goes to the home tile's own `_part_N` family, and underflow
  promotes them to the tile's parent, with the same cooldown. They are marked "area set by user",
  like the traveler marker. IP geolocation is not used: it is inaccurate and leaks.

## 6. Capacity

- Every room holds at most `C = 498` (FR-CR-18). The tree has 1 + 32 + 512 + 8,192 + 131,072 =
  **139,809 rooms**, so about **69.6 million** people at once before any `_part_N` split. About a
  third of the tiles are land people actually live on, so roughly **20 million** in practice.
- Bottom-layer (L4, ~78 km) tiles can overflow into `_part_N` without limit, so there is **no hard
  total**. The real constraint is local: one metro area gets 498 per L4 room plus its parts.
- Custom rooms add up to one room per person (`local-business-rooms.md` §4), each capped as in §4a
  there.

## 7. Defaults summary

| Parameter | Default | Meaning |
|---|---|---|
| `C` | 498 (3 in local debug) | room capacity (unchanged, global) |
| bottom layer | L4, ~78 km | below it, `_part_N` splits only |
| `F` | 2 | promote when fewer than F others |
| `T` | 3 min + ≤60 s jitter | how long underflow must last |
| `H` | 10% of C | parent headroom required to promote |
| `E` | 15 min, doubling, cap 4 h | eviction cooldown before any promotion |

## 8. Migration from today (as implemented)

- Users already sitting in a `region_*` (1 km) room move up to its L4 tile through the normal
  promotion rule once the room is thin (`promotionTarget` maps a grid room to its L4 tile).
- Users in a legacy named room (`usa`, `california`…) keep it until they leave; it has no
  automatic step up and is shown at the top of the list as their current room.
- "📍 Use my location" and "Return home" now go to the user's own L4 tile, not the 1 km cell.
- A map tap opens the L4 tile at that point. `region_*` ids stay valid as business-room anchors.
- The OPEN-40 arena micro-room code only acts on rooms in a `region_*` family, which no automatic
  route produces any more; it is dormant until re-homed under an L4 tile's `_part_N` family.

## 9. Tests

- Unit: tile id math at the edges (lat ±90, lng ±180, the antimeridian); one-layer descent; L4
  overflow goes to `_part_2`; promotion predicate (F, T, H, cooldown); cooldown doubling and reset;
  no-fix routing to `global-unknown`.
- E2E (C = 3, short T/E via `e2e_*` params): fill Global, oldest goes to their L1 tile, not to a
  1 km cell; a lone evictee is **not** promoted during cooldown even when Global drops by one; after
  cooldown, with headroom, they are promoted; a desktop without GPS overflows to Global · Group 2
  and returns to Global when it empties.
