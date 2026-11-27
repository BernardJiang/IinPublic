# Phone path 17 — location refused (J-START-04)
covers: SPEC-6.1

Alice opens the app on phone A with no location permission (the phone path serves the production
bundle, so the real permission path runs).

1. The app still starts and is usable: it places her as a Traveler ✈ at a random point in Nearby
   and invents no cached fix.
2. The refusal opens the place picker so she can choose a point; she cancels and stays a Traveler.
3. Settings → Your location offers **Use my location**.
4. Every tab opens.

The real-phone version, `native-app/35`, also taps "Use my location" through Android's dialog. The
web version, `platform-smoke/02`, uses Firefox, whose unanswered prompt takes the 15 s path
without the picker. Added 2026-11-27 (OPEN-121).
