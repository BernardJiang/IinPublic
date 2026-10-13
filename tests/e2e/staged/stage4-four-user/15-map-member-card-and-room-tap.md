# Map: member card and moving by tap

covers: SPEC-3.3, SPEC-3.4

**File:** `15-map-member-card-and-room-tap.spec.ts`

Restores the map ↔ people connection the old tree view had: from the map you can reach a person
in your room and message them, and you can move to another room by tapping it.

## Test 1 — green dot → profile card → DM / profile

1. U1 and U2 boot in San Diego and share the worldwide Nearby room.
2. U1 opens the map; U2 is a green dot ("can exchange Talks"). U1's own ★ never takes the tap.
3. Tapping the dot opens a card: avatar, name, Online/Away, Matched, ✈ Traveler, languages and up to
   three **public** profile lines (contacts-only and private rows are filtered out).
4. **💬 Message** opens the ordinary DM overlay with U2 (same path as tapping a member in the room's
   member list). Back pops to U2's peer page, then to the map.
5. **👤 Profile** opens U2's peer page directly.

## Test 2 — tap another group → move into it

1. Four users, `e2e_capacity=3`: the worldwide group splits until every group holds ≤ 3.
2. U1 taps another group's pin on the map and ends up in that group.

Open-map taps follow one rule (`routeMapTap`, unit-tested in `chatroom-map-tap.test.ts`): inside
my own room → the "Join as traveler" point card (so a lone user, whose room is the whole world, can
still travel); inside another group's square → enter that group; anywhere else → travel there. A
yellow dot (someone outside my room) counts as a tap on its point.
