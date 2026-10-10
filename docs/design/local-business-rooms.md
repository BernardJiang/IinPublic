# Local business rooms — superseded proposal (2026-10-07)

> **Superseded 2026-10-08 by `nearby-and-place-chatrooms.md`.** Signed, content-addressed map Places
> remain part of the replacement design, but they no longer live under an L4 tree.

Status: **proposal, not implemented.** Replaces today's "custom chatroom" (FR-CR-5/6) for the
room tree. Decisions marked **[decide]** need the product owner. The room tree itself (Global +
4 tile layers ending at ~78 km, moving down on overflow and up on underflow) is in
`room-tree-routing.md`.

## 1. Problem

The room tree is now **Global → continents → GPS grid rooms** (FR-CR-4a). Country/state/city rooms
were removed so the UI draws no national borders. But custom rooms still let anyone publish a room
with any name and no geographic scope:

- A custom room called "Taiwan", "Crimea" or "United States" acts as a *de facto* country room,
  re-introducing exactly what FR-CR-4a removed — and since descriptors are immutable and ownerless
  (FR-CR-12), nobody can take it down.
- Nothing stops many large, overlapping "area" rooms ("Southern California", "SoCal", "LA + SD").
- The original purpose — a small local business (a café, a tennis club, a shop) having its own
  room under its town — has no structure at all: custom rooms are flat, top-level, and unplaced.
- Descriptors are unsigned Gun data (`chatroomMeta/<id>`), so any connected client could rename or
  deactivate another room (see §7).

## 2. Principle

> A custom room is a **place**, not an **area**.

It is a point of interest anchored to exactly **one** grid cell — the cell its creator is
physically in. It never covers or contains territory, so two custom rooms cannot overlap in area;
they can only sit side by side as points inside cells. Large areas exist only as built-in rooms:
Global, the six continents, and grid cells.

## 3. Tree position

```
🌍 Global
└─ 🌎 North America · West & Central     (L1 tile, labeled by continent)
   └─ … L2, L3 …
      └─ 📍 Around San Diego             (L4 tile, ~78 km, the bottom routing layer)
         ├─ 🏪 Bean There Café · Ocean Beach      (anchored to one ~1 km cell)
         ├─ 🏪 Mission Bay Tennis Club · Mission Bay
         └─ 💬 Ocean Beach Pickup Soccer · Ocean Beach
```

- A custom room is **anchored** to one ~1 km cell (`region_<lat>_<lng>`): where the creator stood.
- It is **listed** under the L4 tile (~78 km) that contains that cell, so it is discoverable
  across its metro area while still occupying one point.
- Its title is always qualified by its anchor, e.g. "🏪 Bean There Café · Near Ocean Beach", or the
  coordinates if no city is near. A room named "Taiwan" therefore reads as a local group's name,
  not a country.
- Map: the pin is the anchor cell's point, or a business pin inside the cell (§5).

## 4. Creation rules

1. **Confirmed local fix required.** Creation needs a confirmed GPS fix (`locationConfirmed`); the
   anchor is `getAutomaticLocationChatroomId(currentLocation)` — the creator's *own* cell.
2. **No remote creation.** Not allowed while travelling (FR-CR-10) or from a desktop/GPS-less
   device. You can only put a room where you are standing. **[decide]** allow desktops to create
   with a user-picked cell? (Recommended: no — it re-opens remote "area" rooms.)
3. **No area rooms.** There is no "region" or "multi-cell" room type. The type list stays
   `business | community`.
4. **Name rules.** 2–60 chars. No uniqueness registry (FR-CR-11). Optional local check: if the
   anchor cell already has a room with the same normalized name, the dialog shows it and offers
   **Join** instead of **Create** (prevents accidental duplicates, does not forbid them).
5. **Creation limit (decided 2026-10-07): one room per person and one per device.**
   - **Per person:** verifiers keep only the earliest valid descriptor per `creatorPub` and ignore
     later ones.
   - **Per device:** the descriptor also carries a device key. On Android it comes from the
     hardware-backed Keystore with attestation (already used for K-custody), which verifiers check.
     Browsers have no attestation, so for web this is a local, best-effort check only.
   - **[decide]** Because rooms are immutable and ownerless, "one room" would mean one forever. A
     creator could be allowed to publish a signed *successor* descriptor that replaces their own
     listing; the old room stays reachable by link but is no longer listed.
