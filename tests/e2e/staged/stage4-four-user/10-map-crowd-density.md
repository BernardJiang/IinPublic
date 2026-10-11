# Test: People and Crowd Density on the Map

**File:** 10-map-crowd-density.spec.ts
**Features tested:** map presence (`src/shared/map-presence.ts`), public snapped location
(`src/shared/public-location.ts`), user dots and the density heat layer in `chatroom-map-view.ts`

---

## What this test does (in plain English):

1. **Setup:** Database cleared. Two real users boot a few km apart in San Diego with the release
   capacity, so both share one Nearby room.

2. **A synthetic crowd:** The test signs and publishes about 300 map presences through the real
   `POST /api/map-presence` endpoint: 180 people around downtown, 80 in La Jolla, and 40 scattered
   across the county. Every point is first snapped to a 1 km public square, exactly as the app does.

3. **U1's map:** U1 sees:
   - ★ for itself, drawn at its own public square rather than its exact spot;
   - a **green** dot for U2, who is in the same room, so they can exchange Talks;
   - **yellow** dots for everyone outside its Nearby;
   - a **heat layer** showing where the crowd is.

   Several users in one 1 km square merge into one dot with a count.

4. **Zoom:** U1 zooms from world, to region, to county, to city, with one screenshot per level.
   Below city zoom (10) the yellow dots are hidden and the heat layer shows density instead. The
   server always returns complete density squares, even when the view holds too many people to
   list as dots.

> **Why this matters:** Users can see where the crowd is and travel there. Nobody's exact location
> is ever published: each dot is the centre of a grid square at least 1 km wide.

**Outputs:** `NN-U1-map.png` per zoom level, `video-U1/*.webm`.
