# 54 — Place creation rules

Covers the Place lifecycle and creation limits in
`docs/design/nearby-and-place-chatrooms.md` §4.2.

1. **Contact minimum.** With `?e2e_place_min_contacts=3`, a new user (0 contacts) taps New Room and
   sees "You need at least 3 contacts to create a room. You have 0." The form does not open.
   (E2E bundles otherwise bake a minimum of 0; release is 100, debug builds 3.)
2. **Trademark reminder.** The New Room form shows the trademark notice.
3. **Empty Places stay reachable, one per person.** The user creates a Place and is moved into it,
   returns home, and finds the now-empty Place under "Places near you" in the room list. Creating a
   second Place is refused with "You already have a room". Tapping the listed Place enters it.