6. **Capacity and eviction:** see §4a.

## 4a. Eviction in custom rooms

- **Capacity** is the global `C = 498`, like every room (FR-CR-18).
- **Overflow stays inside the family.** When the base room is full, its oldest ordinary member
  moves to `<id>_part_2`, then `_part_3`, and so on. The creator gets no exemption (FR-CR-7).
  Members are not pushed into the geographic tiles, because they came for this place.
- **Family cap [decide]:** a small-business room is capped at **P parts** (default P = 2, about 1,000
  people). When the last part overflows, its oldest member leaves the family and goes to their own
  regional tile (or Global, without GPS), with the normal cooldown.
- **Underflow:** `_part_N` members are promoted back toward the base room under the same rule and
  cooldown as the tree (`room-tree-routing.md` §4). Nobody is auto-promoted *out of* the base room
  up to the L4 tile; leaving is the user's choice.

## 5. Descriptor (signed, content-addressed)

```jsonc
{
  "v": 1,
  "kind": "business" | "community",
  "name": "Bean There Café",
  "description": "…",
  "anchorCell": "region_32.71_-117.17",     // required; the ONLY geographic scope
  "pin": { "lat": 32.714, "lng": -117.165 }, // optional, business only, MUST fall inside anchorCell
  "creatorPub": "<SEA pub>",                 // provenance, not authority (FR-CR-6/12)
  "createdAt": "2026-10-07T…Z"
}
signature = SEA.sign(canonicalJson(descriptor), creatorPair)
id        = "place_" + sha256(canonicalJson(descriptor) + signature)[0:40]   // FR-CR-11
```

- **Content-addressed id**: the id is derived from the signed descriptor, so a descriptor can't be
  swapped under an existing id.
- **Verification everywhere** (server listing, client listing, relays): drop any descriptor whose
  signature fails, whose id doesn't match its hash, whose `anchorCell` isn't a valid grid id, or
  whose `pin` falls outside `anchorCell`.
- **No mutable fields.** `isActive`, rename and delete do not exist (already 410 server-side);
  "edit" = publish a new descriptor. Local hide/block stays per-user (FR-CR-12).
- **Privacy**: `pin` is a business's public address — only offered for `business`, with explicit
  "this location will be public" consent. Community rooms never carry a pin.

## 6. Discovery

- A cell's custom rooms are listed under that cell in the tree and on the map.
- The tree only expands cells the user is in or travels to (as now), so the list never shows every
  business on Earth. Map shows custom-room pins for the visible viewport only.
- Listing is per L4 tile (~78 km), which replaces the earlier 3×3-cell idea: the bottom routing
  layer is already metro-sized, and the anchor cell still fixes the room to one point.

## 7. Integrity fixes this subsumes

- Today `GET /api/chatrooms` trusts any `chatroomMeta/*` written to the open Gun graph (not
  signature-checked) and honours `isActive: false` from it. With §5 verification, unsigned or
  mismatched descriptors are ignored and `isActive` is gone.
- `POST /api/chatrooms` currently accepts any `location`; it becomes "verify the signed descriptor
  and its anchor/pin rules", nothing else.

## 8. Existing custom rooms (migration)

Existing `room_*` rooms have no anchor and no signature. **[decide]**:
- (a) **Hide from the tree and map**; still reachable by direct link/id and by people already in
  them. **Recommended.**
- (b) Anchor rooms that have a `location` to that cell; hide the rest.
- (c) Delete — not possible by design (ownerless, immutable).

## 9. Spec changes

- Replace FR-CR-5/6 with: custom rooms are *place rooms* anchored to the creator's own grid cell;
  no area rooms; signed content-addressed descriptors (§5); creation limits (§4.5).
- FR-CR-4a: tree is Global → continents → grid cells → place rooms.
- FR-CR-11: id = hash of the signed descriptor (now actually implemented).

## 10. Tests

- Unit: descriptor sign/verify, id derivation, pin-outside-cell rejected, anchor must be a grid id,
  tampered `name`/`anchorCell` rejected, per-identity limits.
- E2E: create at San Diego → appears under "Near San Diego" (level 3) in tree and as a pin on the
  map; cannot create while travelling to London; same-name prompt offers Join; an injected unsigned
  `chatroomMeta` entry does not appear; legacy unanchored room is hidden from the tree.
