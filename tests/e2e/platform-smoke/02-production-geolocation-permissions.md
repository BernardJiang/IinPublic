# Production geolocation permissions (website)

Runs only against the production web bundle (`npm run test:e2e:firefox-permissions`), because dev
bundles use a fixed test location.

The website asks the browser for the device location at first launch.

1. **Granted:** the fix is cached and applied; the user is a Resident (not a Traveler) in a Nearby room.
2. **Not granted:** no fix is cached or invented. After the 15 s wait the user is a Traveler ✈ at a
   random point (marked `auto`) and still in a Nearby room, never Contacts only (OPEN-53). Headless
   Firefox leaves the prompt unanswered, so this is the timeout path, which does not open the picker.
