# Test: Location Auto Assignment

covers: SPEC-6.3  <!-- auto-seeded; refine by hand -->

**File:** `27-location-auto-assignment.spec.ts`

**Features tested:** GPS mock support, explicit location refresh, area-room (L4 tile) assignment

## What this test does

1. Starts the app with the default test location, which places the new user in Global.
2. Mocks browser geolocation to New York City.
3. Triggers the app's location-refresh event.
4. Verifies the current chatroom changes to New York's area room: the bottom-layer (~78 km) tile
   `tileIdAt(4, 40.7128, -74.006)` — never a country/state room or a 1 km cell.
