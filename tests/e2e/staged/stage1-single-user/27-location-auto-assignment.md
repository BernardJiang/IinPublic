# Test: Location Auto Assignment

covers: SPEC-6.3  <!-- auto-seeded; refine by hand -->

**File:** `27-location-auto-assignment.spec.ts`

**Features tested:** GPS mock support, explicit location refresh, automatic Nearby group assignment

## What this test does

1. Starts the app with the default test location, which places the new user in the automatic
   Nearby group (a `nearby_…` room).
2. Mocks browser geolocation to New York City and triggers the app's location refresh.
3. Verifies the user stays in the same Nearby group. Nearby is an adaptive partition
   (`src/shared/nearby-partition.ts`): one world-wide root group that splits by location only once
   it overflows capacity, so a lone user is not moved. The room is never Global or a `tile_…` room
   (both retired with the tile tree).
