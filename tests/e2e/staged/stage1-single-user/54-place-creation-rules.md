# 54 — Place creation rules

Covers the Place lifecycle and creation limits in
`docs/design/nearby-and-place-chatrooms.md` §4.2.

1. **Incoming-Friend minimum.** With `?e2e_place_min_friends=3`, a new user with no incoming
   Friend marks taps New Room and sees that three other people must mark them as a Friend. The form
   does not open. E2E bundles otherwise bake a minimum of zero; release is 12.
2. **Trademark reminder.** The New Room form shows the trademark notice.
3. **Empty Places stay reachable, one ever per person.** The user creates a Place and is moved into it,
   returns home, and finds the now-empty Place in the compact room-folder list. Creating a
   second Place is refused with "You already have a room". Tapping the listed Place enters it.
